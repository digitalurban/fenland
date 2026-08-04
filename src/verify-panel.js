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
  const sgn = v => U.dtSigned(v);            // bias and error: differences

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
      cards.push({ k: "Day-ahead max error", v: U.dt(d1.tmax.mae), s: "typical miss, either way" });
      cards.push({ k: "Day-ahead bias", v: sgn(d1.tmax.bias),
        s: d1.tmax.bias < -0.3 ? "runs cold" : d1.tmax.bias > 0.3 ? "runs warm" : "no real lean",
        cls: d1.tmax.bias < -0.3 ? "vf-cold" : d1.tmax.bias > 0.3 ? "vf-warm" : "" });
    }
    if (d3 && d3.tmax) cards.push({ k: "3 days ahead", v: U.dt(d3.tmax.mae), s: "mean absolute error" });
    if (d7 && d7.tmax) cards.push({ k: "7 days ahead", v: U.dt(d7.tmax.mae), s: "mean absolute error" });
    if (d1 && d1.pod != null) cards.push({ k: "Rain detected", v: Math.round(d1.pod*100) + "%",
      s: "of wet days called a day ahead" });
    if (d1 && d1.far != null) cards.push({ k: "False alarms", v: Math.round(d1.far*100) + "%",
      s: "of forecast rain didn't arrive" });
    cards.push({ k: "Record length", v: j.days_collected + " days",
      s: j.first_date ? "since " + j.first_date : "" });

    /* table by lead time */
    const rows = (recent || []).map(L =>
      "<tr><td>" + L.lead + (L.lead === 1 ? " day" : " days") + "</td>" +
      "<td>" + (L.tmax ? sgn(L.tmax.bias) : "–") + "</td>" +
      "<td>" + (L.tmax ? U.dt(L.tmax.mae) : "–") + "</td>" +
      "<td>" + (L.tmin ? sgn(L.tmin.bias) : "–") + "</td>" +
      "<td>" + (L.tmin ? U.dt(L.tmin.mae) : "–") + "</td>" +
      "<td>" + (L.rain ? U.r(L.rain.bias) : "–") + "</td>" +
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
        "<th>Wind error</th><th>Gust error</th><th>Wind &times;scale</th>" +
        "<th>Rain found</th><th>False alarm</th><th>Days</th>" +
      "</tr></thead><tbody>" +
      rows.map((r, i) =>
        "<tr" + (r.model === j.primary ? " style='font-weight:600'" : "") + ">" +
        "<td>" + (i === 0 ? "🏆 " : "") + modelName(r.model) +
          (r.model === j.primary ? "<span class='stat-at'>shown on this page</span>" : "") + "</td>" +
        "<td>" + U.dt(r.tmax_mae) + "</td>" +
        "<td>" + sgn(r.tmax_bias) + "</td>" +
        "<td>" + (d3[r.model] != null ? U.dt(d3[r.model]) : "–") + "</td>" +
        "<td>" + (r.wind_mae != null ? U.w(r.wind_mae, 1) : "–") + "</td>" +
        "<td>" + (r.gust_mae != null ? U.w(r.gust_mae, 1) : "–") + "</td>" +
        "<td>" + (r.wind_scaled_mae != null ? U.w(r.wind_scaled_mae, 1) : "–") + "</td>" +
        "<td>" + (r.pod != null ? Math.round(r.pod*100) + "%" : "–") + "</td>" +
        "<td>" + (r.far != null ? Math.round(r.far*100) + "%" : "–") + "</td>" +
        "<td>" + r.n + "</td></tr>").join("") +
      "</tbody></table></div>" + siteFactorNote(j) + windScaleAdvice(j) + windCalibration(j);
  }

  /* Wind is scored against a 10m equivalent, not against the raw reading.
     Say so on the panel — an unexplained adjustment is worse than none. */
  function siteFactorNote(j) {
    const f = j.site_wind_factor;
    if (!f || !f.speed) {
      return (j.league_d1 || []).some(r => r.wind_mae != null) ? "" :
        "<div class='cl-note' style='margin-top:6px'>WIND AND GUST ARE NOT SCORED YET \u2014 " +
        "THAT NEEDS ABOUT A MONTH OF WIND HISTORY ALONGSIDE THE MODEL.</div>";
    }
    const pct = Math.round(f.speed * 100);
    const ts = j.wind_scale_tested;
    const scaleNote = ts ? " THE FINAL COLUMN INSTEAD APPLIES A FIXED \u00D7" +
      Number(ts.wind).toFixed(2) + ", THE CORRECTION YOU ARE CONSIDERING AT SOURCE \u2014 " +
      "WHICHEVER COLUMN SHOWS THE LOWER ERROR IS THE BETTER FIT FOR THIS SITE." : "";
    /* Gusts were added to the forecast fetch after wind, so there is a spell
       where wind scores and gust does not. A column of dashes with no reason
       given reads as a fault. */
    const rows = j.league_d1 || [];
    const gustPending = rows.some(r => r.wind_mae != null) &&
                        rows.every(r => r.gust_mae == null);
    const pending = gustPending
      ? " GUST IS NOT SCORED YET \u2014 IT NEEDS A FORECAST ISSUED AFTER GUSTS WERE ADDED, " +
        "AND THE DAY IT COVERS TO HAVE HAPPENED. IT WILL APPEAR AFTER THE NEXT NIGHTLY RUN."
      : "";
    return "<div class='cl-note' style='margin-top:6px'>" +
      "WIND AND GUST ERRORS ARE MEASURED AGAINST A 10&thinsp;M EQUIVALENT. THIS STATION READS " +
      pct + "% OF THE OPEN-TERRAIN REFERENCE \u2014 NORMAL FOR A LOWER MAST AMONG TREES OR " +
      "BUILDINGS \u2014 SO READINGS ARE DIVIDED BY " + f.speed.toFixed(2) +
      " BEFORE COMPARING, OR EVERY MODEL WOULD SHOW THE SAME LARGE NEGATIVE BIAS THAT " +
      "MEASURES THE MAST RATHER THAN THE FORECAST." + scaleNote + pending + "</div>";
  }

  /* The measured factor, which moves — as against the recommendation, which
     doesn't. Worth showing both: if they diverge, the gap is shelter, and if
     the monthly figures swing about, no single number fits the site. */
  function windCalibration(j) {
    const c = j.wind_calibration;
    if (!c) return "";
    if (c.status === "collecting") {
      return "<div class='cl-note' style='margin-top:6px'>MEASURED CALIBRATION: " +
             c.days + " OF " + c.days_needed + " DAYS.</div>";
    }
    const months = (c.monthly || []);
    const bars = months.map(m => {
      const f = Number(m.factor);
      return "<td style='text-align:center'>" + m.month.slice(5) +
             "<br><b>&times;" + f.toFixed(2) + "</b></td>";
    }).join("");

    const drift = c.spread >= 0.15
      ? " IT VARIES BY " + Number(c.spread).toFixed(2) + " ACROSS THE YEAR, WHICH IS A LOT " +
        "— DECIDUOUS SHELTER CHANGES WITH THE SEASONS, SO NO SINGLE FIGURE FITS " +
        "EVERY MONTH."
      : " IT HAS HELD STEADY ACROSS THE YEAR, SO A SINGLE FIGURE FITS THIS SITE WELL.";

    return "<div class='vf-hero' style='margin-top:12px;display:block'>" +
      "<div class='fc-status' style='margin-bottom:4px'>MEASURED CALIBRATION &nbsp;" +
      "<b style='font-size:1.15em'>&times;" + Number(c.calibrated_factor).toFixed(2) +
      "</b></div>" +
      "<div class='ens-analysis'>What this station would need to match the " +
      "reanalysis exactly, from " + c.days + " days of its own readings" +
      (c.window_days ? ", over the last " + c.window_days + " days" : "") +
      ". This corrects shelter as well as height, so it is higher than the " +
      "recommendation above — use it to watch the site, not as the " +
      "correction to apply.</div>" +
      (months.length > 1
        ? "<div class='stats-table-scroll' style='margin-top:8px'><table class='stats-table'>" +
          "<tbody><tr>" + bars + "</tr></tbody></table></div>"
        : "") +
      "<div class='cl-note' style='margin-top:6px'>" + drift.trim() + "</div>" +
      "</div>";
  }

  /* What correction, if any, this station should apply — and why not more. */
  function windScaleAdvice(j) {
    const a = j.wind_scale_advice;
    if (!a) return "";
    if (a.status === "collecting") {
      return "<div class='cl-note' style='margin-top:6px'>WIND CORRECTION ADVICE: " +
             a.days + " OF " + a.days_needed + " DAYS COLLECTED.</div>";
    }
    const head = a.recommended
      ? "SUGGESTED WIND SCALE &nbsp;<b style='font-size:1.15em'>&times;" +
        Number(a.recommended).toFixed(2) + "</b>"
      : "WIND SCALE &mdash; NO CORRECTION RECOMMENDED";
    return "<div class='vf-hero' style='margin-top:12px;display:block'>" +
      "<div class='fc-status' style='margin-bottom:4px'>" + head + "</div>" +
      "<div class='ens-analysis'>" + String(a.note || "") + "</div>" +
      (a.recommended
        ? "<div class='cl-note' style='margin-top:6px'>SET <code>windScale: " +
          Number(a.recommended).toFixed(2) + "</code> IN CONFIG.JS TO APPLY IT TO THE " +
          "DISPLAY, OR THE EQUIVALENT OFFSET IN WEEWX OR CUMULUS TO APPLY IT AT SOURCE. " +
          "BASED ON " + a.days + " DAYS.</div>"
        : "") +
      "</div>";
  }

  function narrative(j, recent) {
    const d1 = pick(recent, 1);
    if (!d1 || !d1.tmax) return "";
    const bias = d1.tmax.bias, mae = d1.tmax.mae;
    const last = recent[recent.length-1];
    let out = "<p>";

    out += Math.abs(bias) < 0.4
      ? "A day ahead the forecast shows <b>no meaningful bias</b> on maximum temperature — errors fall roughly evenly either side, averaging " + U.dt(mae) + ". "
      : "A day ahead the forecast runs <b>" + U.dt(Math.abs(bias)) + " " + (bias < 0 ? "cold" : "warm") +
        "</b> on maximum temperature, with a typical error of " + U.dt(mae) + ". " +
        (bias < -0.8
          ? "A cold bias of this size during a drought is the expected failure: the model assumes more soil moisture than exists, so it spends energy evaporating water that isn't there instead of heating the air. "
          : "");

    if (last && last.tmax && d1.tmax) {
      const growth = last.tmax.mae / Math.max(d1.tmax.mae, 0.1);
      out += "Error grows to " + U.dt(last.tmax.mae) + " by day " + last.lead +
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
        U.dt(best.tmax_mae) + " out on tomorrow's maximum against " + U.dt(worst.tmax_mae) + " for " +
        modelName(worst.model) + ". " +
        (shown && shown.model !== best.model
          ? "The page currently shows " + modelName(shown.model) + " at " + U.dt(shown.tmax_mae) +
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
      yAxis: { title: { text: U.tempUnit + " max" } },
      tooltip: { shared: true, valueSuffix: " " + U.tempUnit, valueDecimals: 1 },
      plotOptions: { series: { marker: { enabled: false }, animation: false } },
      series: [
        { name: "Station measured", data: s.map(p => U.axisTemp(p.o_tmax)), color: "var(--ink)", lineWidth: 2.5 },
        { name: "Forecast, day ahead", data: s.map(p => U.axisTemp(p.f_tmax)), color: "#d97706",
          dashStyle: "ShortDash", lineWidth: 2 }
      ]
    });
  }

  return { load: load, data: function () { return S.data; } };
})();
