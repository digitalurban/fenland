/*
   ENSEMBLE TAB — multi-model grand ensemble from the Open-Meteo open
   ensemble API. Fully self-contained in an IIFE: the only global it
   touches is window.__ENSEMBLE__, so nothing above can collide with it.
   Data loads lazily the first time the tab is opened.
 */

window.__ENSEMBLE__ = (function () {
  "use strict";

  /* ── config ───────────────────────────────────────────────────────── */
  /* ── configuration ──────────────────────────────────────────────────
     Everything comes from window.WXCONFIG (see config.js). The fallbacks
     below are only used if that file is missing, so the page still runs.  */
  const CFG = (typeof window !== "undefined" && window.WXCONFIG) || {};
  const STATION = CFG.station || {};
  const LAT = CFG.lat != null ? CFG.lat : 52.6033;
  const LON = CFG.lon != null ? CFG.lon : 0.3822;
  const TZ  = encodeURIComponent(CFG.timezone || "Europe/London");
  const WIND_UNIT = (CFG.units && CFG.units.wind) || "mph";
  const API = "https://ensemble-api.open-meteo.com/v1/ensemble";
  const VARS = ["temperature_2m", "precipitation", "wind_speed_10m", "pressure_msl"];
  const MODELS = [
    { id:"ecmwf_ifs025",               short:"ECMWF", name:"ECMWF ENS",    centre:"Reading",   days:15, color:"#2563eb", on:true  },
    { id:"gfs_seamless",               short:"GFS",   name:"NOAA GEFS",    centre:"USA",       days:16, color:"#ef4444", on:true  },
    { id:"icon_seamless",              short:"ICON",  name:"DWD ICON EPS", centre:"Germany",   days:14, color:"#d97706", on:true  },
    { id:"gem_global",                 short:"GEM",   name:"ECCC GEPS",    centre:"Canada",    days:16, color:"#0d9488", on:false },
    { id:"bom_access_global_ensemble", short:"BOM",   name:"BOM ACCESS",   centre:"Australia", days:10, color:"#7c3aed", on:false }
  ];

  /* config decides which of those are switched on at load */
  (function () {
    const want = CFG.ensembleModels;
    if (Array.isArray(want) && want.length) {
      MODELS.forEach(m => { m.on = want.indexOf(m.id) > -1; });
      if (!MODELS.some(m => m.on)) MODELS[0].on = true;   // never leave none on
    }
  })();

  const S = { times:[], data:{}, daily:[], horizon:3, loading:false, loaded:false };
  let TIP = null;

  /* ── helpers ──────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const avg = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x) => s+x, 0)/v.length : null; };
  function pct(arr, p) {
    const a = arr.filter(v => v != null && !isNaN(v)).sort((x,y) => x-y);
    if (!a.length) return null;
    const i = (a.length-1)*p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi]-a[lo])*(i-lo);
  }
  const r1 = v => v == null ? "–" : (Math.round(v*10)/10).toFixed(1);
  const r0 = v => v == null ? "–" : String(Math.round(v));
  const pad2 = n => String(n).padStart(2, "0");
  const localKey = d => d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  const dayName = d => d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
  const enabled = () => MODELS.filter(m => m.on);
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#64748b";
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n>>16)&255) + "," + ((n>>8)&255) + "," + (n&255) + "," + a + ")";
  }

  /* ── model chips ──────────────────────────────────────────────────── */
  function renderChips() {
    const bar = $("ensModels"); if (!bar) return;
    bar.innerHTML = MODELS.map(m => {
      const n = S.data.temperature_2m ? S.data.temperature_2m.filter(s => s.model === m.id).length : 0;
      return "<div class='ens-model" + (m.on ? " active" : "") + "' data-id='" + m.id + "' style='color:" + m.color + "'>" +
             "<span class='dot'></span><span class='nm'>" + m.short + "</span>" +
             "<span class='ct'>" + (n ? n + " MEM" : m.centre.toUpperCase()) + "</span></div>";
    }).join("");
  }

  /* ── fetch ────────────────────────────────────────────────────────── */
  const urlFor = m => API + "?latitude=" + LAT.toFixed(4) + "&longitude=" + LON.toFixed(4) +
    "&hourly=" + VARS.join(",") + "&models=" + m.id + "&forecast_days=" + m.days +
    "&wind_speed_unit=" + WIND_UNIT + "&timezone=" + TZ;

  async function load() {
    if (S.loading) return;
    S.loading = true;
    const st = $("ensStatus"), list = enabled();
    st.className = "ens-status";
    st.textContent = "LOADING " + list.length + " ENSEMBLES — " + list.map(m => m.short).join(" · ") + "…";
    document.querySelectorAll(".ens-model").forEach(c => c.classList.add("busy"));

    const res = await Promise.allSettled(list.map(async m => {
      const r = await fetch(urlFor(m));
      if (!r.ok) throw new Error(m.short + ": HTTP " + r.status);
      const j = await r.json();
      if (!j.hourly || !j.hourly.time || !j.hourly.time.length)
      throw new Error(m.short + ": empty response");
      return { m, j };
    }));

    S.loading = false;
    document.querySelectorAll(".ens-model").forEach(c => c.classList.remove("busy"));

    const ok  = res.filter(r => r.status === "fulfilled").map(r => r.value);
    const bad = res.filter(r => r.status === "rejected").map(r => r.reason);
    if (!ok.length) { fail(bad[0] || new Error("no models returned data"), urlFor(list[0])); return; }

    merge(ok);
    aggregate();
    S.loaded = true;

    const total = S.data.temperature_2m.length;
    const parts = ok.map(({m}) => m.short + " " + S.data.temperature_2m.filter(s => s.model === m.id).length);
    st.className = "ens-status";
    st.innerHTML = total + " MEMBERS POOLED · " + parts.join(" · ") + " · " + S.daily.length + " DAYS · RUN FROM " +
      S.times[0].toLocaleString("en-GB", { weekday:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }).toUpperCase() +
      (bad.length ? " · <span style='color:var(--accent)'>UNAVAILABLE: " + bad.map(e => e.message).join("; ").toUpperCase() + "</span>" : "");

    renderChips();
    renderAll();
  }

  function merge(ok) {
    let master = ok[0].j.hourly.time;
    ok.forEach(({j}) => { if (j.hourly.time.length > master.length) master = j.hourly.time; });
    const idx = new Map(); master.forEach((t,i) => idx.set(t,i));
    S.times = master.map(t => new Date(t));
    S.data = {}; VARS.forEach(v => S.data[v] = []);
    ok.forEach(({m,j}) => {
      const h = j.hourly, times = h.time;
      VARS.forEach(v => {
        Object.keys(h).forEach(k => {
          if (k === "time" || (k !== v && k.indexOf(v + "_") !== 0)) return;
          const src = h[k], out = new Array(master.length).fill(null);
          for (let i = 0; i < times.length; i++) {
            const t = idx.get(times[i]);
            if (t !== undefined) out[t] = src[i];
          }
          S.data[v].push({ model:m.id, color:m.color, short:m.short, arr:out });
        });
      });
    });
  }

  function summarise(series, idx) {
    const memMax=[], memMin=[], memMean=[], memRain=[], memWind=[], memPres=[];
    series.temperature_2m.forEach(s => {
      const v = idx.map(i => s.arr[i]).filter(x => x != null);
      if (v.length) { memMax.push(Math.max.apply(null,v)); memMin.push(Math.min.apply(null,v)); memMean.push(avg(v)); }
    });
    series.precipitation.forEach(s => {
      const v = idx.map(i => s.arr[i]).filter(x => x != null);
      if (v.length) memRain.push(v.reduce((a,b) => a+b, 0));
    });
    series.wind_speed_10m.forEach(s => {
      const v = idx.map(i => s.arr[i]).filter(x => x != null);
      if (v.length) memWind.push(Math.max.apply(null,v));
    });
    series.pressure_msl.forEach(s => {
      const v = idx.map(i => s.arr[i]).filter(x => x != null);
      if (v.length) memPres.push(avg(v));
    });
    const n = memRain.length || 1;
    const extreme = (a, fn) => a.length ? fn.apply(null, a) : null;
    return {
      n: memMax.length,
      // raw member values kept so the Forecast tab can ask where a single
      // deterministic forecast sits inside the distribution
      mem: { max: memMax, min: memMin, rain: memRain },
      // hi / lo are the true envelope — the single warmest and coldest member
      tmax: { mean:avg(memMax), p10:pct(memMax,.1), p90:pct(memMax,.9), hi:extreme(memMax, Math.max) },
      tmin: { mean:avg(memMin), p10:pct(memMin,.1), p90:pct(memMin,.9), lo:extreme(memMin, Math.min) },
      rain: { mean:avg(memRain), p10:pct(memRain,.1), p90:pct(memRain,.9), max:extreme(memRain, Math.max),
              prob: memRain.filter(x => x >= 0.2).length/n,
              probHeavy: memRain.filter(x => x >= 5).length/n },
      wind: { mean:avg(memWind), p90:pct(memWind,.9) },
      pres: { mean:avg(memPres), p10:pct(memPres,.1), p90:pct(memPres,.9) }
    };
  }

  function aggregate() {
    const map = new Map();
    S.times.forEach((d,i) => { const k = localKey(d); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
    S.daily = [];
    map.forEach((idx, key) => {
      if (idx.length < 18) return;
      const s = summarise(S.data, idx);
      if (!s.n) return;
      s.date = new Date(key + "T12:00:00");
      s.byModel = {};
      enabled().forEach(m => {
        const sub = {}; VARS.forEach(v => sub[v] = S.data[v].filter(x => x.model === m.id));
        if (!sub.temperature_2m.length) return;
        const ms = summarise(sub, idx);
        if (ms.n) s.byModel[m.id] = ms;
      });
      S.daily.push(s);
    });
    S.daily.sort((a,b) => a.date - b.date);
  }

  /* ── canvas plumbing ──────────────────────────────────────────────── */
  const PAD = { l:42, r:10, t:10, b:22 };
  function setup(cv) {
    const box = cv.parentElement;
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return null;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w*dpr; cv.height = h*dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    ctx.font = "9px 'IBM Plex Mono',ui-monospace,monospace";
    return { ctx, w, h };
  }
  function axes(ctx, w, h, ymin, ymax, times, fmt) {
    const faint = cssVar("--faint"), slate = cssVar("--slate");
    const px = i => PAD.l + (i/(times.length-1))*(w-PAD.l-PAD.r);
    const py = v => h - PAD.b - ((v-ymin)/(ymax-ymin))*(h-PAD.t-PAD.b);
    for (let i = 0; i <= 4; i++) {
      const v = ymin + (ymax-ymin)*i/4, y = py(v);
      ctx.strokeStyle = faint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w-PAD.r, y); ctx.stroke();
      ctx.fillStyle = slate; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(fmt(v), PAD.l-6, y);
    }
    const dayW = (w-PAD.l-PAD.r)/(times.length/24);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let last = -1;
    times.forEach((d,i) => {
      if (d.getHours() === 0 && d.getDate() !== last) {
        last = d.getDate();
        ctx.strokeStyle = faint;
        ctx.beginPath(); ctx.moveTo(px(i), PAD.t); ctx.lineTo(px(i), h-PAD.b); ctx.stroke();
        if (dayW > 30) {
          ctx.fillStyle = slate;
          ctx.fillText(d.toLocaleDateString("en-GB",{weekday:"short"}).toUpperCase(), px(i)+dayW/2, h-PAD.b+5);
        }
      }
    });
    return { px, py };
  }
  function tipEl() {
    if (!TIP) { TIP = document.createElement("div"); TIP.className = "ens-tip"; document.body.appendChild(TIP); }
    return TIP;
  }
  function hookTip(cv, n, px, text) {
    const tip = tipEl();
    const move = e => {
      const pt = e.touches ? e.touches[0] : e;
      const r = cv.getBoundingClientRect(), x = pt.clientX - r.left;
      let best = 0, bd = 1e9;
      for (let i = 0; i < n; i++) { const d = Math.abs(px(i)-x); if (d < bd) { bd = d; best = i; } }
      tip.textContent = text(best);
      tip.style.left = (r.left + px(best)) + "px";
      tip.style.top  = (r.top + r.height*0.42) + "px";
      tip.style.opacity = 1;
    };
    cv.onmousemove = move;
    cv.ontouchstart = move; cv.ontouchmove = move;
    cv.onmouseleave = () => { tip.style.opacity = 0; };
    cv.ontouchend = () => { setTimeout(() => { tip.style.opacity = 0; }, 1800); };
  }

  function spaghetti(id, varName, unit, dec, legendId, convert) {
    /* `toDisp` turns a metric value into display units. Applied to the
       plotted values and to every label, so axis, tooltip and line agree. */
    const toDisp = convert || (v => v);
    const cv = $(id); if (!cv) return;
    const g = setup(cv); if (!g) return;
    const { ctx, w, h } = g;
    const series = S.data[varName] || []; if (!series.length) return;
    const t = S.times;
    let lo = Infinity, hi = -Infinity;
    series.forEach(s => s.arr.forEach(v => { if (v != null) { const d = toDisp(v);
      if (d < lo) lo = d; if (d > hi) hi = d; } }));
    if (!isFinite(lo)) return;
    const pad = (hi-lo)*0.08 || 1; lo -= pad; hi += pad;
    const { px, py } = axes(ctx, w, h, lo, hi, t, v => v.toFixed(dec) + unit);

    const st = t.map((_,i) => {
      const col = series.map(s => s.arr[i]);
      return { mean:avg(col), p10:pct(col,.1), p90:pct(col,.9) };
    });

    ctx.beginPath(); let go = false;
    st.forEach((s,i) => { if (s.p90 == null) return; const d = toDisp(s.p90);
      go ? ctx.lineTo(px(i),py(d)) : (ctx.moveTo(px(i),py(d)), go = true); });
    for (let i = st.length-1; i >= 0; i--) if (st[i].p10 != null) ctx.lineTo(px(i), py(toDisp(st[i].p10)));
    ctx.closePath(); ctx.fillStyle = "rgba(100,116,139,.09)"; ctx.fill();

    const alpha = series.length > 90 ? 0.12 : 0.19;
    ctx.lineWidth = 0.7;
    series.forEach(s => {
      ctx.strokeStyle = hexA(s.color, alpha);
      ctx.beginPath(); let g2 = false;
      s.arr.forEach((v,i) => { if (v == null) return; const d = toDisp(v);
        g2 ? ctx.lineTo(px(i),py(d)) : (ctx.moveTo(px(i),py(d)), g2 = true); });
      ctx.stroke();
    });

    const means = {};
    enabled().forEach(m => {
      const sub = series.filter(s => s.model === m.id); if (!sub.length) return;
      const line = t.map((_,i) => avg(sub.map(s => s.arr[i])));
      means[m.id] = line;
      ctx.strokeStyle = m.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); let g3 = false;
      line.forEach((v,i) => { if (v == null) return; const d = toDisp(v);
        g3 ? ctx.lineTo(px(i),py(d)) : (ctx.moveTo(px(i),py(d)), g3 = true); });
      ctx.stroke();
    });

    ctx.strokeStyle = cssVar("--ink"); ctx.lineWidth = 2.2;
    ctx.beginPath(); let g4 = false;
    st.forEach((s,i) => { if (s.mean == null) return; const d = toDisp(s.mean);
      g4 ? ctx.lineTo(px(i),py(d)) : (ctx.moveTo(px(i),py(d)), g4 = true); });
    ctx.stroke();

    hookTip(cv, t.length, px, i => {
      let out = t[i].toLocaleString("en-GB",{weekday:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) +
                "\nALL      " + toDisp(st[i].mean).toFixed(dec) + unit +
                "\n10–90%   " + toDisp(st[i].p10).toFixed(dec) + " – " + toDisp(st[i].p90).toFixed(dec) + unit;
      enabled().forEach(m => {
        const v = means[m.id] && means[m.id][i];
        if (v != null) out += "\n" + (m.short + "        ").slice(0,8) + " " + toDisp(v).toFixed(dec) + unit;
      });
      return out;
    });

    if (legendId && $(legendId)) {
      $(legendId).innerHTML =
        enabled().filter(m => series.some(s => s.model === m.id))
          .map(m => "<span><i style='background:" + m.color + "'></i>" + m.short + "</span>").join("") +
        "<span><i style='background:var(--ink)'></i>Pooled mean</span>" +
        "<span><i style='background:rgba(100,116,139,.3);height:7px'></i>10–90%</span>";
    }
  }

  function rainChart() {
    const cv = $("ensRain"); if (!cv) return;
    const g = setup(cv); if (!g) return;
    const { ctx, w, h } = g;
    const d = S.daily; if (!d.length) return;
    const faint = cssVar("--faint"), slate = cssVar("--slate"), ink = cssVar("--ink"), hl = cssVar("--highlight");
    const maxV = Math.max(2, ...d.map(x => x.rain.p90 || 0)) * 1.15;
    const bw = (w-PAD.l-PAD.r)/d.length;
    for (let i = 0; i <= 4; i++) {
      const v = maxV*i/4, y = h - PAD.b - (v/maxV)*(h-PAD.t-PAD.b);
      ctx.strokeStyle = faint; ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(w-PAD.r,y); ctx.stroke();
      ctx.fillStyle = slate; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(U.rv(v) + U.rainUnit, PAD.l-6, y);
    }
    d.forEach((x,i) => {
      const cx = PAD.l + i*bw, y0 = h - PAD.b;
      const hp = ((x.rain.p90||0)/maxV)*(h-PAD.t-PAD.b), hm = ((x.rain.mean||0)/maxV)*(h-PAD.t-PAD.b);
      ctx.fillStyle = faint;      ctx.fillRect(cx+bw*0.14, y0-hp, bw*0.72, hp);
      ctx.fillStyle = hexA(hl,.75); ctx.fillRect(cx+bw*0.30, y0-hm, bw*0.40, hm);
      Object.keys(x.byModel).forEach(id => {
        const m = MODELS.filter(z => z.id === id)[0], v = x.byModel[id].rain.mean;
        if (v == null || !m) return;
        const y = y0 - (v/maxV)*(h-PAD.t-PAD.b);
        ctx.fillStyle = m.color; ctx.fillRect(cx+bw*0.14, y-1, bw*0.72, 1.6);
      });
      if (bw > 26) {
        ctx.fillStyle = slate; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(x.date.toLocaleDateString("en-GB",{weekday:"short"}).toUpperCase(), cx+bw/2, y0+5);
      }
    });
    ctx.strokeStyle = ink; ctx.lineWidth = 1.8; ctx.beginPath();
    d.forEach((x,i) => { const cx = PAD.l+i*bw+bw/2, y = h-PAD.b-x.rain.prob*(h-PAD.t-PAD.b); i ? ctx.lineTo(cx,y) : ctx.moveTo(cx,y); });
    ctx.stroke();
    ctx.fillStyle = ink;
    d.forEach((x,i) => {
      const cx = PAD.l+i*bw+bw/2, y = h-PAD.b-x.rain.prob*(h-PAD.t-PAD.b);
      ctx.beginPath(); ctx.arc(cx, y, 2.4, 0, 7); ctx.fill();
      if (bw > 30) { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(Math.round(x.rain.prob*100) + "%", cx, y-5); }
    });
    hookTip(cv, d.length, i => PAD.l + i*bw + bw/2, i => {
      const x = d[i];
      let s = dayName(x.date).toUpperCase() + "\n" + Math.round(x.rain.prob*100) + "% OF MEMBERS WET\nMEAN " +
              U.r(x.rain.mean) + " · P90 " + U.r(x.rain.p90);
      Object.keys(x.byModel).forEach(id => {
        const m = MODELS.filter(z => z.id === id)[0];
        s += "\n" + (m.short + "        ").slice(0,8) + " " + U.r(x.byModel[id].rain.mean) + " (" + Math.round(x.byModel[id].rain.prob*100) + "%)";
      });
      return s;
    });
  }

  /* ── tables ───────────────────────────────────────────────────────── */
  function band(score, a, b) {
    if (score < a) return ["ens-conf-hi","High"];
    if (score < b) return ["ens-conf-md","Medium"];
    return ["ens-conf-lo","Low"];
  }
  const modelGap = (day, pick) => {
    const v = Object.keys(day.byModel).map(id => pick(day.byModel[id])).filter(x => x != null);
    return v.length > 1 ? Math.max.apply(null,v) - Math.min.apply(null,v) : 0;
  };

  // Temperature: how tightly the members bunch, and whether the centres
  // agree with each other. Purely about degrees.
  function tempScore(day) {
    const spread = (day.tmax.p90 != null && day.tmax.p10 != null) ? day.tmax.p90 - day.tmax.p10 : 6;
    return spread*0.7 + modelGap(day, m => m.tmax.mean)*0.8;
  }

  // Rain is a different question: a 50/50 day is the least confident forecast
  // there is, while "certainly dry" and "certainly wet" are both high
  // confidence. Amount spread is judged relative to the mean, since 5 mm of
  // disagreement means far more on a 2 mm day than on a 20 mm one.
  function rainScore(day) {
    const amb = 1 - Math.abs(day.rain.prob - 0.5)*2;
    const base = Math.max(day.rain.mean || 0, 0.5);
    const wet = (day.rain.mean || 0) > 0.3;
    const rel = wet && day.rain.p90 != null && day.rain.p10 != null
      ? Math.min((day.rain.p90 - day.rain.p10)/base, 3) : 0;
    const mods = wet ? Math.min(modelGap(day, m => m.rain.mean)/base, 3) : 0;
    return amb*3 + rel*0.9 + mods*0.8;
  }

  const tempConfidence = day => band(tempScore(day), 3.0, 5.0);
  const rainConfidence = day => band(rainScore(day), 2.3, 3.9);

  function renderDayTable() {
    const full = enabled().length;
    const rows = S.daily.map(d => {
      const tc = tempConfidence(d), rc = rainConfidence(d);
      const cover = Object.keys(d.byModel).length;
      const partial = cover < full ? " <span class='ens-partial'>" + cover + "/" + full + "</span>" : "";
      return "<tr><td>" + dayName(d.date) + partial + "</td>" +
        "<td><span class='stat-hi'>" + U.tv(d.tmax.mean) + "°</span>" +
          "<span class='stat-at'>" + U.tv(d.tmax.p10) + "–" + U.tv(d.tmax.p90) + "° · peak " + U.tv(d.tmax.hi) + "°</span></td>" +
        "<td><span class='stat-lo'>" + U.tv(d.tmin.mean) + "°</span>" +
          "<span class='stat-at'>" + U.tv(d.tmin.p10) + "–" + U.tv(d.tmin.p90) + "° · low " + U.tv(d.tmin.lo) + "°</span></td>" +
        "<td class='" + tc[0] + "'>" + tc[1] + "</td>" +
        "<td><span class='ens-bar-mini'><span style='width:" + (d.rain.prob*100).toFixed(0) + "%'></span></span>" +
          "<span class='stat-at'>" + Math.round(d.rain.prob*100) + "% of members</span></td>" +
        "<td>" + U.rv(d.rain.mean) + "<span class='stat-at'>" + U.rv(d.rain.p10) + "–" + U.rv(d.rain.p90) + " · max " + U.rv(d.rain.max) + " " + U.rainUnit + "</span></td>" +
        "<td class='" + rc[0] + "'>" + rc[1] + "</td>" +
        "<td>" + r0(d.wind.mean) + "<span class='stat-at'>p90 " + r0(d.wind.p90) + "</span></td>" +
        "<td>" + r0(d.pres.mean) + "</td></tr>";
    }).join("");
    $("ensDayTable").innerHTML =
      "<div class='stats-table-scroll'><table class='stats-table ens-day-table'><thead><tr>" +
      "<th>Day</th><th>Max " + U.tempUnit + "</th><th>Min " + U.tempUnit + "</th><th>Temp conf</th>" +
        "<th>Rain risk</th><th>Rain " + U.rainUnit + "</th><th>Rain conf</th>" +
        "<th>Wind " + U.windUnit + "</th><th>" + U.presUnit + "</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function renderModelTable() {
    const n = Math.min(S.horizon, S.daily.length), d = S.daily.slice(0, n), rows = [];
    enabled().forEach(m => {
      const days = d.filter(x => x.byModel[m.id]); if (!days.length) return;
      rows.push({ m,
        members: S.data.temperature_2m.filter(s => s.model === m.id).length,
        tmax: avg(days.map(x => x.byModel[m.id].tmax.mean)),
        tmin: avg(days.map(x => x.byModel[m.id].tmin.mean)),
        rain: days.reduce((s,x) => s + (x.byModel[m.id].rain.mean || 0), 0),
        wind: Math.max.apply(null, days.map(x => x.byModel[m.id].wind.mean || 0)),
        pres: avg(days.map(x => x.byModel[m.id].pres.mean)),
        cover: days.length });
    });
    const tm = rows.map(r => r.tmax).filter(v => v != null);
    const hiT = Math.max.apply(null,tm), loT = Math.min.apply(null,tm);
    const html = rows.map(r => {
      const tag = tm.length > 1 && (hiT-loT) > 0.6
        ? (r.tmax === hiT ? " <span class='stat-at' style='color:var(--max-marker)'>warmest</span>"
          : r.tmax === loT ? " <span class='stat-at' style='color:var(--highlight)'>coolest</span>" : "") : "";
      return "<tr><td><span style='color:" + r.m.color + "'>■</span> " + r.m.name +
        "<span class='stat-at'>" + r.m.centre + "</span></td>" +
        "<td>" + r.members + "</td><td>" + U.tv(r.tmax) + "°" + tag + "</td><td>" + U.tv(r.tmin) + "°</td>" +
        "<td>" + U.r(r.rain) + "</td><td>" + r0(r.wind) + "</td><td>" + U.p(r.pres) + "</td>" +
        "<td>" + r.cover + "/" + n + "</td></tr>";
    }).join("");
    $("ensModelTable").innerHTML =
      "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
      "<th>Model</th><th>Members</th><th>Mean high</th><th>Mean low</th><th>Rain</th>" +
        "<th>Wind " + U.windUnit + "</th><th>" + U.presUnit + "</th><th>Days</th>" +
      "</tr></thead><tbody>" + html + "</tbody></table></div>";
  }

  /* ── written analysis ─────────────────────────────────────────────── */
  const describeTemp = t => t>=28?"hot":t>=24?"very warm":t>=20?"warm":t>=16?"pleasantly mild":t>=12?"cool":t>=7?"chilly":t>=3?"cold":"very cold";
  /* Beaufort-ish descriptions. The thresholds are mph, so convert whatever
     unit the API returned before comparing — otherwise a 45 km/h breeze gets
     called "gale-force". */
  const TO_MPH = { mph: 1, kmh: 0.621371, ms: 2.23694, kn: 1.15078 };
  const describeWind = w => {
    if (w == null) return "";
    const m = w * (TO_MPH[String((CFG.units && CFG.units.wind) || "mph").toLowerCase()] || 1);
    return m>=45?"gale-force":m>=32?"very strong":m>=24?"blustery":m>=16?"moderate":m>=9?"light":"near-calm";
  };
  function spreadWord(s) {
    if (s < 2)   return ["very high","the members are tightly clustered"];
    if (s < 3.5) return ["high","the members agree closely"];
    if (s < 5.5) return ["moderate","there is a noticeable fan in the members"];
    if (s < 8)   return ["low","the members diverge substantially"];
    return ["very low","the members have effectively lost agreement"];
  }

  function buildAnalysis(n) {
    const d = S.daily.slice(0, n); if (!d.length) return "";
    const nm = enabled().filter(m => S.data.temperature_2m.some(s => s.model === m.id));
    const totalMembers = S.data.temperature_2m.length;
    const tmax = avg(d.map(x => x.tmax.mean)), tmin = avg(d.map(x => x.tmin.mean));
    const warmest = d.reduce((a,b) => b.tmax.mean > a.tmax.mean ? b : a);
    const coldest = d.reduce((a,b) => b.tmax.mean < a.tmax.mean ? b : a);
    const totalMean = d.reduce((s,x) => s + (x.rain.mean||0), 0);
    const totalP90  = d.reduce((s,x) => s + (x.rain.p90 ||0), 0);
    const wettest = d.reduce((a,b) => b.rain.prob > a.rain.prob ? b : a);
    const dryDays = d.filter(x => x.rain.prob < 0.25).length;
    const wetDays = d.filter(x => x.rain.prob >= 0.6).length;
    const windiest = d.reduce((a,b) => b.wind.mean > a.wind.mean ? b : a);
    const spread = avg(d.map(x => x.tmax.p90 - x.tmax.p10));
    const sw = spreadWord(spread);
    const envHi = Math.max.apply(null, d.map(x => x.tmax.hi).filter(v => v != null));
    const envLo = Math.min.apply(null, d.map(x => x.tmin.lo).filter(v => v != null));
    const envRain = Math.max.apply(null, d.map(x => x.rain.max || 0));
    const tHi = d.filter(x => tempConfidence(x)[1] === "High").length;
    const rHi = d.filter(x => rainConfidence(x)[1] === "High").length;
    const rLo = d.filter(x => rainConfidence(x)[1] === "Low").length;
    // headline rating comes from the same per-day scores as the table, so the
    // two can never contradict each other
    const combined = avg(d.map(x => tempScore(x)*0.55 + rainScore(x)*0.45));
    const headline = combined < 2.6 ? "high" : combined < 4.0 ? "moderate" : "low";
    const dp = d[d.length-1].pres.mean - d[0].pres.mean;
    const meanP = avg(d.map(x => x.pres.mean));
    const presSpread = avg(d.map(x => x.pres.p90 - x.pres.p10));

    const regime = meanP >= 1020 ? "high pressure is in charge, so the period leans settled"
      : meanP >= 1010 ? "pressure sits close to average — a mixed, changeable regime"
      : "low pressure dominates, so expect an unsettled Atlantic feed";
    const trend = Math.abs(dp) < 3 ? "Pressure holds roughly steady across the period."
      : dp > 0 ? "Pressure builds by about " + U.dp(dp) + "  through the period, so conditions should turn quieter later on."
      : "Pressure falls by about " + U.dp(Math.abs(dp)) + "  through the period, so things should turn more unsettled later on.";

    const perModel = nm.map(m => {
      const days = d.filter(x => x.byModel[m.id]);
      return days.length ? { m,
        tmax: avg(days.map(x => x.byModel[m.id].tmax.mean)),
        rain: days.reduce((s,x) => s + (x.byModel[m.id].rain.mean||0), 0) } : null;
    }).filter(Boolean);

    let agree = "";
    if (perModel.length > 1) {
      const hi = perModel.reduce((a,b) => b.tmax > a.tmax ? b : a), lo = perModel.reduce((a,b) => b.tmax < a.tmax ? b : a);
      const gap = hi.tmax - lo.tmax;
      const rHi = perModel.reduce((a,b) => b.rain > a.rain ? b : a), rLo = perModel.reduce((a,b) => b.rain < a.rain ? b : a);
      const rGap = rHi.rain - rLo.rain;
      agree = "<p><b>Model agreement.</b> " + perModel.length + " forecast centres are in this pool. " +
        (gap < 0.8 ? "On temperature they are effectively saying the same thing (within " + U.dt(gap) + " of each other), which is a strong signal — independent models converging matters more than any single ensemble looking confident. "
         : gap < 2 ? "On temperature they sit within " + U.dt(gap) + " of each other — normal, healthy scatter, with " + hi.m.short + " the warmest and " + lo.m.short + " the coolest. "
         : "On temperature they differ by " + U.dt(gap) + " — <b>" + hi.m.short + " is materially warmer than " + lo.m.short + "</b>. That is a real disagreement about the pattern, not rounding, so treat the headline numbers as provisional. ") +
        (rGap < 3 ? "Rainfall totals are similarly consistent across centres."
         : rGap < 8 ? "Rainfall totals vary a little more — " + U.r(rHi.rain) + " from " + rHi.m.short + " against " + U.r(rLo.rain) + " from " + rLo.m.short + ", which is ordinary scatter over this range."
         : "Rainfall is where they really part company: " + rHi.m.short + " gives about " + U.r(rHi.rain) + " against just " + U.r(rLo.rain) + " from " + rLo.m.short + " — a big enough split that any specific rain plan should be checked again nearer the time.") +
        "</p>";
    }

    let out = "<p><b>Overview.</b> Pooling <b>" + totalMembers + " members</b> from " + nm.map(m => m.short).join(", ") +
      ", the next " + n + " days give daytime highs averaging " + U.t(tmax) + " and overnight lows around " + U.t(tmin) +
      " — broadly " + describeTemp(tmax) + " for the time of year. The warmest day looks like <b>" + dayName(warmest.date) +
      "</b> at about " + U.t(warmest.tmax.mean) +
      (Math.abs(warmest.tmax.mean - coldest.tmax.mean) > 2
        ? ", the coolest <b>" + dayName(coldest.date) + "</b> near " + U.t(coldest.tmax.mean) + ". "
        : ", with little day-to-day variation. ") +
      "Taking every member at its word, the outright envelope runs from a low of <b>" + U.t(envLo) +
      "</b> to a high of <b>" + U.t(envHi) + "</b>, with the wettest single day on any member reaching " +
      U.r(envRain) + " — those are the outer edges, not the likely outcome. " +
      "Synoptically, " + regime + ".</p>";

    out += "<p><b>Rainfall.</b> The pooled members put roughly <b>" + U.r(totalMean) + "</b> on the period as a whole" +
      (totalP90 > totalMean*1.6 ? ", though the wetter 10% of members go as high as " + U.r(totalP90) + " — the risk is skewed towards more rain than the mean suggests. " : ". ") +
      (wetDays ? "There " + (wetDays === 1 ? "is 1 day" : "are " + wetDays + " days") + " where a clear majority of members are wet" : "No single day has a clear wet signal") +
      (dryDays ? ", and " + dryDays + " that look reliably dry. " : ". ") +
      "The wettest signal is on <b>" + dayName(wettest.date) + "</b>, where " + Math.round(wettest.rain.prob*100) + "% of members produce measurable rain" +
      (wettest.rain.probHeavy > 0.25 ? " and " + Math.round(wettest.rain.probHeavy*100) + "% produce " + U.r(5) + " or more — worth watching." : ".") + "</p>";

    out += "<p><b>Wind.</b> Winds are mostly " + describeWind(avg(d.map(x => x.wind.mean))) + ", peaking around " +
      r0(windiest.wind.mean) + " mph on <b>" + dayName(windiest.date) + "</b>" +
      (windiest.wind.p90 >= 32 ? " — and the windier members reach " + r0(windiest.wind.p90) + " mph, so a genuinely disruptive day cannot be ruled out." : ".") +
      " " + trend + "</p>";

    out += agree;

    out += "<p><b>Confidence: " + headline + ".</b> Across the period the pooled member range on daily maxima is about " +
      U.dt(spread) + " — " + sw[1] + ". " +
      (tHi === 0 && rHi === 0
        ? "Day by day, no single day earns a high-confidence rating for either temperature or rainfall. "
        : "Day by day, temperature rates high-confidence on <b>" + tHi + " of " + d.length + "</b> days against <b>" +
          rHi + "</b> for rainfall" +
          (tHi > rHi ? " — the usual pattern, since how warm it gets is far more predictable than whether a shower crosses this particular field. "
           : rHi > tHi ? " — unusually, the rain signal is the firmer of the two here. " : ". ")) +
      (rLo ? "There " + (rLo === 1 ? "is 1 day" : "are " + rLo + " days") + " where the rain outcome is close to a coin toss. " : "") +
      (presSpread > 12 ? "Pressure spread is wide too, which usually signals genuine disagreement about where Atlantic systems will sit rather than just timing noise. "
                       : "Pressure spread is modest, so the members are arguing about detail rather than the overall pattern. ") +
      (n >= 10 ? "At day 8–10 the useful signal is the pattern — broadly settled or unsettled, warmer or colder than normal — not individual days. Treat specific rain timings here as placeholders."
       : n >= 7 ? "Days 1–4 should be reliable; days 5–7 are best read as a trend rather than a plan."
       : "This is the most reliable part of the forecast — day-to-day detail here is usable.") + "</p>";
    return out;
  }

  function buildKpis(n) {
    const d = S.daily.slice(0, n); if (!d.length) return "";
    const total = d.reduce((s,x) => s + (x.rain.mean||0), 0);
    const wet = d.filter(x => x.rain.prob >= 0.5).length;
    const wind = Math.max.apply(null, d.map(x => x.wind.mean || 0));
    const combined = avg(d.map(x => tempScore(x)*0.55 + rainScore(x)*0.45));
    const conf = combined < 2.6 ? "high" : combined < 4.0 ? "moderate" : "low";
    const envHi = Math.max.apply(null, d.map(x => x.tmax.hi).filter(v => v != null));
    const envLo = Math.min.apply(null, d.map(x => x.tmin.lo).filter(v => v != null));
    return [
      ["Mean high", U.t(avg(d.map(x => x.tmax.mean)))],
      ["Envelope", U.tv(envLo,0) + "–" + U.tv(envHi,0) + U.tempUnit],
      ["Total rain", U.r(total)],
      ["Wet days", wet + "/" + d.length],
      ["Peak wind", U.w(wind)],
      ["Members", String(S.data.temperature_2m.length)],
      ["Confidence", conf]
    ].map(k => "<div class='ens-kpi'><b>" + k[1] + "</b><span>" + k[0] + "</span></div>").join("");
  }

  function renderAnalysis() {
    const n = Math.min(S.horizon, S.daily.length);
    $("ensHorizonLabel").textContent = n;
    $("ensKpis").innerHTML = buildKpis(n);
    $("ensAnalysis").innerHTML = buildAnalysis(n);
    renderModelTable();
  }

  function renderAll() {
    spaghetti("ensTemp", "temperature_2m", U.tempUnit, 1, "ensLegend", U.axisTemp);
    rainChart();
    spaghetti("ensWind", "wind_speed_10m", " " + U.windUnit, 0);
    spaghetti("ensPres", "pressure_msl", " " + U.presUnit, U.presUnit === "inHg" ? 2 : 0, null,
              v => U.presUnit === "inHg" ? U.conv.mb2inhg(v) : v);
    renderDayTable();
    renderAnalysis();
  }

  function fail(e, url) {
    const st = $("ensStatus");
    st.className = "ens-status err";
    const isFile = location.protocol === "file:";
    const net = /Failed to fetch|NetworkError|Load failed|CORS/i.test(e.message);
    st.innerHTML = "ENSEMBLE DATA UNAVAILABLE — " + e.message.toUpperCase() + "<br>" +
      (net && isFile ? "This page is running from file:// — browsers block outbound requests from local files. Serve it over http to load ensemble data."
       : net ? "The request was blocked before reaching open-meteo.com. Check for an ad-blocker, VPN or network filter, or try the raw URL."
       : "The service may be briefly overloaded.") +
      "<br><button id='ensRetry'>RETRY</button><a href='" + url + "' target='_blank' rel='noopener'><button>RAW URL</button></a>";
    const b = $("ensRetry"); if (b) b.onclick = load;
  }

  /* ── events ───────────────────────────────────────────────────────── */
  document.addEventListener("click", e => {
    const chip = e.target.closest && e.target.closest(".ens-model");
    if (chip && !S.loading) {
      const m = MODELS.filter(x => x.id === chip.dataset.id)[0];
      if (m && !(m.on && enabled().length === 1)) { m.on = !m.on; renderChips(); load(); }
      return;
    }
    const hb = e.target.closest && e.target.closest("#ensHorizon button");
    if (hb) {
      Array.prototype.forEach.call($("ensHorizon").children, x => x.classList.remove("active"));
      hb.classList.add("active");
      S.horizon = +hb.dataset.n;
      if (S.loaded) renderAnalysis();
    }
  });

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const pane = $("paneEnsemble");
      if (S.loaded && pane && pane.classList.contains("active")) renderAll();
    }, 200);
  });

  return {
    open: function () {
      renderChips();
      if (!S.loaded && !S.loading) load();
      else if (S.loaded) renderAll();   // pane was display:none, canvases need redrawing
    },
    refresh: load,
    ready: () => S.loaded,
    daily: () => S.daily,
    times: () => S.times,
    series: v => S.data[v] || [],
    models: () => enabled().map(m => ({ id:m.id, short:m.short, name:m.name, color:m.color })),
    // used by the Forecast tab: guarantees data is present, loading it if the
    // ensemble tab has never been opened
    ensure: async function () {
      if (!S.loaded) {
        if (S.loading) {
          while (S.loading) await new Promise(r => setTimeout(r, 120));
        } else {
          await load();
        }
      }
      return S.daily;
    }
  };
})();
