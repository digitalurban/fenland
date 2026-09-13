/*
   Fenland — units

   Everything in Fenland is computed in metric: °C, mm, mb, and wind in
   whatever the API was asked for. This module is the only place that turns
   those into what the reader sees.

   The rule that matters:

       a TEMPERATURE converts as  F = C * 9/5 + 32
       a DIFFERENCE  converts as  F = C * 9/5

   Bias, anomaly, spread, mean absolute error and the 10–90% range are all
   differences. Passing them through the temperature conversion gives numbers
   that look reasonable and are completely wrong — "the forecast runs 29.3°F
   cold" instead of "2.7°F cold". Use U.dt() for those, never U.t().

   Set units in config.js:

       units: { temp: "f", rain: "in", pressure: "inhg", wind: "mph" }

   Anything omitted defaults to metric.
 */

window.U = (function () {
  "use strict";

  const CFG = (typeof window !== "undefined" && window.WXCONFIG) || {};
  const UNITS = CFG.units || {};

  const TEMP = String(UNITS.temp || "c").toLowerCase().replace("°", "");
  const RAIN = String(UNITS.rain || "mm").toLowerCase();
  const PRES = String(UNITS.pressure || "mb").toLowerCase();
  const WIND = String(UNITS.wind || "mph").toLowerCase();

  const isF = TEMP === "f" || TEMP === "fahrenheit";
  const isIn = RAIN === "in" || RAIN === "inch" || RAIN === "inches";
  const isInHg = PRES === "inhg" || PRES === "in";

  const num = v => (v == null || v === "" || isNaN(v)) ? null : +v;
  const round = (v, dp) => v == null ? null : (Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp)).toFixed(dp);

  /* ── conversion ─────────────────────────────────────────────────────── */
  const c2f  = c => c * 9 / 5 + 32;      // a temperature
  const dc2f = c => c * 9 / 5;           // a difference between temperatures
  const mm2in = mm => mm / 25.4;
  const mb2inhg = mb => mb * 0.0295299830714;

  /* ── labels ─────────────────────────────────────────────────────────── */
  const tempUnit  = isF ? "°F" : "°C";
  const rainUnit  = isIn ? "in" : "mm";
  const presUnit  = isInHg ? "inHg" : "mb";
  const windUnit  = { mph: "mph", kmh: "km/h", ms: "m/s", kn: "kn" }[WIND] || WIND;

  /* Rainfall needs more decimals in inches — 0.2mm is 0.008in, and rounding
     that to one place would report every wet day as bone dry. */
  const rainDp = isIn ? 2 : 1;

  const API = {
    isFahrenheit: isF,
    isInches: isIn,

    tempUnit, rainUnit, presUnit, windUnit,

    /* NOTE: there is deliberately no helper for asking the API for imperial
       units. Everything must arrive metric, because every threshold, ranking
       and confidence rating in the project is written in metric. Convert at
       the point of display and nowhere else. */

    /* ── a temperature ────────────────────────────────────────────────── */
    t: function (c, dp) {
      const v = num(c); if (v == null) return "–";
      return round(isF ? c2f(v) : v, dp == null ? 1 : dp) + tempUnit;
    },
    /* value only, no unit — for tables with a unit in the header */
    tv: function (c, dp) {
      const v = num(c); if (v == null) return "–";
      return round(isF ? c2f(v) : v, dp == null ? 1 : dp);
    },
    /* ── a DIFFERENCE between temperatures — bias, anomaly, spread ────── */
    dt: function (c, dp) {
      const v = num(c); if (v == null) return "–";
      return round(isF ? dc2f(v) : v, dp == null ? 1 : dp) + tempUnit;
    },
    /* signed difference, e.g. "+2.7°F" */
    dtSigned: function (c, dp) {
      const v = num(c); if (v == null) return "–";
      const out = isF ? dc2f(v) : v;
      return (out > 0 ? "+" : "") + round(out, dp == null ? 1 : dp) + tempUnit;
    },

    /* ── rainfall ─────────────────────────────────────────────────────── */
    r: function (mm, dp) {
      const v = num(mm); if (v == null) return "–";
      return round(isIn ? mm2in(v) : v, dp == null ? rainDp : dp) + " " + rainUnit;
    },
    rv: function (mm, dp) {
      const v = num(mm); if (v == null) return "–";
      return round(isIn ? mm2in(v) : v, dp == null ? rainDp : dp);
    },

    /* ── pressure ─────────────────────────────────────────────────────── */
    p: function (mb, dp) {
      const v = num(mb); if (v == null) return "–";
      return round(isInHg ? mb2inhg(v) : v, dp == null ? (isInHg ? 2 : 0) : dp) + " " + presUnit;
    },
    dp: function (mb, dp) {          // a pressure change — same scale factor
      const v = num(mb); if (v == null) return "–";
      return round(isInHg ? mb2inhg(v) : v, dp == null ? (isInHg ? 2 : 1) : dp) + " " + presUnit;
    },

    /* ── wind ─────────────────────────────────────────────────────────── */
    w: function (v, dp) {
      const n = num(v); if (n == null) return "–";
      return round(n, dp == null ? 0 : dp) + " " + windUnit;
    },

    /* ── raw converters, for chart axes and thresholds ────────────────── */
    conv: { c2f, dc2f, mm2in, mb2inhg },

    /* Convert a metric threshold for display on a chart axis. Charts plot
       converted values, so their gridlines and colour bands must move too. */
    axisTemp: c => isF ? c2f(c) : c,
    axisRain: mm => isIn ? mm2in(mm) : mm
  };

  return API;
})();
