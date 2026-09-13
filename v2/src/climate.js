/*
   CLIMATE TAB — how unusual is today, this month and this year?
   Pulls daily ERA5 reanalysis for this location from the Open-Meteo
   archive API (free, no key, back to 1940) and works out where the current
   month and year sit against every other year on record. Baseline for
   "normal" is 1991–2020, the WMO standard.
   The raw download is around a megabyte, so it happens only when this tab
   is first opened, and the derived statistics — a few kilobytes — are
   cached in localStorage for 24 hours. The raw data is never cached, so
   there is no risk of filling the quota.
   Self-contained IIFE; the only global is window.__CLIMATE__.
 */

window.__CLIMATE__ = (function () {
  "use strict";
  /* ── configuration ──────────────────────────────────────────────────
     Everything comes from window.WXCONFIG (see config.js). The fallbacks
     below are only used if that file is missing, so the page still runs.  */
  const CFG = (typeof window !== "undefined" && window.WXCONFIG) || {};
  const STATION = CFG.station || {};
  const LAT = CFG.lat != null ? CFG.lat : 52.6033;
  const LON = CFG.lon != null ? CFG.lon : 0.3822;
  const TZ  = encodeURIComponent(CFG.timezone || "Europe/London");
  const WIND_UNIT = (CFG.units && CFG.units.wind) || "mph";
  const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
  const CLIM = CFG.climate || {};
  const FIRST_YEAR = CLIM.firstYear || 1940;
  const BASE_FROM = CLIM.baselineFrom || 1991;   // WMO standard normal period
  const BASE_TO   = CLIM.baselineTo   || 2020;
  const WET_DAY = 0.2;                          // mm, the usual "measurable rain" threshold
  const CACHE_KEY = "wxclim_v2_" + LAT.toFixed(2) + "_" + LON.toFixed(2) + "_" + BASE_FROM;
  const CACHE_HOURS = 24;

  const S = { stats: null, loading: false };

  /* ── helpers ──────────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const r1 = v => v == null || isNaN(v) ? "–" : (Math.round(v*10)/10).toFixed(1);
  const r0 = v => v == null || isNaN(v) ? "–" : String(Math.round(v));
  const pad2 = n => String(n).padStart(2, "0");
  const ord = n => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
  const MONTHS = ["January","February","March","April","May","June","July","August",
                  "September","October","November","December"];
  const mean = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; };

  /* ── fetch + reduce ───────────────────────────────────────────────── */
  function url() {
    const now = new Date();
    const end = now.getFullYear() + "-" + pad2(now.getMonth()+1) + "-" + pad2(now.getDate());
    return ARCHIVE + "?latitude=" + LAT.toFixed(4) + "&longitude=" + LON.toFixed(4) +
      "&start_date=" + FIRST_YEAR + "-01-01&end_date=" + end +
      "&daily=precipitation_sum,temperature_2m_max&timezone=Europe%2FLondon";
  }

  // Everything the pane needs, reduced from ~31,000 daily records to a few KB
  function reduce(j) {
    const t = j.daily.time, P = j.daily.precipitation_sum, T = j.daily.temperature_2m_max;
    const last = t[t.length-1];
    const curY = +last.slice(0,4), curM = +last.slice(5,7), curD = +last.slice(8,10);

    const monthToDate = {}, yearToDate = {}, yearFull = {}, monthlyThisYear = {},
          monthlyBase = {}, tmaxMonthThis = {}, tmaxMonthBase = {},
          cumThisYear = [], cumByYear = {}, todayTmax = [];
    let drySpell = 0, drySpellBroken = false, wetDaysThisMonth = 0;

    for (let i = 0; i < t.length; i++) {
      const y = +t[i].slice(0,4), m = +t[i].slice(5,7), d = +t[i].slice(8,10);
      const p = P[i], x = T[i];
      const beforeOrOn = (m < curM) || (m === curM && d <= curD);

      if (p != null) {
        if (m === curM && d <= curD) monthToDate[y] = (monthToDate[y] || 0) + p;
        if (beforeOrOn) yearToDate[y] = (yearToDate[y] || 0) + p;
        yearFull[y] = (yearFull[y] || 0) + p;

        if (!cumByYear[y]) cumByYear[y] = [];
        cumByYear[y].push([ (m-1)*31 + d, (cumByYear[y].length ? cumByYear[y][cumByYear[y].length-1][1] : 0) + p ]);

        if (y === curY) {
          monthlyThisYear[m] = (monthlyThisYear[m] || 0) + p;
          if (m === curM && p >= WET_DAY) wetDaysThisMonth++;
        }
        if (y >= BASE_FROM && y <= BASE_TO) {
          if (!monthlyBase[m]) monthlyBase[m] = {};
          monthlyBase[m][y] = (monthlyBase[m][y] || 0) + p;
        }
      }

      if (x != null) {
        if (m === curM && d === curD) todayTmax.push({ y: y, v: x });
        if (y === curY) { if (!tmaxMonthThis[m]) tmaxMonthThis[m] = []; tmaxMonthThis[m].push(x); }
        if (y >= BASE_FROM && y <= BASE_TO) { if (!tmaxMonthBase[m]) tmaxMonthBase[m] = []; tmaxMonthBase[m].push(x); }
      }

      // dry spell: count back from the most recent day
      if (!drySpellBroken && p != null) {
        const fromEnd = t.length - 1 - i;
        if (fromEnd >= 0) { /* handled in the reverse pass below */ }
      }
    }

    // dry spell, counting backwards from the last record
    for (let i = t.length - 1; i >= 0; i--) {
      if (P[i] == null) continue;
      if (P[i] < WET_DAY) drySpell++;
      else break;
    }

    // cumulative curve for the current year, and for the driest/wettest
    // complete years, so the chart has something to be measured against
    const completeYears = Object.keys(yearFull).map(Number).filter(y => y < curY);
    completeYears.sort((a,b) => yearFull[a] - yearFull[b]);
    const driestYear = completeYears[0], wettestYear = completeYears[completeYears.length-1];

    // day-of-year normal cumulative curve, averaged across the baseline
    const baseYears = Object.keys(cumByYear).map(Number).filter(y => y >= BASE_FROM && y <= BASE_TO);
    const normalCum = [];
    if (baseYears.length) {
      const maxLen = Math.max.apply(null, baseYears.map(y => cumByYear[y].length));
      for (let i = 0; i < maxLen; i++) {
        const vals = baseYears.map(y => cumByYear[y][i] ? cumByYear[y][i][1] : null);
        const key = baseYears.map(y => cumByYear[y][i] ? cumByYear[y][i][0] : null).find(v => v != null);
        const m = mean(vals);
        if (key != null && m != null) normalCum.push([key, m]);
      }
    }

    // Standard competition ranking, so tied years share a position — with
    // rainfall totals of 0.0 mm that happens a lot.
    const rank = (obj, y) => {
      const entries = Object.keys(obj).map(k => ({ y: +k, v: obj[k] })).sort((a,b) => a.v - b.v);
      const me = entries.find(e => e.y === y);
      if (!me) return { list: entries, pos: 0, n: entries.length, tied: 0, value: null };
      return {
        list: entries,
        pos: entries.findIndex(e => e.v >= me.v - 0.001) + 1,
        n: entries.length,
        tied: entries.filter(e => Math.abs(e.v - me.v) < 0.05).length,
        value: me.v
      };
    };

    // Which month to headline. Ranking "1st to 1st" against 86 other single
    // days is noise, so for the first days of a month we feature the last
    // complete month instead and say so.
    let pm = curM - 1, pmYear = curY;
    if (pm === 0) { pm = 12; pmYear = curY - 1; }
    const prevMonth = {};
    for (let i = 0; i < t.length; i++) {
      const y = +t[i].slice(0,4), m = +t[i].slice(5,7);
      if (m === pm && P[i] != null) prevMonth[y] = (prevMonth[y] || 0) + P[i];
    }
    const prevMonthRank = rank(prevMonth, pmYear);
    const prevMonthNormal = mean(Object.keys(prevMonth)
      .filter(y => y >= BASE_FROM && y <= BASE_TO).map(y => prevMonth[y]));

    const MONTH_NAMES = ["January","February","March","April","May","June","July","August",
                         "September","October","November","December"];
    const useMTD = curD >= 10;
    const monthRankMTD = rank(monthToDate, curY);
    const feat = useMTD
      ? { month: curM, name: MONTH_NAMES[curM-1], year: curY, complete: false,
          window: "1–" + curD, total: monthToDate[curY],
          normal: mean(Object.keys(monthToDate).filter(y => y >= BASE_FROM && y <= BASE_TO).map(y => monthToDate[y])),
          rank: monthRankMTD }
      : { month: pm, name: MONTH_NAMES[pm-1], year: pmYear, complete: true,
          window: "complete month", total: prevMonth[pmYear],
          normal: prevMonthNormal, rank: prevMonthRank };

    const todaySorted = todayTmax.slice().sort((a,b) => b.v - a.v);

    return {
      generated: Date.now(),
      curY: curY, curM: curM, curD: curD, lastDate: last,
      monthToDate: monthToDate, yearToDate: yearToDate,
      feat: feat,
      mtdTotal: monthToDate[curY], mtdRank: monthRankMTD,
      monthRank: monthRankMTD, yearRank: rank(yearToDate, curY),
      monthNormal: mean(Object.keys(monthToDate).filter(y => y >= BASE_FROM && y <= BASE_TO).map(y => monthToDate[y])),
      yearNormal: mean(Object.keys(yearToDate).filter(y => y >= BASE_FROM && y <= BASE_TO).map(y => yearToDate[y])),
      monthlyThisYear: monthlyThisYear,
      monthlyNormal: Object.keys(monthlyBase).reduce((o,m) => { o[m] = mean(Object.values(monthlyBase[m])); return o; }, {}),
      tmaxThisYear: Object.keys(tmaxMonthThis).reduce((o,m) => { o[m] = mean(tmaxMonthThis[m]); return o; }, {}),
      tmaxNormal: Object.keys(tmaxMonthBase).reduce((o,m) => { o[m] = mean(tmaxMonthBase[m]); return o; }, {}),
      cumThisYear: cumByYear[curY] || [],
      cumNormal: normalCum,
      cumDriest: driestYear != null ? cumByYear[driestYear] : null, driestYear: driestYear,
      cumWettest: wettestYear != null ? cumByYear[wettestYear] : null, wettestYear: wettestYear,
      drySpell: drySpell, wetDaysThisMonth: wetDaysThisMonth,
      todayNormalTmax: mean(todayTmax.filter(o => o.y >= BASE_FROM && o.y <= BASE_TO).map(o => o.v)),
      todayRecordTmax: todaySorted.length ? todaySorted[0] : null,
      todayThisYear: (todayTmax.find(o => o.y === curY) || {}).v,
      // label the span from the data itself — the archive may hold less
      // than we asked for, and claiming otherwise would be a lie
      firstYearInData: +t[0].slice(0, 4),
      span: (+t[0].slice(0, 4)) + "–" + curY
    };
  }

  /* ── load ─────────────────────────────────────────────────────────── */
  async function load(force) {
    if (S.loading) return;
    S.loading = true;
    const st = $("clStatus");
    st.className = "cl-status";

    if (!force) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.generated && (Date.now() - cached.generated) < CACHE_HOURS*3600*1000) {
            S.stats = cached; S.loading = false;
            status("from cache");
            render();
            return;
          }
        }
      } catch (e) { /* private browsing or full quota — just refetch */ }
    }

    st.textContent = "DOWNLOADING 86 YEARS OF DAILY RECORDS… (ABOUT A MEGABYTE, ONCE A DAY)";
    try {
      const res = await fetch(url(), { cache: "no-store" });
      if (!res.ok) throw new Error("archive API returned " + res.status);
      const j = await res.json();
      if (!j.daily || !j.daily.time || !j.daily.time.length)
          throw new Error("archive returned no daily data for this location");

      S.stats = reduce(j);
      S.loading = false;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(S.stats)); } catch (e) {}
      status("fetched");
      render();
    } catch (e) {
      S.loading = false;
      console.warn("Climatology unavailable:", e);
      st.className = "cl-status err";
      st.innerHTML = "CLIMATOLOGY UNAVAILABLE — " + String(e.message).toUpperCase() +
        "<br>archive-api.open-meteo.com could not be reached.";
    }
  }

  function status(how) {
    const s = S.stats;
    $("clStatus").textContent =
      "ERA5 REANALYSIS " + s.span + " · BASELINE " + BASE_FROM + "–" + BASE_TO +
      " · THROUGH " + s.lastDate + " · " + how.toUpperCase() +
      " " + new Date(s.generated).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
  }

  /* ── hero cards ───────────────────────────────────────────────────── */
  function renderHero() {
    const s = S.stats, f = s.feat;
    const ytd = s.yearToDate[s.curY];
    const mPct = f.normal ? f.total / f.normal * 100 : null;
    const yPct = s.yearNormal ? ytd / s.yearNormal * 100 : null;
    const tAnom = (s.todayThisYear != null && s.todayNormalTmax != null)
      ? s.todayThisYear - s.todayNormalTmax : null;
    const joint = f.rank.tied > 1 ? "joint " : "";

    const cards = [
      { k: f.name + " " + f.year + " rainfall", v: U.r(f.total),
        s: mPct != null ? r0(mPct) + "% of the " + U.r(f.normal) + " normal" : "",
        cls: mPct != null && mPct < 40 ? "alarm" : "" },
      { k: f.name + " ranking", v: joint + ord(f.rank.pos) + " driest",
        s: "of " + f.rank.n + " years" + (f.complete ? " · last complete month" : " · 1st–" + s.curD),
        cls: f.rank.pos <= 3 ? "alarm" : "" },
      { k: "Year to date", v: U.r(ytd, 0),
        s: yPct != null ? r0(yPct) + "% of normal · " + ord(s.yearRank.pos) + " driest of " + s.yearRank.n : "",
        cls: s.yearRank.pos <= 5 ? "alarm" : "" },
      { k: "Dry spell", v: s.drySpell + (s.drySpell === 1 ? " day" : " days"),
        s: "since " + U.r(WET_DAY) + " or more fell",
        cls: s.drySpell >= 14 ? "alarm" : "" },
      { k: "Today vs normal", v: (tAnom != null ? U.dtSigned(tAnom) : "–"),
        s: s.todayNormalTmax != null ? "normal max " + U.t(s.todayNormalTmax) : "",
        cls: tAnom != null && tAnom >= 5 ? "alarm" : tAnom != null && tAnom <= -5 ? "cool" : "" },
      { k: "Record for today", v: s.todayRecordTmax ? U.t(s.todayRecordTmax.v) : "–",
        s: s.todayRecordTmax ? "set in " + s.todayRecordTmax.y : "" }
    ];

    $("clHero").innerHTML = cards.map(c =>
      "<div class='cl-card " + (c.cls || "") + "'><div class='k'>" + c.k + "</div>" +
      "<div class='v'>" + c.v + "</div><div class='s'>" + c.s + "</div></div>").join("");
  }

  /* ── charts ───────────────────────────────────────────────────────── */
  async function charts() {
    try {
      if (typeof ensureHighcharts === "function") await ensureHighcharts();
      if (typeof themeHighcharts === "function") themeHighcharts();
      if (typeof Highcharts === "undefined" || !Highcharts) throw new Error("Highcharts unavailable");
    } catch (e) {
      ["clCumChart","clMonthChart","clTempChart"].forEach(id => {
        const el = $(id); if (el) el.innerHTML = "<div class='chart-loading'>Chart unavailable — " + e.message + "</div>";
      });
      return;
    }
    const s = S.stats;
    const w = window.innerWidth || 1200;
    const h1 = w < 560 ? 240 : w < 1024 ? 280 : 320;
    const h2 = w < 560 ? 200 : w < 1024 ? 230 : 260;

    $("clCumTitle").textContent =
      "Cumulative rainfall " + s.curY + " against the " + BASE_FROM + "–" + BASE_TO + " normal";

    /* cumulative curves are [dayIndex, mm]; convert the value, keep the index */
    const cv = arr => (arr || []).map(pt => [pt[0], U.axisRain(pt[1])]);

    const series = [
      { name: BASE_FROM + "–" + BASE_TO + " normal", data: cv(s.cumNormal), color: "#64748b",
        dashStyle: "ShortDash", lineWidth: 2, zIndex: 3 },
      { name: s.curY, data: cv(s.cumThisYear), color: "#dc2626", lineWidth: 3, zIndex: 5 }
    ];
    if (s.cumDriest) series.push({ name: "Driest year (" + s.driestYear + ")", data: cv(s.cumDriest),
      color: "#f59e0b", lineWidth: 1, dashStyle: "Dot", zIndex: 2 });
    if (s.cumWettest) series.push({ name: "Wettest year (" + s.wettestYear + ")", data: cv(s.cumWettest),
      color: "#2563eb", lineWidth: 1, dashStyle: "Dot", zIndex: 1 });

    // x axis is a synthetic day index ((month-1)*31 + day) so every year
    // lines up regardless of leap years; relabel it with month names
    const ticks = [], labels = {};
    for (let m = 1; m <= 12; m++) { ticks.push((m-1)*31 + 1); labels[(m-1)*31 + 1] = MONTHS[m-1].slice(0,3); }

    Highcharts.chart("clCumChart", {
      chart: { type: "line", height: h1 },
      xAxis: { tickPositions: ticks, labels: { formatter: function () { return labels[this.value] || ""; } } },
      yAxis: { title: { text: U.rainUnit + ", cumulative" }, min: 0 },
      tooltip: { shared: true, valueSuffix: " " + U.rainUnit, valueDecimals: 0 },
      plotOptions: { series: { marker: { enabled: false }, animation: false } },
      series: series
    });

    const mCats = MONTHS.map(m => m.slice(0,3));
    Highcharts.chart("clMonthChart", {
      chart: { type: "column", height: h2 },
      xAxis: { categories: mCats },
      yAxis: { title: { text: U.rainUnit }, min: 0 },
      tooltip: { shared: true, valueSuffix: " " + U.rainUnit, valueDecimals: 1 },
      series: [
        { name: "Normal", data: mCats.map((_,i) => s.monthlyNormal[i+1] != null ? +U.axisRain(s.monthlyNormal[i+1]).toFixed(2) : null),
          color: "#cbd5e1" },
        { name: String(s.curY), data: mCats.map((_,i) => s.monthlyThisYear[i+1] != null ? +U.axisRain(s.monthlyThisYear[i+1]).toFixed(2) : null),
          color: "#2563eb" }
      ]
    });

    Highcharts.chart("clTempChart", {
      chart: { type: "column", height: h2 },
      xAxis: { categories: mCats },
      yAxis: { title: { text: U.tempUnit } },
      tooltip: { shared: true, valueSuffix: " " + U.tempUnit, valueDecimals: 1 },
      series: [
        { name: "Normal max", data: mCats.map((_,i) => s.tmaxNormal[i+1] != null ? +U.axisTemp(s.tmaxNormal[i+1]).toFixed(1) : null),
          color: "#cbd5e1" },
        { name: String(s.curY) + " mean max", data: mCats.map((_,i) => s.tmaxThisYear[i+1] != null ? +U.axisTemp(s.tmaxThisYear[i+1]).toFixed(1) : null),
          color: "#dc2626" }
      ]
    });
  }

  /* ── rank tables ──────────────────────────────────────────────────── */
  function rankTable(el, entries, curY, unitLabel) {
    const top = entries.slice(0, 10);
    const hasYou = top.some(e => e.y === curY);
    const you = entries.find(e => e.y === curY);
    const rows = top.concat(hasYou || !you ? [] : [null, you]);
    const max = Math.max.apply(null, entries.map(e => e.v)) || 1;

    el.innerHTML = "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
      "<th>Rank</th><th>Year</th><th>" + unitLabel + "</th><th></th>" +
      "</tr></thead><tbody>" +
      rows.map(e => {
        if (!e) return "<tr><td colspan='4' style='text-align:center;color:var(--mist)'>⋯</td></tr>";
        const pos = entries.indexOf(e) + 1;
        const isYou = e.y === curY;
        return "<tr class='" + (isYou ? "cl-rank-you" : "") + "'>" +
          "<td>" + ord(pos) + "</td><td>" + e.y + "</td>" +
          "<td>" + U.r(e.v) + "</td>" +
          "<td><span class='cl-bar' style='width:90px'><span style='width:" +
            (e.v/max*100).toFixed(0) + "%'></span></span></td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderTables() {
    const s = S.stats, f = s.feat;
    $("clDriestMonthTitle").textContent = f.complete
      ? "Driest " + f.name + " on record"
      : "Driest " + f.name + " 1–" + s.curD + " on record";
    rankTable($("clDriestMonth"), f.rank.list, f.year, "Rainfall");
    rankTable($("clDriestYear"), s.yearRank.list, s.curY, "Jan 1 to date");
  }

  /* ── narrative ────────────────────────────────────────────────────── */
  function renderAnalysis() {
    const s = S.stats, f = s.feat;
    const ytd = s.yearToDate[s.curY];
    const mPct = f.normal ? f.total / f.normal * 100 : null;
    const yPct = s.yearNormal ? ytd / s.yearNormal * 100 : null;
    const mp = f.rank.pos, mn = f.rank.n, joint = f.rank.tied > 1;
    const yp = s.yearRank.pos, yn = s.yearRank.n;
    const runnerUp = f.rank.list.find(e => e.y !== f.year && e.v > f.total) || f.rank.list[1];
    const tAnom = (s.todayThisYear != null && s.todayNormalTmax != null) ? s.todayThisYear - s.todayNormalTmax : null;

    let out = "";

    /* rainfall for the featured month */
    out += "<p><b>" + f.name + " " + f.year + ".</b> " + U.r(f.total) + " " +
      (f.complete ? "fell across the whole month"
                  : "has fallen between the 1st and the " + ord(s.curD)) +
      ", against a " + BASE_FROM + "–" + BASE_TO + " normal of " + U.r(f.normal) + " — " +
      (mPct != null ? "<b>" + r0(mPct) + "% of normal</b>" : "") + ". " +
      (mp === 1 && !joint
        ? "That makes it the <b>driest " + f.name + " in the " + mn + " years since " + FIRST_YEAR + "</b>" +
          (runnerUp ? ", beating " + runnerUp.y + " which managed " + U.r(runnerUp.v) + "." : ".")
        : mp === 1 && joint
        ? "That equals the <b>driest " + f.name + " on record</b> — " + f.rank.tied +
          " years in " + mn + " share the distinction, the next wettest being " +
          (runnerUp ? runnerUp.y + " with " + U.r(runnerUp.v) + "." : "close behind.")
        : "That ranks <b>" + (joint ? "joint " : "") + ord(mp) + " driest of " + mn + "</b>" +
          (f.rank.list[0] ? ", behind " + f.rank.list[0].y + " with " + U.r(f.rank.list[0].v) + "." : ".")) +
      (!f.complete
        ? (s.wetDaysThisMonth === 0
            ? " Not a single day this month has produced " + U.r(WET_DAY) + " or more."
            : " Only " + s.wetDaysThisMonth + (s.wetDaysThisMonth === 1 ? " day" : " days") + " produced measurable rain.")
        : (s.mtdTotal != null
            ? " " + MONTHS[s.curM-1] + " has since added " + U.r(s.mtdTotal) + " in " + s.curD +
              (s.curD === 1 ? " day." : " days.")
            : "")) +
      "</p>";

    /* the year as a whole */
    out += "<p><b>The year so far.</b> " + U.r(ytd, 0) + " since 1 January, " +
      (yPct != null ? "<b>" + r0(yPct) + "% of the " + U.r(s.yearNormal, 0) + "</b> that would be normal by now" : "") + ". " +
      (yp === 1
        ? "<b>No year since " + s.firstYearInData + " has been drier to this date</b> — the driest start to a year in " + yn + " years of record."
        : yp <= 3
        ? "Only " + (yp-1) + (yp === 2 ? " year" : " years") + " in " + yn + " have been drier by this date."
        : "That is the " + ord(yp) + " driest start to a year in " + yn + " years of record.") +
      " A deficit of this size takes months of above-average rain to recover, not days.</p>";

    /* the dry spell */
    if (s.drySpell >= 5) {
      out += "<p><b>The current dry spell.</b> " + s.drySpell + " consecutive days without " + WET_DAY +
        ". " +
        (s.drySpell >= 30 ? "Anything past a month is exceptional in a maritime climate like Norfolk's — this is the kind of run that puts the East Anglian aquifers and the Ouse catchment under real strain."
         : s.drySpell >= 14 ? "Two weeks or more is the point at which shallow-rooted crops and lawns start to show it."
         : "Not yet remarkable, but worth watching if it extends.") + "</p>";
    }

    /* temperature */
    if (tAnom != null) {
      out += "<p><b>Temperature.</b> Today's maximum ran " +
        (Math.abs(tAnom) < 1 ? "close to the seasonal normal of " + U.t(s.todayNormalTmax)
          : "<b>" + U.dt(Math.abs(tAnom)) + " " + (tAnom > 0 ? "above" : "below") + "</b> the " +
            U.t(s.todayNormalTmax) + " normal for this date") + ". " +
        (s.todayRecordTmax ? "The record for the date is " + U.t(s.todayRecordTmax.v) + ", set in " + s.todayRecordTmax.y + ". " : "") +
        "Heat and drought reinforce each other: with the soil this dry there is little moisture left to evaporate, " +
        "so nearly all the sun's energy goes into heating the air rather than lifting water out of the ground.</p>";
    }

    $("clAnalysis").innerHTML = out;
  }

  /* ── render ───────────────────────────────────────────────────────── */
  function render() {
    if (!S.stats) return;
    renderHero();
    renderAnalysis();
    renderTables();
    charts();
  }

  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#clRefresh")) load(true);
  });
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const p = $("paneClimate");
      if (S.stats && p && p.classList.contains("active")) charts();
    }, 250);
  });

  return {
    open: function () { if (!S.stats && !S.loading) load(false); else if (S.stats) render(); },
    refresh: function () { load(true); },
    stats: function () { return S.stats; }
  };
})();
