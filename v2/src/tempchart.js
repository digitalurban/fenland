/*
   Fenland — air temperature trend (v2 dashboard)

   Draws a 24-hour air-temperature trace into #tempSvg, under the barograph,
   in the barograph's own visual language: faint gridlines, a wash fill, an
   ink line, a dot at NOW.

   It reads the same file the HISTORY & FORECAST charts already read —
   `<jsonBase>day.json`, series `chart1.series.outTemp` — so nothing new is
   published and dashboard.js is untouched. Station units are honoured the
   same way dashboard.js honours them (CFG.stationUnits.temp), and the
   displayed unit follows window.U, so the °C/°F toggle carries through.

   Like windtrace.js the SVG's viewBox is the measured pixel size of its box,
   so nothing is stretched: at 1920 the frame's k is 1 and a 14px label is
   14 real pixels.
 */
(function () {
  "use strict";

  var CFG = (window.WXCONFIG || {});
  var STATION = CFG.station || {};
  var BASE = STATION.jsonBase || "";
  var SRC_F = String((CFG.stationUnits || {}).temp || "c").toLowerCase() === "f";
  var REFRESH_MS = 5 * 60 * 1000;
  var SPAN_H = 24;

  var series = [];          /* [{hoursAgo, c}] oldest → newest */
  var lastFetch = 0;

  function toC(v) { return SRC_F ? (v - 32) * 5 / 9 : v; }
  function disp(c) { return (window.U && window.U.axisTemp) ? window.U.axisTemp(c) : c; }
  function unit() { return (window.U && window.U.tempUnit) ? window.U.tempUnit : "°C"; }

  function fetchDay() {
    if (!BASE) return Promise.resolve(false);
    return fetch(BASE + "day.json?cacheburst=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var s = j && j.chart1 && j.chart1.series && j.chart1.series.outTemp;
        if (!s || !Array.isArray(s.data)) throw new Error("outTemp series missing");
        var now = Date.now();
        series = s.data
          .filter(function (p) { return p && p[1] !== null && p[1] !== undefined; })
          .map(function (p) { return { hoursAgo: (now - p[0]) / 3600000, c: toC(p[1]) }; })
          .filter(function (p) { return p.hoursAgo >= 0 && p.hoursAgo <= SPAN_H; })
          .sort(function (a, b) { return b.hoursAgo - a.hoursAgo; });
        lastFetch = now;
        return true;
      })
      .catch(function (e) {
        console.warn("Fenland temp trend — day.json unavailable:", e.message);
        return false;
      });
  }

  /* colours.js owns the temperature palette — the same bands the History
     charts zone by and the forecast colour key prints. Reading it from there
     rather than restating it keeps one source of truth; if it has not
     loaded, the trace stays ink and nothing breaks. */
  function tempScale() {
    var w = window.__WXCOLOURS__;
    return (w && w.TEMP_SCALE && w.TEMP_SCALE.length) ? w.TEMP_SCALE : null;
  }

  /* thresholds are °C, and series values are °C, so no conversion here */
  function bandColour(c) {
    var s = tempScale();
    if (!s) return "var(--ink)";
    for (var i = 0; i < s.length; i++) if (s[i].max === null || c <= s[i].max) return s[i].c;
    return s[s.length - 1].c;
  }

  /* A gradient down the plot with hard stops at each band edge paints the
     line by value without splitting it into hundreds of segments. Offsets
     run top (hot) to bottom (cold), which is why the bands are walked in
     reverse. Edges convert to display units because Y() does. */
  function bandGradient(id, Y, yt, yb, lo, hi, dispFn) {
    var s = tempScale();
    if (!s || yb <= yt) return null;
    var clamp = function (o) { return Math.max(0, Math.min(1, o)); };
    var off = function (v) { return clamp((Y(v) - yt) / (yb - yt)); };
    var stops = "", any = false;
    for (var i = s.length - 1; i >= 0; i--) {
      var top = s[i].max === null ? hi : Math.min(dispFn(s[i].max), hi);
      var bot = i === 0 ? lo : Math.max(dispFn(s[i - 1].max), lo);
      if (bot >= top) continue;                       // band outside the view
      var a = off(top), b = off(bot);
      stops += '<stop offset="' + a.toFixed(4) + '" stop-color="' + s[i].c + '"/>' +
               '<stop offset="' + b.toFixed(4) + '" stop-color="' + s[i].c + '"/>';
      any = true;
    }
    if (!any) return null;
    return '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse"' +
           ' x1="0" y1="' + yt.toFixed(1) + '" x2="0" y2="' + yb.toFixed(1) + '">' +
           stops + '</linearGradient></defs>';
  }

  /* Two possible homes: the desktop grid's own cell, and a block this file
     inserts into the phone column. dashboard.js generates that column from a
     template with no temperature section in it, and regenerates it whenever
     #speedSvg_mob goes missing, so the block is re-mounted on a tick rather
     than once. A box of no width is one that is display:none — the desktop
     cell on a phone, and vice versa — so it is skipped. */
  function svgEls() {
    var out = [], ids = ["tempSvg", "tempSvg_mob"], i, el;
    for (i = 0; i < ids.length; i++) {
      el = document.getElementById(ids[i]);
      if (el && el.parentNode && el.parentNode.clientWidth > 20) out.push(el);
    }
    return out;
  }

  function mountMobile() {
    var col = document.getElementById("mobileLayout");
    if (!col || !col.children.length) return false;
    if (document.getElementById("tempSvg_mob")) return false;
    var baro = col.querySelector("section.baro");
    if (!baro) return false;
    var sec = document.createElement("section");
    sec.className = "temp-trend temp-trend-mob";
    sec.innerHTML = '<div class="eyebrow">Air temperature · ' +
      '<span id="tempTrendUnit_mob">24 hours</span></div>' +
      '<div class="temp-chart"><svg id="tempSvg_mob"></svg></div>';
    baro.parentNode.insertBefore(sec, baro.nextSibling);
    return true;
  }

  function message(txt) { svgEls().forEach(function (el) { messageInto(el, txt); }); }

  function messageInto(svg, txt) {
    var box = svg.parentNode, w = box.clientWidth || 600, h = box.clientHeight || 300;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    var mu = Math.max(0.55, Math.min(1.25, w / 750));
    svg.innerHTML = '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle"' +
      ' font-family="var(--mono)" font-size="' + (13 * mu).toFixed(1) + '" letter-spacing=".16em"' +
      ' fill="var(--slate)">' + txt + "</text>";
  }

  function draw() {
    svgEls().forEach(drawInto);
    var u = unit() + " · 24 hours";
    ["tempTrendUnit", "tempTrendUnit_mob"].forEach(function (id) {
      var hd = document.getElementById(id);
      if (hd) hd.textContent = u;
    });
  }

  function drawInto(svg) {
    var box = svg.parentNode;
    var w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    if (!series.length) { messageInto(svg, "AWAITING TEMPERATURE HISTORY"); return; }

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);

    /* The viewBox is the measured box, so type and offsets have to be scaled
       by hand or they stay at a fixed pixel size while the frame shrinks with
       --k (a 0.40 floor at 1024x600, 1.15 at large displays). One factor,
       taken off the width the chart was drawn against, keeps the whole thing
       proportional. */
    var u = Math.max(0.55, Math.min(1.25, w / 750));
    var fs = function (px) { return (px * u).toFixed(1); };

    var mL = Math.round(w * 0.072) + Math.round(30 * u), mR = Math.round(w * 0.02) + Math.round(8 * u);
    var mT = Math.round(h * 0.07) + Math.round(8 * u), mB = Math.round(h * 0.09) + Math.round(16 * u);
    var xs = mL, xe = w - mR, yt = mT, yb = h - mB;

    var vals = series.map(function (p) { return disp(p.c); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(1, (hi - lo) * 0.18);
    lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
    if (hi - lo < 4) { var m = (hi + lo) / 2; lo = Math.floor(m - 2); hi = Math.ceil(m + 2); }

    var X = function (hrs) { return xe - (hrs / SPAN_H) * (xe - xs); };
    var Y = function (v) { return yb - ((v - lo) / (hi - lo)) * (yb - yt); };

    /* gridline step: aim for 5–7 lines whatever the range or the unit */
    var span = hi - lo;
    var step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10;
    var s = "";

    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      var y = Y(v);
      s += '<line x1="' + xs + '" y1="' + y.toFixed(1) + '" x2="' + xe + '" y2="' + y.toFixed(1) +
           '" stroke="var(--faint)" stroke-width="1.2"/>';
      s += '<text x="' + (xs - 12 * u).toFixed(1) + '" y="' + (y + 5 * u).toFixed(1) + '" text-anchor="end"' +
           ' font-family="var(--mono)" font-size="' + fs(14) + '" fill="var(--slate)">' + v + "</text>";
    }
    for (var hr = SPAN_H; hr >= 0; hr -= 4) {
      var x = X(hr);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + yt + '" x2="' + x.toFixed(1) + '" y2="' + yb +
           '" stroke="var(--faint)" stroke-width="1.2"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (yb + 22 * u).toFixed(1) + '" text-anchor="middle"' +
           ' font-family="var(--mono)" font-size="' + fs(13) + '" fill="var(--slate)">' +
           (hr === 0 ? "NOW" : "-" + hr + "h") + "</text>";
    }

    /* freezing line, only when it is actually in view */
    var frost = disp(0);
    if (frost > lo && frost < hi) {
      s += '<line x1="' + xs + '" y1="' + Y(frost).toFixed(1) + '" x2="' + xe + '" y2="' + Y(frost).toFixed(1) +
           '" stroke="var(--accent)" stroke-width="2" stroke-dasharray="7 6" opacity="0.75"/>';
      s += '<text x="' + (xs + 10 * u).toFixed(1) + '" y="' + (Y(frost) - 8 * u).toFixed(1) + '"' +
           ' font-family="var(--mono)" font-size="' + fs(11) + '" font-weight="700" letter-spacing=".10em"' +
           ' fill="var(--accent)">FREEZING</text>';
    }

    var gradId = "tempBands";
    var grad = bandGradient(gradId, Y, yt, yb, lo, hi, disp);
    if (grad) s = grad + s;
    /* The colour goes in the FILL, not the stroke. As a 3px line the scale's
       mid bands (#eab308 at 15-20°C especially) read as muddy brown, and the
       line is also the thing you follow, so it wants the strongest contrast
       on the page. Tinted underneath, it says the same thing quietly. */
    var washFill = grad ? "url(#" + gradId + ")" : "var(--wash)";

    var pts = series.map(function (p) { return X(p.hoursAgo).toFixed(1) + "," + Y(disp(p.c)).toFixed(1); });
    s += '<polygon points="' + X(series[0].hoursAgo).toFixed(1) + "," + yb + " " +
         pts.join(" ") + " " + X(series[series.length - 1].hoursAgo).toFixed(1) + "," + yb +
         '" fill="' + washFill + '" opacity="' + (grad ? "0.3" : "1") + '"/>';
    s += '<polyline points="' + pts.join(" ") +
         '" fill="none" stroke="var(--ink)" stroke-width="' + (3.5 * u).toFixed(1) +
         '" stroke-linejoin="round" stroke-linecap="round"/>';

    /* the day's extremes, marked on the trace rather than listed beside it */
    var peak = series[0], trough = series[0];
    series.forEach(function (p) { if (p.c > peak.c) peak = p; if (p.c < trough.c) trough = p; });
    [[peak, -1, "MAX"], [trough, 1, "MIN"]].forEach(function (m) {
      var p = m[0], dir = m[1], px = X(p.hoursAgo), py = Y(disp(p.c));
      s += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) +
           '" r="' + (4 * u).toFixed(1) + '" fill="var(--paper)" stroke="var(--max-marker)" stroke-width="' +
           (2.5 * u).toFixed(1) + '"/>';
      /* the label sits above the peak and below the trough, and is kept
         inside the plot rect at both ends — at the --k floor there is not
         much room outside it */
      var half = 38 * u;
      var lx = Math.min(Math.max(px, xs + half), xe - half);
      var ly = Math.min(Math.max(py + dir * 16 * u, yt + 13 * u), yb - 5 * u);
      s += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle"' +
           ' font-family="var(--mono)" font-size="' + fs(12) + '" font-weight="700" letter-spacing=".06em"' +
           ' fill="var(--max-marker)">' + m[2] + " " + disp(p.c).toFixed(1) + "</text>";
    });

    var last = series[series.length - 1];
    s += '<circle cx="' + X(last.hoursAgo).toFixed(1) + '" cy="' + Y(disp(last.c)).toFixed(1) +
         '" r="' + (6.5 * u).toFixed(1) + '" fill="' + bandColour(last.c) +
         '" stroke="var(--paper)" stroke-width="' + (1.6 * u).toFixed(1) + '"/>';
    s += '<rect x="' + xs + '" y="' + yt + '" width="' + (xe - xs) + '" height="' + (yb - yt) +
         '" fill="none" stroke="var(--mist)" stroke-width="1.5"/>';

    svg.innerHTML = s;
  }

  function boot() {
    mountMobile();
    message("LOADING TEMPERATURE HISTORY");
    fetchDay().then(draw);
    setInterval(function () { fetchDay().then(draw); }, REFRESH_MS);
    /* same reason windtrace.js ticks: the phone column is thrown away and
       rebuilt on resize and on some updates, taking the block with it */
    setInterval(function () { if (mountMobile()) draw(); }, 1000);

    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 150); });
    /* the unit and theme toggles both repaint the page; redraw after them */
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".foot-action, .unit-toggle, #themeToggle")) {
        setTimeout(draw, 60);
      }
    });
  }

  /* The trace lives in the bar layout's right-hand column; the dial layout
     has no slot for it, so it stands down with the rest of that skin. */
  if (String((CFG.windPanel || "bars")).toLowerCase() === "dials") return;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__FENLAND_TEMPTREND__ = { redraw: draw, refresh: function () { return fetchDay().then(draw); } };
})();
