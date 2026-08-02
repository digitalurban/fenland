/*
   FORECAST VERIFICATION PANEL
   Reads verification.json, written nightly by scripts/verify.py, which
   logs each day's forecast and each day's actual station readings and
   scores one against the other by lead time.
   Bias is forecast minus observed: negative means the forecast runs cold.
   MAE is the typical size of the error regardless of direction. POD and
   FAR are the standard rain pair — how often real rain was predicted, and
   how often predicted rain failed to appear.
   Until the script has run a few times this renders setup instructions
   rather than an error.
 */

window.__VERIFY__ = (function () {
  "use strict";

  /* ── configuration ──────────────────────────────────────────────────
     Set station.verification in config.js to the URL of the file written
     by scripts/verify.py. Without it this panel simply stays quiet.      */
  const CFG = (typeof window !== "undefined" && window.WXCONFIG) || {};
  const STATION = CFG.station || {};
  const URL = STATION.verification || "";
  const MIN_DAYS = 3;                 // below this, the numbers mean nothing
  const S = { data: null, loading: false };

  const $ = id => document.getElementById(id);
  const r1 = v => v == null || isNaN(v) ? "–" : (Math.round(v*10)/10).toFixed(1);
  const r2 = v => v == null || isNaN(v) ? "–" : (Math.round(v*100)/100).toFixed(2);
  const sgn = v => v == null ? "–" : (v > 0 ? "+" : "") + r1(v);

  const MODEL_NAMES = {
    best_match:    "Open-Meteo blend",
    ukmo_seamless: "UK Met Office",
    ecmwf_ifs025:  "ECMWF",
    icon_seamless: "DWD ICON",
    gfs_seamless:  "NOAA GFS",
    meteofrance_seamless: "Météo-France"
  };
  const modelName = m => MODEL_NAMES[m] || m;

  /* No verification URL configured — the feature is simply switched off */
  function notConfigured() {
    const el = $("vfBody");
    if (el) el.innerHTML =
      "<div class='vf-waiting'><b>Forecast verification is not set up.</b><br><br>" +
      "This panel scores the forecast against your own station's readings and works out " +
      "which model is most accurate where you actually live. It needs the nightly job in " +
      "<code>scripts/verify.py</code> to build the record, and " +
      "<code>station.verification</code> set in <code>config.js</code> — see " +
      "<code>docs/verification.md</code>.<br><br>" +
      "If you have no weather station, everything else on this page works without it.</div>";
  }

  /* Configured, but nothing at that URL yet — the job has never run */
  function setupNeeded() {
    const el = $("vfBody");
    if (el) el.innerHTML =
      "<div class='vf-waiting'><b>No verification data yet.</b><br><br>" +
      "<code>config.js</code> points at a verification file, but nothing is there. " +
      "Run <code>scripts/verify.py</code> once by hand to check it can reach your " +
      "station and publish its output — see <code>docs/verification.md</code>.</div>";
  }

  /* The job is running, there just isn't enough history yet. Show what it
     has and when it will start saying something, not the install steps. */
  function collecting(j) {
    const n = j.days_collected || 0;
    const models = (j.models || []).length;
    const need = MIN_DAYS - n;
    $("vfBody").innerHTML =
      "<div class='vf-hero'>" +
        "<div class='vf-card'><div class='k'>Days recorded</div><div class='v'>" + n +
          "</div><div class='s'>" + (j.first_date ? "since " + j.first_date : "starting up") + "</div></div>" +
        "<div class='vf-card'><div class='k'>Models tracked</div><div class='v'>" + (models || "–") +
          "</div><div class='s'>scored separately</div></div>" +
        "<div class='vf-card'><div class='k'>First score</div><div class='v'>" +
          (need <= 0 ? "ready" : need + (need === 1 ? " night" : " nights")) +
          "</div><div class='s'>away</div></div>" +
      "</div>" +
      "<div class='vf-waiting'>Logging is working — " + n + " day" + (n === 1 ? "" : "s") +
      " of observations stored" + (models ? " against " + models + " models" : "") + ". " +
      "Each night adds one more comparison, and one more lead time becomes scoreable, " +
      "so the table fills in from the left over the first ten days.<br><br>" +
      "The day-ahead bias starts to mean something after a fortnight. The model league " +
      "table needs longer still — early on it can be decided by a single bad afternoon.</div>";
  }

  async function load() {
    if (S.loading) return;
    if (!URL) { notConfigured(); return; }      // station.verification not set
    S.loading = true;
    try {
      const res = await fetch(URL + "?cacheburst=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      S.data = j; S.loading = false;
      // A scored lead time needs at least one forecast/observation pair, so
      // check for real results rather than just elapsed days
      const scored = (j.all_time || []).some(L => L.n > 0);
      if (!scored || !j.days_collected || j.days_collected < MIN_DAYS) {
        collecting(j);
        return;
      }
      render();
    } catch (e) {
      S.loading = false;
      setupNeeded();
    }
  }

  function pick(list, lead) {
    return (list || []).find(x => x.lead === lead) || null;
  }

  function render() {
    const j = S.data;
    const recent = j.recent && j.recent.length ? j.recent : j.all_time;
    const d1 = pick(recent, 1), d3 = pick(recent, 3), d7 = pick(recent, 7);

    /* headline cards */
    const cards = [];
    if (d1 && d1.tmax) {
      cards.push({ k: "Day-ahead max error", v: r1(d1.tmax.mae) + "°C", s: "typical miss, either way" });
      cards.push({ k: "Day-ahead bias", v: sgn(d1.tmax.bias) + "°C",
        s: d1.tmax.bias < -0.3 ? "runs cold" : d1.tmax.bias > 0.3 ? "runs warm" : "no real lean",
        cls: d1.tmax.bias < -0.3 ? "vf-cold" : d1.tmax.bias > 0.3 ? "vf-warm" : "" });
    }
    if (d3 && d3.tmax) cards.push({ k: "3 days ahead", v: r1(d3.tmax.mae) + "°C", s: "mean absolute error" });
    if (d7 && d7.tmax) cards.push({ k: "7 days ahead", v: r1(d7.tmax.mae) + "°C", s: "mean absolute error" });
    if (d1 && d1.pod != null) cards.push({ k: "Rain detected", v: Math.round(d1.pod*100) + "%",
      s: "of wet days called a day ahead" });
    if (d1 && d1.far != null) cards.push({ k: "False alarms", v: Math.round(d1.far*100) + "%",
      s: "of forecast rain didn't arrive" });
    cards.push({ k: "Record length", v: j.days_collected + " days",
      s: j.first_date ? "since " + j.first_date : "" });

    /* table by lead time */
    const rows = (recent || []).map(L =>
      "<tr><td>" + L.lead + (L.lead === 1 ? " day" : " days") + "</td>" +
      "<td>" + (L.tmax ? sgn(L.tmax.bias) + "°" : "–") + "</td>" +
      "<td>" + (L.tmax ? r1(L.tmax.mae) + "°" : "–") + "</td>" +
      "<td>" + (L.tmin ? sgn(L.tmin.bias) + "°" : "–") + "</td>" +
      "<td>" + (L.tmin ? r1(L.tmin.mae) + "°" : "–") + "</td>" +
      "<td>" + (L.rain ? sgn(L.rain.bias) + " mm" : "–") + "</td>" +
      "<td>" + (L.pod != null ? Math.round(L.pod*100) + "%" : "–") + "</td>" +
      "<td>" + (L.far != null ? Math.round(L.far*100) + "%" : "–") + "</td>" +
      "<td>" + L.n + "</td></tr>").join("");

    $("vfBody").innerHTML =
      "<div class='vf-hero'>" +
        cards.map(c => "<div class='vf-card " + (c.cls || "") + "'><div class='k'>" + c.k +
          "</div><div class='v'>" + c.v + "</div><div class='s'>" + (c.s || "") + "</div></div>").join("") +
      "</div>" +
      "<div class='fc-status' style='margin:0 0 8px'>" +
        (j.recent && j.recent.length ? "LAST " + j.recent_days + " DAYS" : "ALL DATA") +
        " · BIAS IS FORECAST MINUS OBSERVED, SO NEGATIVE MEANS THE FORECAST RAN COLD" +
      "</div>" +
      "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
        "<th>Lead</th><th>Max bias</th><th>Max MAE</th><th>Min bias</th><th>Min MAE</th>" +
        "<th>Rain bias</th><th>Rain found</th><th>False alarm</th><th>Days</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      leagueTable(j) +
      "<div class='ens-analysis' style='margin-top:12px'>" + narrative(j, recent) + "</div>" +
      "<div class='chart-card-body' id='vfChart' style='height:240px;margin-top:12px'></div>";

    chart(j);
  }

  /* Which model is actually best for this field, rather than in general */
  function leagueTable(j) {
    const rows = (j.league_d1 || []).filter(r => r.tmax_mae != null);
    if (rows.length < 2) return "";
    const best = rows[0];
    const d3 = {};
    (j.league_d3 || []).forEach(r => { d3[r.model] = r.tmax_mae; });

    return "<div class='fc-status' style='margin:16px 0 6px'>MODEL LEAGUE TABLE · " +
        "MEAN ABSOLUTE ERROR ON TOMORROW'S MAXIMUM, BEST FIRST</div>" +
      "<div class='stats-table-scroll'><table class='stats-table'><thead><tr>" +
        "<th>Model</th><th>Day-1 error</th><th>Day-1 bias</th><th>Day-3 error</th>" +
        "<th>Rain found</th><th>False alarm</th><th>Days</th>" +
      "</tr></thead><tbody>" +
      rows.map((r, i) =>
        "<tr" + (r.model === j.primary ? " style='font-weight:600'" : "") + ">" +
        "<td>" + (i === 0 ? "🏆 " : "") + modelName(r.model) +
          (r.model === j.primary ? "<span class='stat-at'>shown on this page</span>" : "") + "</td>" +
        "<td>" + r1(r.tmax_mae) + "°C</td>" +
        "<td>" + sgn(r.tmax_bias) + "°C</td>" +
        "<td>" + (d3[r.model] != null ? r1(d3[r.model]) + "°C" : "–") + "</td>" +
        "<td>" + (r.pod != null ? Math.round(r.pod*100) + "%" : "–") + "</td>" +
        "<td>" + (r.far != null ? Math.round(r.far*100) + "%" : "–") + "</td>" +
        "<td>" + r.n + "</td></tr>").join("") +
      "</tbody></table></div>";
  }

  function narrative(j, recent) {
    const d1 = pick(recent, 1);
    if (!d1 || !d1.tmax) return "";
    const bias = d1.tmax.bias, mae = d1.tmax.mae;
    const last = recent[recent.length-1];
    let out = "<p>";

    out += Math.abs(bias) < 0.4
      ? "A day ahead the forecast shows <b>no meaningful bias</b> on maximum temperature — errors fall roughly evenly either side, averaging " + r1(mae) + "°C. "
      : "A day ahead the forecast runs <b>" + r1(Math.abs(bias)) + "°C " + (bias < 0 ? "cold" : "warm") +
        "</b> on maximum temperature, with a typical error of " + r1(mae) + "°C. " +
        (bias < -0.8
          ? "A cold bias of this size during a drought is the expected failure: the model assumes more soil moisture than exists, so it spends energy evaporating water that isn't there instead of heating the air. "
          : "");

    if (last && last.tmax && d1.tmax) {
      const growth = last.tmax.mae / Math.max(d1.tmax.mae, 0.1);
      out += "Error grows to " + r1(last.tmax.mae) + "°C by day " + last.lead +
        (growth > 2.5 ? " — a steep decay, so treat the back half of the ten days as pattern only. "
                      : " — a gentle decay, which is a sign of a well-behaved run of weather. ");
    }
    if (d1.pod != null && d1.far != null) {
      out += "On rain, " + Math.round(d1.pod*100) + "% of genuinely wet days were called a day ahead, while " +
        Math.round(d1.far*100) + "% of forecast rain never arrived" +
        (d1.wet_days < 5 ? " — though with only " + d1.wet_days + " wet days in the record so far, treat both figures as provisional." : ".");
    }
    out += "</p>";

    /* which model wins here */
    const lg = (j.league_d1 || []).filter(r => r.tmax_mae != null);
    if (lg.length >= 2) {
      const best = lg[0], worst = lg[lg.length-1];
      const shown = lg.find(r => r.model === j.primary);
      const gap = worst.tmax_mae - best.tmax_mae;
      out += "<p><b>Which model to believe here.</b> Over the last " + j.recent_days + " days " +
        "<b>" + modelName(best.model) + "</b> has been closest for this location, averaging " +
        r1(best.tmax_mae) + "°C out on tomorrow's maximum against " + r1(worst.tmax_mae) + "°C for " +
        modelName(worst.model) + ". " +
        (shown && shown.model !== best.model
          ? "The page currently shows " + modelName(shown.model) + " at " + r1(shown.tmax_mae) + "°C" +
            (shown.tmax_mae - best.tmax_mae > 0.4
              ? " — a large enough gap to be worth switching the forecast source."
              : ", which is close enough that switching would not gain much.")
          : "That is the source this page already uses.") +
        (best.n < 14 ? " With only " + best.n + " days scored, treat the ordering as provisional — " +
                       "a fortnight of samples can be decided by one bad day." : "") +
        "</p>";
    }
    return out;
  }

  async function chart(j) {
    const el = $("vfChart");
    const s = (j.series || []).filter(p => p.o_tmax != null || p.f_tmax != null);
    if (!el || s.length < 3) { if (el) el.innerHTML = ""; return; }
    try {
      if (typeof ensureHighcharts === "function") await ensureHighcharts();
      if (typeof themeHighcharts === "function") themeHighcharts();
      if (typeof Highcharts === "undefined" || !Highcharts) return;
    } catch (e) { return; }

    const w = window.innerWidth || 1200;
    Highcharts.chart("vfChart", {
      chart: { type: "line", height: w < 560 ? 200 : 240 },
      xAxis: { categories: s.map(p => p.date.slice(5)), tickInterval: Math.ceil(s.length/8) },
      yAxis: { title: { text: "°C max" } },
      tooltip: { shared: true, valueSuffix: " °C", valueDecimals: 1 },
      plotOptions: { series: { marker: { enabled: false }, animation: false } },
      series: [
        { name: "Station measured", data: s.map(p => p.o_tmax), color: "var(--ink)", lineWidth: 2.5 },
        { name: "Forecast, day ahead", data: s.map(p => p.f_tmax), color: "#d97706",
          dashStyle: "ShortDash", lineWidth: 2 }
      ]
    });
  }

  return { load: load, data: function () { return S.data; } };
})();
