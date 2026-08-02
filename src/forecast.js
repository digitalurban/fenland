/*
   FORECAST TAB (rebuilt) — Open-Meteo best-match deterministic forecast,
   hourly out to 16 days, cross-checked against the pooled ensemble.
   Replaces the old Aeris rendering; the original renderForecast() and its
   markup are left in the page but hidden, so rollback is trivial.
   Self-contained IIFE; the only global it defines is window.__FORECAST2__.
 */

window.__FORECAST2__ = (function () {
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
  const HOURLY_VARS = ["temperature_2m","apparent_temperature","precipitation","precipitation_probability",
    "weather_code","wind_speed_10m","wind_gusts_10m","wind_direction_10m","relative_humidity_2m",
    "dew_point_2m","pressure_msl","uv_index","cloud_cover","is_day"];
  const DAILY_VARS = ["weather_code","temperature_2m_max","temperature_2m_min","apparent_temperature_max",
    "apparent_temperature_min","sunrise","sunset","uv_index_max","precipitation_sum",
    "precipitation_probability_max","wind_speed_10m_max","wind_gusts_10m_max","wind_direction_10m_dominant"];

  const S = { hourly: [], daily: [], loaded: false, loading: false, openDay: null, cross: null, span: 48, model: null };

  /* ── helpers ──────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const r1 = v => v == null ? "–" : (Math.round(v*10)/10).toFixed(1);
  const r0 = v => v == null ? "–" : String(Math.round(v));
  const ord = n => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
  const pad2 = n => String(n).padStart(2, "0");
  const localKey = d => d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  const hhmm = d => d ? d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", hour12:false }) : "–";
  const avg = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; };
  function pctl(arr, p) {
    const a = arr.filter(v => v != null && !isNaN(v)).sort((x,y) => x-y);
    if (!a.length) return null;
    const i = (a.length-1)*p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi]-a[lo])*(i-lo);
  }
  // Open-Meteo renamed several fields; accept old and new spellings alike
  const pick = (obj, ...names) => { for (const n of names) if (obj && obj[n]) return obj[n]; return null; };

  /* ── WMO weather codes ────────────────────────────────────────────── */
  const WMO = {
    0:"Clear sky", 1:"Mainly clear", 2:"Partly cloudy", 3:"Overcast",
    45:"Fog", 48:"Depositing rime fog",
    51:"Light drizzle", 53:"Moderate drizzle", 55:"Dense drizzle",
    56:"Light freezing drizzle", 57:"Dense freezing drizzle",
    61:"Slight rain", 63:"Moderate rain", 65:"Heavy rain",
    66:"Light freezing rain", 67:"Heavy freezing rain",
    71:"Slight snow", 73:"Moderate snow", 75:"Heavy snow", 77:"Snow grains",
    80:"Slight rain showers", 81:"Moderate rain showers", 82:"Violent rain showers",
    85:"Slight snow showers", 86:"Heavy snow showers",
    95:"Thunderstorm", 96:"Thunderstorm with hail", 99:"Thunderstorm with heavy hail"
  };
  const wmoText = c => (c == null ? "" : (WMO[c] || "Unsettled"));

  /* ── temperature colour scale ─────────────────────────────────────── */
  // The scale itself lives in window.__WXCOLOURS__ so the history charts and
  // this one can never drift apart. Edit it there, not here.
  const scale = () => (window.__WXCOLOURS__ && window.__WXCOLOURS__.TEMP_SCALE) || [];
    /* zone thresholds must be in the same units as the plotted data */
  const tempZones = () => (window.__WXCOLOURS__ ? window.__WXCOLOURS__.zonesFor("Temperature") : []);
  function renderTempKey() {
    const k = $("fcTempKey"); if (!k) return;
    const s = scale();
    k.innerHTML = s.length
      ? "<span class='cap'>" + U.tempUnit + "</span>" +
        s.map(z => "<span><i style='background:" + z.c + "'></i><b>" + z.lbl + "</b></span>").join("")
      : "";
  }
  const glyph = (code, isDay) => (typeof forecastGlyphSvg === "function")
    ? forecastGlyphSvg(wmoText(code), isDay !== false && isDay !== 0) : "";

  function arrowSvg(deg) {
    if (deg == null) return "";
    // Open-Meteo reports the direction wind comes FROM; point where it goes
    return "<svg class='fc-arrow' viewBox='0 0 24 24' style='transform:rotate(" + ((deg+180)%360) + "deg)'>" +
           "<path d='M12 2 L12 22 M12 22 L7 15 M12 22 L17 15' fill='none' stroke='var(--graphite)' " +
           "stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/></svg>";
  }
  const compass = deg => deg == null ? "" :
    ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(deg/22.5) % 16];
  /* Beaufort-ish descriptions. The thresholds are mph, so convert whatever
     unit the API returned before comparing — otherwise a 45 km/h breeze gets
     called "gale-force". */
  const TO_MPH = { mph: 1, kmh: 0.621371, ms: 2.23694, kn: 1.15078 };
  const describeWind = w => {
    if (w == null) return "";
    const m = w * (TO_MPH[String((CFG.units && CFG.units.wind) || "mph").toLowerCase()] || 1);
    return m>=45?"gale-force":m>=32?"very strong":m>=24?"blustery":m>=16?"moderate":m>=9?"light":"near-calm";
  };
  const uvBand = u => u == null ? "" : u >= 8 ? "very high" : u >= 6 ? "high" : u >= 3 ? "moderate" : "low";

  /* ── load ─────────────────────────────────────────────────────────── */
  function url() {
    // cache-buster: without it a browser can serve a stale response for the
    // whole session and the forecast silently stops updating
    return "https://api.open-meteo.com/v1/forecast?latitude=" + LAT.toFixed(4) + "&longitude=" + LON.toFixed(4) +
      "&hourly=" + HOURLY_VARS.join(",") + "&daily=" + DAILY_VARS.join(",") +
      "&timezone=" + TZ + "&wind_speed_unit=" + WIND_UNIT + "&forecast_days=16&cacheburst=" + Date.now();
  }

  /* ── what the station has actually recorded today ─────────────────── */
  // Reads the page's own live data so the forecast can be held to account
  // against the Davis. Both sources are optional.
  function observedToday() {
    let obs = null, cur = null;
    try {
      if (typeof weewxSummaryData !== "undefined" && weewxSummaryData && weewxSummaryData.day) {
        const o = weewxSummaryData.day["max temperature"];
        const v = o && parseFloat(o.value);
        if (v != null && !isNaN(v)) obs = { v: v, at: (o.at || "") };
      }
    } catch (e) {}
    try {
      if (typeof data !== "undefined" && data && data.outTemp_C != null) {
        const v = parseFloat(data.outTemp_C);
        if (!isNaN(v)) cur = v;
      }
    } catch (e) {}
    if (cur != null && (obs == null || cur > obs.v)) obs = { v: cur, at: "just now" };
    return { max: obs, cur: cur };
  }

  async function load() {
    if (S.loading) return;
    S.loading = true;
    const st = $("fcStatus");
    st.className = "fc-status"; st.textContent = "LOADING FORECAST…";
    try {
      const res = await fetch(url(), { cache: "no-store" });
      if (!res.ok) throw new Error("API returned " + res.status);
      const j = await res.json();
      if (!j.hourly || !j.hourly.time || !j.hourly.time.length)
          throw new Error("forecast API returned no hourly data for this location");

      const h = j.hourly;
      const g = (...names) => pick(h, ...names) || [];
      const temp = g("temperature_2m"), feel = g("apparent_temperature"),
            prcp = g("precipitation"), pop = g("precipitation_probability"),
            code = g("weather_code","weathercode"), wind = g("wind_speed_10m","windspeed_10m"),
            gust = g("wind_gusts_10m","windgusts_10m"), wdir = g("wind_direction_10m","winddirection_10m"),
            rh = g("relative_humidity_2m","relativehumidity_2m"), dew = g("dew_point_2m","dewpoint_2m"),
            pres = g("pressure_msl"), uv = g("uv_index"), cloud = g("cloud_cover","cloudcover"),
            isDay = g("is_day");

      S.hourly = h.time.map((t, i) => ({
        t: new Date(t), temp: temp[i], feels: feel[i], mm: prcp[i], pop: pop[i], code: code[i],
        wind: wind[i], gust: gust[i], dir: wdir[i], rh: rh[i], dew: dew[i], pres: pres[i],
        uv: uv[i], cloud: cloud[i], isDay: isDay[i] !== 0
      }));

      const d = j.daily || {};
      const dg = (...names) => pick(d, ...names) || [];
      const dmax = dg("temperature_2m_max"), dmin = dg("temperature_2m_min"),
            fmax = dg("apparent_temperature_max"), fmin = dg("apparent_temperature_min"),
            dcode = dg("weather_code","weathercode"), dsum = dg("precipitation_sum"),
            dpop = dg("precipitation_probability_max"), dwind = dg("wind_speed_10m_max","windspeed_10m_max"),
            dgust = dg("wind_gusts_10m_max","windgusts_10m_max"), ddir = dg("wind_direction_10m_dominant","winddirection_10m_dominant"),
            duv = dg("uv_index_max"), dsun = dg("sunrise"), dset = dg("sunset");

      S.daily = (d.time || []).map((t, i) => ({
        t: new Date(t + "T12:00:00"), key: t,
        tmax: dmax[i], tmin: dmin[i], feelsMax: fmax[i], feelsMin: fmin[i],
        code: dcode[i], mm: dsum[i], pop: dpop[i], wind: dwind[i], gust: dgust[i], dir: ddir[i],
        uv: duv[i], sunrise: dsun[i] ? new Date(dsun[i]) : null, sunset: dset[i] ? new Date(dset[i]) : null
      }));

      S.model = j.model || "best match";
      S.loaded = true; S.loading = false;
      S.fetchedAt = Date.now();
      st.textContent = S.daily.length + " DAYS · " + S.hourly.length + " HOURLY STEPS · OPEN-METEO BEST MATCH · " +
        (j.elevation != null ? "ELEVATION " + Math.round(j.elevation) + " M · " : "") +
        "FETCHED " + new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}) +
        " · SOURCE UPDATES HOURLY";
      renderAll();
      crossCheck();
    } catch (e) {
      S.loading = false;
      console.warn("Forecast unavailable:", e);
      st.className = "fc-status err";
      st.innerHTML = "FORECAST UNAVAILABLE — " + String(e.message).toUpperCase() +
        (location.protocol === "file:"
          ? "<br>This page is running from file:// — browsers block outbound requests from local files."
          : "<br>api.open-meteo.com could not be reached. Check for an ad-blocker, VPN or network filter.");
    }
  }

  /* ── the hour we are currently in ─────────────────────────────────── */
  function fromNow() {
    const now = Date.now() - 3600000;
    const i = S.hourly.findIndex(p => p.t.getTime() >= now);
    return i < 0 ? S.hourly : S.hourly.slice(i);
  }

  /* ── headline card ────────────────────────────────────────────────── */
  function renderNow() {
    const d0 = S.daily[0]; if (!d0) return;
    const cur = fromNow()[0] || S.hourly[0];
    const obs = observedToday();
    const facts = [];
    const push = (k, v, s) => { if (v != null && v !== "") facts.push({k, v, s}); };
    if (obs.max) push("Station so far", U.t(obs.max.v), obs.max.at ? "max " + obs.max.at : "observed");
    push("Wind", d0.wind != null ? r0(d0.wind) + " mph" : null,
         (compass(d0.dir) || "") + (d0.gust != null ? " · gust " + r0(d0.gust) : ""));
    push("Rain", d0.pop != null ? r0(d0.pop) + "%" : null,
         d0.mm != null ? U.r(d0.mm) + " expected" : "chance");
    push("Humidity", cur && cur.rh != null ? r0(cur.rh) + "%" : null,
         cur && cur.dew != null ? "dew " + U.t(cur.dew, 0) : "");
    push("UV index", d0.uv != null ? r1(d0.uv) : null, uvBand(d0.uv));
    push("Daylight", d0.sunrise && d0.sunset ? hhmm(d0.sunrise) + "–" + hhmm(d0.sunset) : null,
         d0.sunrise && d0.sunset ? r1((d0.sunset - d0.sunrise)/3600000) + " hours" : "");

    $("fcNow").innerHTML =
      "<div class='fc-now-glyph'>" + glyph(d0.code, true) + "</div>" +
      "<div class='fc-now-main'>" +
        "<div class='fc-now-head'>Today</div>" +
        "<div class='fc-now-temp'>" + U.tv(d0.tmax,0) + "°<span class='lo'>/ " + U.tv(d0.tmin,0) + "°</span></div>" +
        "<div class='fc-now-desc'>" + wmoText(d0.code) + "</div>" +
      "</div>" +
      "<div class='fc-now-facts'>" +
        facts.map(f => "<div class='fc-fact'><div class='k'>" + f.k + "</div><div class='v'>" + f.v +
                       "</div><div class='s'>" + (f.s || "") + "</div></div>").join("") +
      "</div>" +
      beatenWarning(d0, obs);
  }

  // If the Davis has already passed the model's high for today, say so
  // plainly rather than leaving two contradictory numbers on the page.
  function beatenWarning(d0, obs) {
    if (!obs.max || d0.tmax == null) return "";
    const gap = obs.max.v - d0.tmax;
    if (gap < 1) return "";
    return "<div class='fc-warn'>⚠ The station has already reached <b>" + U.t(obs.max.v) + "</b>, " +
      U.dt(gap) + " above today's forecast high of " + U.t(d0.tmax) + ". " +
      (gap >= 3
        ? "A gap this large usually means the model is carrying too much soil moisture: it assumes energy goes into evaporating water that, in a drought, simply is not there — so it under-forecasts the maximum."
        : "Treat today's remaining figures as a floor rather than a forecast.") + "</div>";
  }

  /* ── ensemble overlay ─────────────────────────────────────────────── */
  let ENS_CACHE = null;
  function ensHourly() {
    if (ENS_CACHE) return ENS_CACHE;
    const E = window.__ENSEMBLE__;
    if (!E || typeof E.times !== "function") return null;
    const times = E.times(), tSeries = E.series("temperature_2m");
    if (!times || !times.length || !tSeries.length) return null;
    const out = { times: times, temp: [], rain: [], wet: [] };
    const rSeries = E.series("precipitation");
    for (let i = 0; i < times.length; i++) {
      const tc = tSeries.map(s => s.arr[i]);
      out.temp.push({ mean: avg(tc), p10: pctl(tc, .1), p90: pctl(tc, .9) });
      const rc = rSeries.map(s => s.arr[i]).filter(v => v != null);
      out.rain.push(avg(rc));
      out.wet.push(rc.length ? rc.filter(v => v >= 0.1).length/rc.length : null);
    }
    ENS_CACHE = out;
    return out;
  }

  /* ── chart ────────────────────────────────────────────────────────── */
  async function renderChart() {
    const el = $("fcChart");
    const hrs = fromNow().slice(0, S.span);
    const title = $("fcChartTitle");
    if (!hrs.length) { el.innerHTML = "<div class='chart-loading'>No hourly data</div>"; return; }
    try {
      if (typeof ensureHighcharts === "function") await ensureHighcharts();
      if (typeof themeHighcharts === "function") themeHighcharts();
      if (typeof Highcharts === "undefined") throw new Error("Highcharts unavailable");
    } catch (e) {
      el.innerHTML = "<div class='chart-loading'>Chart unavailable — " + e.message + "</div>";
      return;
    }

    const t = hrs.map(p => p.t.getTime());
    /* Charts plot DISPLAY units — the axis is labelled in them, so the data
       has to be converted too. Everything above this point is metric. */
    const temp = hrs.map(p => [p.t.getTime(), U.axisTemp(p.temp)]);
    const feel = hrs.map(p => [p.t.getTime(), U.axisTemp(p.feels)]);
    const rain = hrs.map(p => [p.t.getTime(), U.axisRain(p.mm == null ? 0 : p.mm)]);
    const pop  = hrs.map(p => [p.t.getTime(), p.pop]);

    // ensemble 10-90% band for context — uncertainty visibly widening with range
    const ens = ensHourly();
    const eLo = [], eHi = [];
    if (ens) {
      const a = t[0], b = t[t.length-1];
      ens.times.forEach((d, i) => {
        const ts = d.getTime();
        if (ts < a || ts > b) return;
        eLo.push([ts, ens.temp[i].p10]);
        eHi.push([ts, ens.temp[i].p90]);
      });
    }

    // shade the dark hours
    const bands = [];
    S.daily.forEach(d => {
      if (d.sunset && d.sunrise) {
        const from = d.sunset.getTime(), to = from + 24*3600000;
        if (to >= t[0] && from <= t[t.length-1]) bands.push({ from: from, to: d.sunrise.getTime() + 24*3600000, color: "rgba(100,116,139,.06)" });
      }
    });

    const days = Math.round((t[t.length-1] - t[0])/86400000);
    if (title) title.innerHTML = (days >= 2 ? "Next " + days + " days" : "Next " + hrs.length + " hours") +
      " · temperature, feels-like, rainfall &amp; probability" +
      (eHi.length ? " <span style='color:var(--mist);text-transform:none;letter-spacing:0'>— with the ensemble 10–90% band</span>" : "");

    const series = [
      { name: "Temperature", data: temp, type: "spline", lineWidth: 2.8, zIndex: 5,
        color: "#0ea5e9", zoneAxis: "y", zones: tempZones(),
        tooltip: { valueSuffix: " " + U.tempUnit, valueDecimals: 1 } },
      { name: "Feels like", data: feel, type: "spline", dashStyle: "ShortDash", color: "#94a3b8",
        lineWidth: 1.5, zIndex: 4, tooltip: { valueSuffix: " " + U.tempUnit, valueDecimals: 1 } },
      { name: "Rainfall", data: rain, type: "column", yAxis: 1, color: "#2563eb", borderWidth: 0, zIndex: 2,
        tooltip: { valueSuffix: " " + U.rainUnit, valueDecimals: 1 } },
      { name: "Chance of rain", data: pop, type: "spline", yAxis: 2, dashStyle: "Dot", color: "#d97706",
        lineWidth: 1.5, zIndex: 3, tooltip: { valueSuffix: " %", valueDecimals: 0 } }
    ];
    if (eHi.length) {
      series.push({ name: "Ensemble 10–90%", data: eHi, type: "line", color: "rgba(100,116,139,.45)",
        lineWidth: 1, dashStyle: "Dot", zIndex: 1, tooltip: { valueSuffix: " " + U.tempUnit, valueDecimals: 1 } });
      series.push({ data: eLo, type: "line", linkedTo: ":previous", color: "rgba(100,116,139,.45)",
        lineWidth: 1, dashStyle: "Dot", zIndex: 1, tooltip: { valueSuffix: " " + U.tempUnit, valueDecimals: 1 } });
    }

    // Highcharts renders at the height given in its config, so the chart has
    // to be sized here rather than in CSS
    const w = window.innerWidth || 1200;
    const chartH = w < 560 ? 230 : w < 1024 ? 260 : 300;
    el.style.height = chartH + "px";

    Highcharts.chart("fcChart", {
      chart: { height: chartH },
      xAxis: { type: "datetime", plotBands: bands, crosshair: true,
               labels: { format: S.span > 72 ? "{value:%a %e}" : "{value:%a %H}" } },
      yAxis: [
        { title: { text: U.tempUnit } },
        { title: { text: U.rainUnit }, opposite: true, min: 0, gridLineWidth: 0 },
        { min: 0, max: 100, opposite: true, visible: false }
      ],
      tooltip: { shared: true, xDateFormat: "%A %e %B, %H:%M" },
      legend: { enabled: true },
      plotOptions: { column: { pointPadding: 0.02, groupPadding: 0.06 }, series: { animation: false } },
      series: series
    });
    renderTempKey();
  }

  /* ── hourly strip ─────────────────────────────────────────────────── */
  function renderHours() {
    const hrs = fromNow().slice(0, 24);
    const ht = $("fcHoursTitle");
    if (ht) ht.textContent = "Hour by hour · next " + hrs.length + " hours";
    if (!hrs.length) { $("fcHours").innerHTML = "<div class='chart-loading'>No hourly data</div>"; return; }
    $("fcHours").innerHTML = hrs.map(p =>
      "<div class='fc-hour" + (p.isDay ? "" : " night") + "'>" +
        "<div class='h-t'>" + hhmm(p.t) + "</div>" +
        "<div class='h-g'>" + glyph(p.code, p.isDay) + "</div>" +
        "<div class='h-c'>" + U.tv(p.temp,0) + "°</div>" +
        (p.feels != null && p.temp != null && Math.abs(p.feels - p.temp) >= 1
          ? "<div class='h-f'>feels " + U.tv(p.feels,0) + "°</div>" : "<div class='h-f'>&nbsp;</div>") +
        (p.wind != null ? "<div class='h-w'>" + arrowSvg(p.dir) + r0(p.wind) + "</div>" : "") +
        (p.pop != null ? "<div class='h-p" + (p.pop < 5 ? " dry" : "") + "'>" + r0(p.pop) + "%</div>" : "") +
      "</div>").join("");
  }

  /* ── day cards ────────────────────────────────────────────────────── */
  function renderDays() {
    const days = S.daily.slice(0, 14);
    if (!days.length) { $("fcDays").innerHTML = "<div class='chart-loading'>No daily data</div>"; return; }
    const top = Math.max.apply(null, days.map(d => d.tmax).filter(v => v != null));
    const bot = Math.min.apply(null, days.map(d => d.tmin).filter(v => v != null));
    const span = Math.max(top - bot, 1);

    $("fcDays").innerHTML = days.map((p, i) => {
      const left = p.tmin != null ? ((p.tmin - bot)/span)*100 : 0;
      const width = (p.tmax != null && p.tmin != null) ? Math.max(((p.tmax - p.tmin)/span)*100, 4) : 0;
      return "<div class='fc-day" + (S.openDay === i ? " open" : "") + "' data-i='" + i + "'>" +
        "<div class='d-n'>" + p.t.toLocaleDateString("en-GB",{weekday:"short"}).toUpperCase() + "</div>" +
        "<div class='d-d'>" + p.t.toLocaleDateString("en-GB",{day:"numeric",month:"short"}) + "</div>" +
        "<div class='d-g'>" + glyph(p.code, true) + "</div>" +
        "<div class='d-t'><span class='hi'>" + U.tv(p.tmax,0) + "°</span> <span class='lo'>" + U.tv(p.tmin,0) + "°</span></div>" +
        "<div class='fc-range'><span style='left:" + left.toFixed(1) + "%;width:" + width.toFixed(1) + "%'></span></div>" +
        "<div class='d-p'>" + (p.pop != null ? r0(p.pop) + "%" : "–") + (p.mm ? " · " + r1(p.mm) + "mm" : "") + "</div>" +
        (p.gust != null || p.wind != null ? "<div class='d-w'>" + r0(p.gust != null ? p.gust : p.wind) + " mph</div>" : "") +
      "</div>";
    }).join("");
    renderDetail();
  }

  function renderDetail() {
    const el = $("fcDetail");
    if (S.openDay == null || !S.daily[S.openDay]) { el.className = "fc-detail"; el.innerHTML = ""; return; }
    const p = S.daily[S.openDay];
    const hrs = S.hourly.filter(h => localKey(h.t) === p.key);

    const facts = [];
    const push = (k, v, s) => { if (v != null && v !== "" && v !== "–") facts.push([k, v, s || ""]); };
    push("High / low", U.t(p.tmax) + " / " + U.t(p.tmin),
         p.feelsMax != null ? "feels " + U.tv(p.feelsMax,0) + "° / " + U.tv(p.feelsMin,0) + "°" : "");
    push("Chance of rain", p.pop != null ? r0(p.pop) + "%" : null,
         p.mm != null ? U.r(p.mm) + " expected" : "");
    push("Wind", p.wind != null ? r0(p.wind) + " mph" : null,
         (compass(p.dir) || "") + (p.gust != null ? " · gust " + r0(p.gust) : ""));
    const dayHrs = hrs.filter(h => h.isDay);
    push("Humidity", avg(hrs.map(h => h.rh)) != null ? r0(avg(hrs.map(h => h.rh))) + "%" : null,
         avg(hrs.map(h => h.dew)) != null ? "dew point " + U.t(avg(hrs.map(h => h.dew)), 0) : "");
    push("Pressure", avg(hrs.map(h => h.pres)) != null ? U.p(avg(hrs.map(h => h.pres))) : null, "");
    push("Cloud cover", avg(dayHrs.map(h => h.cloud)) != null ? r0(avg(dayHrs.map(h => h.cloud))) + "%" : null, "daytime average");
    push("UV index", p.uv != null ? r1(p.uv) : null, uvBand(p.uv));
    push("Sunrise / set", p.sunrise && p.sunset ? hhmm(p.sunrise) + " · " + hhmm(p.sunset) : null,
         p.sunrise && p.sunset ? r1((p.sunset - p.sunrise)/3600000) + " hours of daylight" : "");

    el.className = "fc-detail open";
    el.innerHTML =
      "<div class='fc-detail-head'>" +
        "<div><div class='fc-detail-title'>" + p.t.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"}) + "</div>" +
        "<div class='fc-detail-desc'>" + wmoText(p.code) + "</div></div>" +
        "<div class='fc-close' id='fcDetailClose'>✕ CLOSE</div>" +
      "</div>" +
      "<div class='fc-detail-grid'>" +
        facts.map(f => "<div class='fc-fact'><div class='k'>" + f[0] + "</div><div class='v'>" + f[1] +
                       "</div><div class='s'>" + f[2] + "</div></div>").join("") +
      "</div>" +
      (hrs.length
        ? "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
          "<th>Hour</th><th>Temp</th><th>Feels</th><th>Rain</th><th>mm</th><th>Wind</th><th>Cloud</th><th>Conditions</th>" +
          "</tr></thead><tbody>" +
          hrs.filter((h,i) => hrs.length <= 24 || i % 2 === 0).map(h =>
            "<tr><td>" + hhmm(h.t) + "</td><td>" + U.tv(h.temp) + "°</td><td>" + U.tv(h.feels) + "°</td>" +
            "<td>" + (h.pop != null ? r0(h.pop) + "%" : "–") + "</td>" +
            "<td>" + (h.mm != null ? U.rv(h.mm) : "–") + "</td>" +
            "<td>" + (h.wind != null ? r0(h.wind) + " " + compass(h.dir) : "–") +
              (h.gust != null ? "<span class='stat-at'>gust " + r0(h.gust) + "</span>" : "") + "</td>" +
            "<td>" + (h.cloud != null ? r0(h.cloud) + "%" : "–") + "</td>" +
            "<td>" + wmoText(h.code) + "</td></tr>").join("") +
          "</tbody></table></div>"
        : "<div class='chart-loading'>No hourly detail for this date</div>");
  }

  /* ── forecast vs ensemble ─────────────────────────────────────────── */
  function pctlOf(arr, v) {
    const a = arr.filter(x => x != null && !isNaN(x));
    if (!a.length || v == null) return null;
    return a.filter(x => x <= v).length / a.length;
  }
  function verdict(p) {
    if (p == null) return ["", ""];
    if (p < 0.05) return ["fc-v-out", "far colder than the pack"];
    if (p < 0.20) return ["fc-v-cool", "cool side"];
    if (p > 0.95) return ["fc-v-out", "far warmer than the pack"];
    if (p > 0.80) return ["fc-v-warm", "warm side"];
    return ["fc-v-mid", "mainstream"];
  }

  async function crossCheck() {
    const el = $("fcCross");
    const E = window.__ENSEMBLE__;
    if (!E || typeof E.ensure !== "function") {
      el.innerHTML = "<div class='chart-loading'>Ensemble module not present</div>"; return;
    }
    try {
      const ed = await E.ensure();
      if (!ed || !ed.length) throw new Error("no ensemble data");
      const byKey = {};
      ed.forEach(d => { byKey[localKey(d.date)] = d; });

      const rows = [];
      S.daily.slice(0, 12).forEach(p => {
        const e = byKey[p.key]; if (!e) return;
        rows.push({ d: p.t, fcMax: p.tmax, fcPop: p.pop, e: e,
          pl: e.mem && e.mem.max ? pctlOf(e.mem.max, p.tmax) : null,
          ensProb: e.rain.prob != null ? e.rain.prob*100 : null,
          ensMean: e.tmax.mean });
      });
      if (!rows.length) throw new Error("no overlapping days");
      S.cross = rows;

      const body = rows.map(r => {
        const v = verdict(r.pl);
        const gap = (r.fcPop != null && r.ensProb != null) ? r.fcPop - r.ensProb : null;
        return "<tr><td>" + r.d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}) + "</td>" +
          "<td><span class='stat-hi'>" + U.tv(r.fcMax) + "°</span></td>" +
          "<td>" + U.tv(r.ensMean) + "°<span class='stat-at'>" + U.tv(r.e.tmax.p10) + "–" + U.tv(r.e.tmax.p90) + "°</span></td>" +
          "<td>" + (r.pl != null ? ord(Math.round(r.pl*100)) : "–") + "</td>" +
          "<td><span class='fc-verdict " + v[0] + "'>" + v[1] + "</span></td>" +
          "<td>" + (r.fcPop != null ? r0(r.fcPop) + "%" : "–") + "</td>" +
          "<td>" + (r.ensProb != null ? r0(r.ensProb) + "%" : "–") + "</td>" +
          "<td>" + (gap == null ? "–" : (gap > 0 ? "+" : "") + r0(gap) + " pts") + "</td></tr>";
      }).join("");

      el.innerHTML = "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
        "<th>Day</th><th>Forecast max</th><th>Ensemble mean</th><th>Percentile</th><th>Position</th>" +
        "<th>Forecast rain</th><th>Ensemble rain</th><th>Difference</th>" +
        "</tr></thead><tbody>" + body + "</tbody></table></div>" +
        "<div class='ens-analysis' style='margin-top:12px'>" + crossNarrative(rows) + "</div>";

      ENS_CACHE = null;
      renderChart();       // ensemble band can now be drawn
      renderSummary();
    } catch (e) {
      console.warn("Cross-check unavailable:", e);
      el.innerHTML = "<div class='chart-loading'>Cross-check unavailable — " + e.message + "</div>";
    }
  }

  function crossNarrative(rows) {
    const pls = rows.map(r => r.pl).filter(v => v != null);
    if (!pls.length) return "";
    const mean = pls.reduce((a,b) => a+b, 0)/pls.length;
    const outliers = rows.filter(r => r.pl != null && (r.pl < 0.1 || r.pl > 0.9));
    const gaps = rows.map(r => (r.fcPop != null && r.ensProb != null) ? r.fcPop - r.ensProb : null).filter(v => v != null);
    const gapMean = gaps.length ? gaps.reduce((a,b) => a+b, 0)/gaps.length : null;

    let out = "<p>";
    out += mean > 0.72 ? "<b>The best-match forecast runs consistently warmer than the ensemble</b>, averaging the " + ord(Math.round(mean*100)) + " percentile of the member spread. That is a systematic lean rather than noise. "
         : mean < 0.28 ? "<b>The best-match forecast runs consistently cooler than the ensemble</b>, averaging the " + ord(Math.round(mean*100)) + " percentile of the member spread — a systematic lean rather than noise. "
         : "The best-match forecast tracks the middle of the ensemble closely, averaging the " + ord(Math.round(mean*100)) + " percentile across the period. That is what you want to see: the high-resolution run is a mainstream solution, not an outlier. ";

    if (outliers.length) {
      out += "It steps outside the middle 80% of members on " +
        outliers.map(r => "<b>" + r.d.toLocaleDateString("en-GB",{weekday:"short"}) + "</b>").join(", ") +
        " — treat " + (outliers.length === 1 ? "that day" : "those days") + " as the least reliable in the run. ";
    } else {
      out += "No single day falls outside the middle 80% of members, so there is no obvious weak spot in the run. ";
    }

    if (gapMean != null && Math.abs(gapMean) >= 12) {
      out += "On rainfall the two disagree more: the deterministic run is on average <b>" + Math.abs(Math.round(gapMean)) +
             " points " + (gapMean > 0 ? "wetter" : "drier") + "</b> than the share of ensemble members producing rain. " +
             "That is normal — a single high-resolution model resolves showers the coarser ensemble members smear out.";
    } else if (gapMean != null) {
      out += "Rain probabilities agree closely, within " + Math.abs(Math.round(gapMean)) + " points on average.";
    }
    return out + "</p>";
  }

  /* ── written summary ──────────────────────────────────────────────── */
  function renderSummary() {
    const el = $("fcSummary");
    const days = S.daily.slice(0, 7);
    if (!days.length) { el.innerHTML = ""; return; }
    const d0 = days[0], d1 = days[1];
    let out = "";

    out += "<p><b>Today.</b> " + (wmoText(d0.code) || "Mixed conditions") + ", topping out near <b>" + U.t(d0.tmax, 0) + "</b>" +
      (d0.feelsMax != null && d0.tmax != null && Math.abs(d0.feelsMax - d0.tmax) >= 2
        ? " though it will feel more like " + U.t(d0.feelsMax, 0) : "") + ". " +
      (d0.pop != null
        ? (d0.pop >= 60 ? "Rain is likely — " + r0(d0.pop) + "% chance"
          : d0.pop >= 30 ? "There is a " + r0(d0.pop) + "% chance of catching a shower"
          : "It should stay largely dry, with only a " + r0(d0.pop) + "% chance of rain") +
          (d0.mm ? ", around " + U.r(d0.mm) + " if it comes to anything" : "") + ". " : "") +
      (d0.wind != null ? "Winds " + describeWind(d0.wind) + " at " + r0(d0.wind) + " mph" +
        (compass(d0.dir) ? " from the " + compass(d0.dir) : "") +
        (d0.gust != null && d0.gust > d0.wind*1.3 ? ", gusting " + r0(d0.gust) + " mph" : "") + ". " : "") +
      (d0.sunset ? "Sunset at " + hhmm(d0.sunset) + "." : "") + "</p>";

    if (d1) {
      out += "<p><b>Tonight and tomorrow.</b> Down to around <b>" + U.t(d0.tmin, 0) + "</b> overnight" +
        (d0.tmin != null && d0.tmin <= 3 ? " — cold enough to be worth watching for frost" : "") + ". " +
        "Tomorrow brings " + wmoText(d1.code).toLowerCase() + " with a high of " + U.t(d1.tmax, 0) +
        (d1.pop != null ? " and a " + r0(d1.pop) + "% chance of rain" : "") + ".</p>";
    }

    if (days.length > 2) {
      const rest = days.slice(2);
      const his = rest.map(d => d.tmax).filter(v => v != null);
      const trend = his.length > 1 ? his[his.length-1] - his[0] : 0;
      const wettest = rest.reduce((a,b) => (b.pop||0) > (a.pop||0) ? b : a);
      const windiest = rest.reduce((a,b) => (b.gust||b.wind||0) > (a.gust||a.wind||0) ? b : a);
      out += "<p><b>Rest of the week.</b> Highs " +
        (Math.abs(trend) < 1.5 ? "hold steady around " + U.t(his.reduce((a,b)=>a+b,0)/his.length, 0)
          : trend > 0 ? "climb to about " + U.t(his[his.length-1], 0) + " by the end of the period"
          : "slip back to about " + U.t(his[his.length-1], 0) + " by the end of the period") + ". " +
        (wettest.pop != null ? "The wettest day looks like <b>" + wettest.t.toLocaleDateString("en-GB",{weekday:"long"}) +
          "</b> at " + r0(wettest.pop) + "%" + (wettest.mm ? ", around " + U.r(wettest.mm) : "") + ". " : "") +
        ((windiest.gust || 0) >= 30 ? "<b>" + windiest.t.toLocaleDateString("en-GB",{weekday:"long"}) +
          "</b> is the windiest, gusting to " + r0(windiest.gust) + " mph." : "") + "</p>";
    }

    if (S.cross && S.cross.length) {
      const pls = S.cross.map(r => r.pl).filter(v => v != null);
      if (pls.length) {
        const mean = pls.reduce((a,b)=>a+b,0)/pls.length;
        out += "<p><b>How much to trust this.</b> " +
          (mean > 0.72 || mean < 0.28
            ? "This run sits at the " + ord(Math.round(mean*100)) + " percentile of the multi-model ensemble, so it leans to one " +
              "side of the range of plausible outcomes — check the ENSEMBLE tab before relying on the exact numbers."
            : "This run sits close to the centre of the multi-model ensemble, which is the best sign you can get that the " +
              "numbers above are dependable. See the ENSEMBLE tab for the full spread.") + "</p>";
      }
    }
    el.innerHTML = out;
  }

  /* ── render ───────────────────────────────────────────────────────── */
  function renderAll() {
    renderSummary();
    renderNow();
    renderChart();
    renderHours();
    renderDays();
  }

  /* ── events ───────────────────────────────────────────────────────── */
  document.addEventListener("click", e => {
    if (!e.target.closest) return;
    if (e.target.closest("#fcRefresh")) { load(); return; }
    if (e.target.closest("#fcDetailClose")) { S.openDay = null; renderDays(); return; }
    const sp = e.target.closest("#fcSpan button");
    if (sp) {
      Array.prototype.forEach.call($("fcSpan").children, x => x.classList.remove("active"));
      sp.classList.add("active");
      S.span = +sp.dataset.h;
      if (S.loaded) renderChart();
      return;
    }
    const card = e.target.closest(".fc-day");
    if (card) {
      const i = +card.dataset.i;
      S.openDay = (S.openDay === i) ? null : i;
      renderDays();
      const el = $("fcDetail");
      if (S.openDay != null && el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"nearest" });
    }
  });

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const pane = $("paneForecast");
      if (S.loaded && pane && pane.classList.contains("active")) renderChart();
    }, 250);
  });

  const STALE_MS = 30*60*1000;

  return {
    render: function () {
      // reopening the tab after half an hour refetches rather than showing
      // whatever was cached when the page was first loaded
      if (S.loaded && S.fetchedAt && (Date.now() - S.fetchedAt) > STALE_MS) { load(); return; }
      if (!S.loaded && !S.loading) load();
      else if (S.loaded) { renderAll(); if (!S.cross) crossCheck(); }
    },
    refresh: load
  };
})();
