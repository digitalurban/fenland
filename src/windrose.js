/*
   SIXTH HISTORY CHART — wind rose.
   Built client-side from the windDir and windSpeed series the page already
   downloads, so it needs no graphs.conf change and works on every span.
   Hand-drawn SVG rather than Highcharts polar, which would need the
   highcharts-more module loading as an extra dependency.
   Each spoke is one of 16 compass sectors; its length is the share of
   observations blowing from that direction, split into speed bands using
   the same palette as the wind dial. Calm records are counted separately
   and shown in the middle, since they have no meaningful direction.
 */

(function () {
  "use strict";

  const DIRS = 16, STEP = 360 / DIRS;

  /* Band edges are written in mph. weeWX publishes wind in whatever the user
     configured, so scale the edges to match rather than mislabelling a 20 km/h
     breeze as 20 mph. */
  const FROM_MPH = { mph: 1, kmh: 1.609344, ms: 0.44704, kn: 0.868976 };
  const WU = String(((window.WXCONFIG || {}).units || {}).wind || "mph").toLowerCase();
  const K = FROM_MPH[WU] || 1;
  const CALM_BELOW = 1.0 * K;
  const LABELS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const EDGES = [4, 8, 13, 19, 25];
  const lbl = n => String(Math.round(n * K));
  const BANDS = [
    { max: EDGES[0]*K, c: "#38bdf8", l: "&lt;" + lbl(4) },
    { max: EDGES[1]*K, c: "#2dd4bf", l: lbl(4)  + "–" + lbl(8)  },
    { max: EDGES[2]*K, c: "#4ade80", l: lbl(8)  + "–" + lbl(13) },
    { max: EDGES[3]*K, c: "#a3e635", l: lbl(13) + "–" + lbl(19) },
    { max: EDGES[4]*K, c: "#fde047", l: lbl(19) + "–" + lbl(25) },
    { max: null,       c: "#f59e0b", l: lbl(25) + "+" }
  ];

  const seriesData = (chart, key) => {
    const s = chart && chart.series && chart.series[key];
    return (s && Array.isArray(s.data)) ? s.data : null;
  };

  // windDir and windSpeed are separate series sharing archive timestamps —
  // join them so each observation has both a direction and a strength.
  function pairUp(j) {
    const c2 = j && j.chart2;
    const dir = seriesData(c2, "windDir");
    if (!dir) return null;
    const spd = seriesData(c2, "windSpeed") || seriesData(c2, "windGust");
    if (!spd) return null;
    const usedGust = !seriesData(c2, "windSpeed");
    const byT = new Map();
    spd.forEach(p => { if (p && p[1] != null) byT.set(p[0], p[1]); });
    const out = [];
    dir.forEach(p => {
      if (!p || p[1] == null) return;
      const s = byT.get(p[0]);
      if (s != null) out.push({ d: p[1], s: s });
    });
    return { pairs: out, usedGust: usedGust };
  }

  const pt = (cx, cy, ang, r) => {
    const t = (ang - 90) * Math.PI / 180;
    return [(cx + r*Math.cos(t)).toFixed(1), (cy + r*Math.sin(t)).toFixed(1)];
  };
  function wedge(cx, cy, a0, a1, r0, r1) {
    const A = pt(cx,cy,a0,r1), B = pt(cx,cy,a1,r1), C = pt(cx,cy,a1,r0), D = pt(cx,cy,a0,r0);
    return "M" + A + "A" + r1 + "," + r1 + " 0 0 1 " + B + "L" + C +
           (r0 > 0 ? "A" + r0 + "," + r0 + " 0 0 0 " + D : "") + "Z";
  }

  function drawRose(span) {
    const el = document.getElementById("chartRose");
    if (!el) return;
    let j = null;
    try { j = (typeof chartDataCache !== "undefined") ? chartDataCache[span] : null; } catch (e) {}
    if (!j) { el.innerHTML = "<div class='chart-loading'>No data for this span</div>"; return; }

    const joined = pairUp(j);
    if (!joined || !joined.pairs.length) {
      el.innerHTML = "<div class='chart-loading'>No wind direction data for this time span</div>";
      return;
    }

    const counts = [], totals = new Array(DIRS).fill(0);
    for (let i = 0; i < DIRS; i++) counts.push(new Array(BANDS.length).fill(0));
    let calm = 0, n = 0;
    joined.pairs.forEach(p => {
      n++;
      if (p.s < CALM_BELOW) { calm++; return; }
      const i = Math.round(((p.d % 360) + 360) % 360 / STEP) % DIRS;
      let b = BANDS.length - 1;
      for (let k = 0; k < BANDS.length; k++) { if (BANDS[k].max != null && p.s < BANDS[k].max) { b = k; break; } }
      counts[i][b]++; totals[i]++;
    });
    if (!n) { el.innerHTML = "<div class='chart-loading'>No usable wind observations</div>"; return; }

    const pct = totals.map(t => t / n * 100);
    const peak = Math.max.apply(null, pct) || 1;
    // round the outer ring up to something readable
    const ring = peak <= 5 ? 5 : peak <= 10 ? 10 : peak <= 20 ? 20 : peak <= 30 ? 30 : Math.ceil(peak/10)*10;

    const W = 340, cx = W/2, cy = W/2, R = 143, r0 = 30;
    const scale = v => r0 + (v / ring) * (R - r0);

    let svg = "<svg viewBox='2 2 " + (W-4) + " " + (W-4) + "' xmlns='http://www.w3.org/2000/svg'>";

    // rings
    [0.25, 0.5, 0.75, 1].forEach(f => {
      svg += "<circle cx='" + cx + "' cy='" + cy + "' r='" + scale(ring*f).toFixed(1) +
             "' fill='none' stroke='var(--faint)' stroke-width='1'/>";
      svg += "<text x='" + (cx + 3) + "' y='" + (cy - scale(ring*f) + 10).toFixed(1) +
             "' font-size='8' font-family='monospace' fill='var(--mist)'>" + (ring*f).toFixed(0) + "%</text>";
    });
    // spokes
    for (let i = 0; i < DIRS; i += 2) {
      const p = pt(cx, cy, i*STEP, R);
      svg += "<line x1='" + cx + "' y1='" + cy + "' x2='" + p[0] + "' y2='" + p[1] +
             "' stroke='var(--faint)' stroke-width='0.5'/>";
    }
    // petals
    for (let i = 0; i < DIRS; i++) {
      let acc = 0;
      const a0 = i*STEP - STEP*0.42, a1 = i*STEP + STEP*0.42;
      for (let b = 0; b < BANDS.length; b++) {
        const share = counts[i][b] / n * 100;
        if (share <= 0) continue;
        const rIn = scale(acc), rOut = scale(acc + share);
        acc += share;
        svg += "<path d='" + wedge(cx, cy, a0, a1, rIn, rOut) + "' fill='" + BANDS[b].c +
               "' stroke='var(--paper)' stroke-width='0.5'/>";
      }
    }
    // compass labels
    ["N","E","S","W"].forEach((lab, k) => {
      const p = pt(cx, cy, k*90, R + 14);
      svg += "<text x='" + p[0] + "' y='" + p[1] + "' font-size='11' font-family='monospace' font-weight='700' " +
             "fill='var(--slate)' text-anchor='middle' dominant-baseline='middle'>" + lab + "</text>";
    });
    // calm centre
    svg += "<circle cx='" + cx + "' cy='" + cy + "' r='" + r0 + "' fill='var(--wash)' stroke='var(--faint)'/>";
    svg += "<text x='" + cx + "' y='" + (cy - 3) + "' font-size='13' font-family='monospace' font-weight='600' " +
           "fill='var(--ink)' text-anchor='middle'>" + (calm/n*100).toFixed(0) + "%</text>";
    svg += "<text x='" + cx + "' y='" + (cy + 9) + "' font-size='7.5' font-family='monospace' " +
           "fill='var(--mist)' text-anchor='middle' letter-spacing='1'>CALM</text>";
    svg += "</svg>";

    const dominant = LABELS[pct.indexOf(Math.max.apply(null, pct))];
    el.innerHTML = "<div class='wr-wrap'>" + svg +
      "<div class='wr-legend'>" +
        BANDS.map(b => "<span><i style='background:" + b.c + "'></i>" + b.l + "</span>").join("") +
        "<span style='color:var(--mist)'>" + (typeof U !== "undefined" ? U.windUnit : "mph") + "</span>" +
      "</div>" +
      "<div class='wr-note'>" + n.toLocaleString() + " observations · prevailing " + dominant +
        " (" + Math.max.apply(null, pct).toFixed(0) + "%)" +
        (joined.usedGust ? " · gust data (no mean wind in this span)" : "") + "</div>" +
      "</div>";
  }

  if (typeof renderCharts === "function") {
    const orig = renderCharts;
    renderCharts = function (span) {
      const out = orig.apply(this, arguments);
      Promise.resolve(out).then(function () {
        try { drawRose(span); } catch (e) { console.warn("wind rose skipped:", e); }
      });
      return out;
    };
  }
})();
