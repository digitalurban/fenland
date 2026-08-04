/*
   CHART COLOURS — value-banded lines for every Highcharts chart on the
   page (History, Air Quality and Forecast alike).
   Rather than editing renderCharts(), this wraps Highcharts.chart() and
   injects `zones` into any series whose name it recognises, so the colour
   of a line changes with its value: cold blues through to hot reds,
   Beaufort colours for wind, the AQI band palette for air quality.
   Nothing in the original page is modified. Series that already define
   their own zones are left alone. The only global defined is
   window.__WXCOLOURS__, which also serves as the single source of truth
   for the colour key drawn under the forecast chart.
 */

window.__WXCOLOURS__ = (function () {
  "use strict";

  /* Temperature °C — cold indigo to hot dark red */
  const TEMP = [
    { max: -5,   c: "#3730a3", lbl: "&lt;-5" },
    { max: 0,    c: "#1e40af", lbl: "-5"    },
    { max: 5,    c: "#2563eb", lbl: "0"     },
    { max: 10,   c: "#0ea5e9", lbl: "5"     },
    { max: 15,   c: "#10b981", lbl: "10"    },
    { max: 20,   c: "#eab308", lbl: "15"    },
    { max: 25,   c: "#f97316", lbl: "20"    },
    { max: 30,   c: "#dc2626", lbl: "25"    },
    { max: null, c: "#7f1d1d", lbl: "30+"   }
  ];

  /* Wind mph — the same palette as the wind dial on the dashboard */
  const WIND = [
    { max: 2,    c: "#38bdf8" }, { max: 5,  c: "#22d3ee" }, { max: 8,  c: "#2dd4bf" },
    { max: 13,   c: "#4ade80" }, { max: 19, c: "#a3e635" }, { max: 25, c: "#fde047" },
    { max: 32,   c: "#fbbf24" }, { max: 39, c: "#f59e0b" }, { max: 47, c: "#ea580c" },
    { max: null, c: "#ef4444" }
  ];

  /* AQI — the same bands as the .aqibar gradient */
  const AQI = [
    { max: 50,   c: "#10b981" }, { max: 100, c: "#facc15" }, { max: 150, c: "#f97316" },
    { max: 200,  c: "#ef4444" }, { max: 300, c: "#a855f7" }, { max: null, c: "#7f1d1d" }
  ];

  /* PM2.5 µg/m³ — the US EPA breakpoints your AQI conversion already uses */
  const PM25 = [
    { max: 9,     c: "#10b981" }, { max: 35.4, c: "#facc15" }, { max: 55.4, c: "#f97316" },
    { max: 125.4, c: "#ef4444" }, { max: 225.4, c: "#a855f7" }, { max: null, c: "#7f1d1d" }
  ];

  /* Pressure mbar — stormy lows through to settled highs */
  const BARO = [
    { max: 980,  c: "#7c3aed" }, { max: 1000, c: "#2563eb" }, { max: 1013, c: "#0ea5e9" },
    { max: 1023, c: "#10b981" }, { max: 1035, c: "#eab308" }, { max: null, c: "#f97316" }
  ];

  /* Rain rate mm/hr — drizzle to downpour */
  const RAIN = [
    { max: 0.5,  c: "#93c5fd" }, { max: 4, c: "#3b82f6" }, { max: 8, c: "#1d4ed8" },
    { max: null, c: "#7c3aed" }
  ];

  /* UV index — the WHO exposure categories */
  const UV = [
    { max: 3,    c: "#10b981" }, { max: 6, c: "#facc15" }, { max: 8, c: "#f97316" },
    { max: 11,   c: "#ef4444" }, { max: null, c: "#a855f7" }
  ];

  /* Solar radiation W/m² — overcast through to full summer sun */
  const SOLAR = [
    { max: 100,  c: "#94a3b8" }, { max: 300, c: "#fde047" }, { max: 600, c: "#fbbf24" },
    { max: 900,  c: "#f59e0b" }, { max: null, c: "#ea580c" }
  ];

  const SCALES = { TEMP, WIND, AQI, PM25, BARO, RAIN, UV, SOLAR };

  /* Thresholds are written in metric, but charts plot display units — both
     our own (converted before plotting) and weeWX's (published in whatever the
     user configured). The band edges have to move with them, or a 68°F
     afternoon lands in the ">30" dark-red band. */
  function convertEdge(scale, max) {
    const u = (typeof U !== "undefined") ? U : null;
    if (!u || max == null) return max;
    if (scale === TEMP) return u.axisTemp(max);
    if (scale === RAIN) return u.axisRain(max);
    if (scale === BARO) return u.presUnit === "inHg" ? u.conv.mb2inhg(max) : max;
    return max;                    // wind, AQI, PM2.5, UV, solar: unchanged
  }
  const zones = scale => scale.map(z =>
    z.max == null ? { color: z.c } : { value: convertEdge(scale, z.max), color: z.c });

  // Match a series to a scale by its name. Deliberately loose so it keeps
  // working if a series gets renamed slightly.
  function scaleFor(name) {
    const n = String(name || "").toLowerCase();
    if (!n) return null;
    if (n.indexOf("pm2") === 0 || n.indexOf("pm2") > -1) return PM25;
    if (n.indexOf("aqi") > -1) return AQI;
    if (n.indexOf("gust") > -1 || n.indexOf("wind speed") > -1 || n.indexOf("wind chill") > -1) {
      return n.indexOf("chill") > -1 ? TEMP : WIND;
    }
    if (n.indexOf("uv") > -1) return UV;
    if (n.indexOf("radiation") > -1 || n.indexOf("solar") > -1) return SOLAR;
    if (n.indexOf("temperature") > -1 || n.indexOf("feels like") > -1 || n.indexOf("dew") > -1) return TEMP;
    if (n.indexOf("barometer") > -1 || n.indexOf("pressure") > -1) return BARO;
    if (n.indexOf("rain rate") > -1) return RAIN;
    return null;   // humidity, direction, rain total, probability: left alone
  }

  /* Highcharts draws the legend key in the series' base colour, which zones
     never touch — so a value-coloured line got a legend swatch in the default
     ink, and a yellow line was announced by a black key. There is no gradient
     swatch available, so use the band the series actually spends most of its
     time in: the median. It matches what the eye sees, and it moves with the
     data — a cold week keys blue, a hot one orange. */
  function medianZoneColour(s, z) {
    const ys = (s.data || [])
      .map(p => Array.isArray(p) ? p[1] : (p && typeof p === "object" ? p.y : p))
      .filter(v => typeof v === "number" && isFinite(v))
      .sort((a, b) => a - b);
    if (!ys.length) return null;
    const mid = ys[Math.floor(ys.length / 2)];
    const band = z.find(x => x.value == null || mid <= x.value);
    return band ? band.color : null;
  }

  function decorate(s) {
    if (!s || s.zones || s.type === "scatter") return;   // never touch scatter or pre-zoned series
    const scale = scaleFor(s.name);
    if (!scale) return;
    s.zoneAxis = "y";
    s.zones = zones(scale);
    const key = medianZoneColour(s, s.zones);
    if (key) s.color = key;
  }

  /* ── fill in series the page asks for but never plots ─────────────── */
  // Belchertown aggregates the month and year spans into daily max and daily
  // min series. renderCharts() only plots the max, so a year chart shows the
  // warmest part of each day and never dips below freezing even when the
  // overnight minimum did. Where the JSON carries outTemp_min, add it.
  function enhance(id, cfg) {
    if (!cfg || !cfg.series) return;

    if (id === "chartTemp") {
      try {
        const j = (typeof chartDataCache !== "undefined" && typeof currentChartSpan !== "undefined")
          ? chartDataCache[currentChartSpan] : null;
        const ser = j && j.chart1 && j.chart1.series;
        if (ser) {
          const hasMin = cfg.series.some(s => /min/i.test(s.name || ""));
          const mn = ser.outTemp_min;
          if (!hasMin && mn && mn.data && mn.data.length) {
            cfg.series.push({
              name: mn.name || "Min Temperature", yAxis: 0,
              data: mn.data.filter(p => p && p[1] !== null && p[1] !== undefined)
            });
          }
          // if the JSON says the first series is a daily max, say so
          if (ser.outTemp && /max/i.test(ser.outTemp.name || "")) {
            const t = cfg.series[0];
            if (t && /^temperature$/i.test(t.name || "")) t.name = ser.outTemp.name;
          }
        }
      } catch (e) { console.warn("temp series enhancement skipped:", e); }
    }

    // drop ghost legend entries for series this span has no data for
    const withData = cfg.series.filter(s => s && s.data && s.data.length);
    if (withData.length) cfg.series = withData;

    // Highcharts sizes itself from its config, not CSS, so shrink the
    // history charts on phones and tablets here. Only the History pane's
    // charts (chartTemp, chartWind, …) — the forecast chart sizes itself.
    const w = window.innerWidth || 1200;
    if (id && id.indexOf("chart") === 0 && w < 1024 && cfg.chart && cfg.chart.height) {
      cfg.chart.height = w < 560 ? 190 : 210;
    }
  }

  // true when a span simply has no data for this chart at all
  const isEmpty = cfg => !cfg || !cfg.series || !cfg.series.some(s => s && s.data && s.data.length);

  /* ── patch Highcharts.chart() once it exists ──────────────────────── */
  function patch() {
    // false means "not ready, keep polling"; true means "done, stop"
    if (typeof Highcharts === "undefined" || !Highcharts) return false;
    if (Highcharts.__wxColoured) return true;
    const orig = Highcharts.chart;
    if (typeof orig !== "function") return false;
    Highcharts.chart = function (a, b) {
      const byId = (typeof a === "string");
      const cfg = (byId || (a && a.nodeType)) ? b : a;
      try {
        enhance(byId ? a : null, cfg);
        if (isEmpty(cfg) && byId) {
          // nothing to draw for this span — say so instead of an empty grid
          const el = document.getElementById(a);
          if (el) el.innerHTML = "<div class='chart-loading'>Not recorded for this time span</div>";
          return null;
        }
        if (cfg && cfg.series && cfg.series.forEach) cfg.series.forEach(decorate);
      } catch (e) { console.warn("chart enhancement skipped:", e); }
      return orig.apply(this, arguments);
    };
    Highcharts.__wxColoured = true;
    return true;
  }

  // Highcharts is lazy-loaded, so patch on whichever comes first: it is
  // already present, the page's loader resolves, or a short poll finds it.
  patch();
  /* NOTE: this used to also wrap window.ensureHighcharts, which was dead code —
     that function lives inside dashboard.js's closure and was never global, so
     the wrap never fired. The only thing installing the patch was the 500ms
     poll below, which races the chart code: Highcharts resolves on script load
     and charts are drawn immediately, so anything created inside that window
     got no zones and fell back to the default palette (a blue line). It showed
     up on phones, where the timing is slower. dashboard.js now calls
     __WXCOLOURS__.patch() directly after loading Highcharts; the poll is kept
     only as a backstop for anything that draws by another route. */
  let tries = 0;
  const poll = setInterval(function () {
    if (patch() || ++tries > 60) clearInterval(poll);
  }, 500);

  return { SCALES: SCALES, TEMP_SCALE: TEMP, zones: zones, scaleFor: scaleFor,
           /* Callable so the chart code can guarantee the wrapper is installed
              before it draws, rather than hoping the poll above won already. */
           patch: patch,
           zonesFor: function (name) { const s = scaleFor(name); return s ? zones(s) : []; } };
})();
