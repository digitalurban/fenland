/*
   SIXTH HISTORY CHART — solar radiation and UV index.
   Wraps renderCharts() rather than editing it. Searches whatever the
   Belchertown JSON contains for series with obsType `radiation` and `UV`,
   so it does not care which chart group you put them in. Until those are
   added to graphs.conf it renders the config you need instead of an error.
 */

(function () {
  "use strict";

  const CONF_HINT =
    "Add a new chart to each group in <code>graphs.conf</code>, then wait for the next report cycle. " +
    "Copy the bracket depth from the barometer chart already in your file rather than trusting the " +
    "nesting shown here:" +
    "<pre style='text-align:left;font-size:10px;line-height:1.5;margin:8px 0 0;white-space:pre;overflow-x:auto'>" +
    "[[chart5]]\n" +
    "    title = Solar Radiation and UV\n" +
    "    [[[radiation]]]\n" +
    "        name = Solar Radiation\n" +
    "        yAxis_label = Solar Radiation (W/m&#178;)\n" +
    "        type = area\n" +
    "    [[[UV]]]\n" +
    "        name = UV Index\n" +
    "        yAxis = 1\n" +
    "        yAxis_label = UV Index\n" +
    "        yaxis_max = 12" +
    "</pre>" +
    "<div style='margin-top:6px'>On the <b>month</b> and <b>year</b> groups add " +
    "<code>aggregate_type = max</code> to each series, so you get the daily peak rather than an " +
    "average flattened by the overnight zeros.</div>";

  // Find a series anywhere in the file by its obsType or key name.
  function findSeries(j, names) {
    if (!j) return null;
    for (const ck of Object.keys(j)) {
      if (ck.indexOf("chart") !== 0) continue;
      const ser = j[ck] && j[ck].series;
      if (!ser) continue;
      for (const sk of Object.keys(ser)) {
        const s = ser[sk];
        const id = String((s && s.obsType) || sk).toLowerCase();
        if (names.indexOf(id) > -1 && s.data && s.data.length) return s;
      }
    }
    return null;
  }

  function drawSolar(span) {
    const el = document.getElementById("chartSolar");
    if (!el) return;
    let j = null;
    try {
      j = (typeof chartDataCache !== "undefined") ? chartDataCache[span] : null;
    } catch (e) {}
    if (!j) { el.innerHTML = "<div class='chart-loading'>No data for this span</div>"; return; }

    const rad = findSeries(j, ["radiation", "solarradiation", "solar_radiation"]);
    const uv  = findSeries(j, ["uv", "uvindex", "uv_index"]);

    if (!rad && !uv) {
      el.innerHTML = "<div class='chart-loading' style='text-align:left'>" +
        "<b>Solar radiation and UV are not in this feed yet.</b><br>" + CONF_HINT + "</div>";
      return;
    }
    if (typeof Highcharts === "undefined" || !Highcharts) return;

    const clean = s => (s && s.data ? s.data.filter(p => p && p[1] !== null && p[1] !== undefined) : []);
    const series = [];
    if (rad) series.push({ name: rad.name || "Solar Radiation", type: "area", data: clean(rad), yAxis: 0,
                           color: "#f7a35c", fillOpacity: 0.25, lineWidth: 1.5 });
    if (uv)  series.push({ name: uv.name || "UV Index", type: "line", data: clean(uv), yAxis: 1,
                           dashStyle: "ShortDot", lineWidth: 2 });

    Highcharts.chart("chartSolar", {
      chart: { height: 240 },
      xAxis: { type: "datetime" },
      yAxis: [
        { title: { text: "W/m²" }, min: 0 },
        { title: { text: "UV" }, opposite: true, min: 0, max: 12, gridLineWidth: 0 }
      ],
      series: series
    });
  }

  // hook renderCharts so the sixth chart follows the span switch
  if (typeof renderCharts === "function") {
    const orig = renderCharts;
    renderCharts = function (span) {
      const out = orig.apply(this, arguments);
      Promise.resolve(out).then(function () {
        try { drawSolar(span); } catch (e) { console.warn("solar chart skipped:", e); }
      });
      return out;
    };
  }
})();
