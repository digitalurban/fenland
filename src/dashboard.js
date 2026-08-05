/*
   Fenland — live dashboard

   Gauges, tiles and the barograph, fed either by MQTT or by polling a
   JSON file. Extracted from a working weeWX site; the layout logic is
   unchanged, only the configuration has been lifted out.
 */

/* ── Hardware UI Viewport Scaler Engine ── */
    /* The layout used to be a fixed 1872x1404 canvas that this function
       scaled to fit the viewport. It is now fluid CSS instead (see the
       1024px media query in dashboard.css), so all this needs to do is
       undo anything a cached copy of the old version may have left behind. */
    function applyScale() {
      const el = document.getElementById('scaler');
      if (el) { el.style.transform = ''; el.style.width = ''; el.style.height = ''; }
      document.body.style.width = '';
      document.body.style.height = '';
    }
    window.addEventListener('resize', applyScale);
    window.addEventListener('DOMContentLoaded', applyScale); 

  /* Bump on release. Shown in the footer credit and worth quoting in any
     bug report — "which version are you on" is the first question. */
  const FENLAND = {
    version: "1.9.5",
    url: "https://github.com/digitalurban/fenland"
  };

  /* ── configuration ────────────────────────────────────────────────────
     Everything below comes from config.js. Fenland supports two ways of
     getting live data:

       MQTT     — instant, needs a broker with anonymous read over wss://
       polling  — fetches a JSON file every few seconds, needs nothing

     Set whichever you have. If both are present MQTT wins and polling is
     used only as a fallback when the broker cannot be reached.            */
  const CFG = (window.WXCONFIG || {});
  const STATION = CFG.station || {};
  const MQTTCFG = CFG.mqtt || {};

  const WS_URL = MQTTCFG.url || "";
  const WS_TOPIC = MQTTCFG.loopTopic || "";
  const TOPIC_WIND_MAX = MQTTCFG.windMaxTopic || "";
  const TOPIC_WIND_DIR10 = MQTTCFG.windDirTopic || "";
  const TOPIC_TEMP_MIN = MQTTCFG.tempMinTopic || "";
  const TOPIC_TEMP_MAX = MQTTCFG.tempMaxTopic || "";
  const TOPIC_AIRGRADIENT = MQTTCFG.airGradientTopic || "";
  const TOPIC_LIGHTNING = MQTTCFG.lightningTopic || "";
  const TOPIC_LIGHTNING_DISTANCE = MQTTCFG.lightningDistanceTopic || "";
  const TOPIC_AQI_TREND = MQTTCFG.aqiTrendTopic || "";

  /* polling fallback — a JSON file with the same shape as the loop packet */
  const POLL_URL = STATION.loopJson || "";
  const POLL_MS = (CFG.pollSeconds || 20) * 1000;

  const HISTORY_FILE_URL = STATION.pressureHistory || "";
  const WEEWX_JSON_URL = STATION.weewxJson || "";
  const WEEWX_JSON_REFRESH_MS = 5 * 60 * 1000;
  const HISTORY_REFRESH_MS = 5 * 60 * 1000;
  const LIVE = (typeof window !== 'undefined' && window.__STATION__) ? window.__STATION__ : null;


  /* ── barometric tendency forecast ────────────────────────────────────
     A pressure-band + 3-hour-tendency rule with a wind-direction modifier —
     the same family as the Negretti & Zambra barometer tables of the 1850s.

     It is regional, and worth being honest about why. The band edges below
     (1024 / 1012 / 1000 mb) are temperate-maritime values: in a continental
     interior they are too narrow, and in the tropics sea-level pressure
     barely moves, so a station there would sit in one band permanently.

     The wind clause is sharper still. Easterly-through-southerly flow means
     humid air only in the Northern Hemisphere; south of the equator the
     circulation around a low runs the other way, so the sector is mirrored
     about the east-west axis. The reversal is settled physics — the exact
     sector is a heuristic in either hemisphere.

     Set `nowcast: false` in config.js to hide the panel entirely.          */
  const NOWCAST_ON = CFG.nowcast !== false;
  const HUMID_SECTOR = (CFG.lat != null && CFG.lat < 0) ? [340, 110] : [70, 200];
  const inSector = (deg, [a, b]) =>
    a <= b ? (deg >= a && deg <= b) : (deg >= a || deg <= b);

  /* ── what YOUR STATION publishes ──────────────────────────────────────
     Separate from `units`, which is what the page DISPLAYS. A US station
     publishing °F, inHg and inches can be displayed in metric, and a metric
     station in Fahrenheit — the two are independent.

     Values are converted to metric here, on the way in, because every
     threshold and comparison in Fenland is written in metric. Display
     conversion happens later, in units.js.                                */
  const SU = Object.assign({ temp: "c", rain: "mm", pressure: "mb", wind: "mph" },
                           CFG.stationUnits || {});
  const _su = k => String(SU[k] || "").toLowerCase();

  const inTemp2C = v => v == null ? v : (_su("temp") === "f" ? (v - 32) * 5 / 9 : v);
  /* A temperature DIFFERENCE — a trend, a spread, an anomaly — converts by
     ratio alone. Subtracting 32 from a difference is the classic way to get
     a plausible-looking wrong number, so these are deliberately separate. */
  const inTempDiff2C = v => v == null ? v : (_su("temp") === "f" ? v * 5 / 9 : v);
  const inRain2mm = v => {
    if (v == null) return v;
    const u = _su("rain");
    return u === "in" || u === "inch" ? v * 25.4 : u === "cm" ? v * 10 : v;
  };
  const inPres2mb = v => {
    if (v == null) return v;
    const u = _su("pressure");
    return u === "inhg" || u === "in" ? v / 0.0295299830714 : u === "kpa" ? v * 10 : v;
  };
  /* Wind is the exception: it is never compared against a metric threshold,
     so it only needs to reach the unit being displayed. */
  const WIND_TO_MPH = { mph: 1, kmh: 0.621371, ms: 2.23694, kn: 1.15078 };
  const MPH_TO_WIND = { mph: 1, kmh: 1.609344, ms: 0.44704, kn: 0.868976 };
  /* The wind dial's face — colour bands, Beaufort marks, ticks and range —
     was drawn in mph. Now that readings arrive in the display unit, the face
     has to be drawn in it too, or the needle points at the wrong band.
     60 mph rounded to something a dial can sensibly be numbered in: */
  const DIAL = { mph: { max: 60,  maj: 10 }, kmh: { max: 100, maj: 20 },
                 ms:  { max: 30,  maj: 5  }, kn:  { max: 55,  maj: 10 } };
  const DISP_WIND = String((CFG.units && CFG.units.wind) || "mph").toLowerCase();
  const DIAL_MAX = (DIAL[DISP_WIND] || DIAL.mph).max;
  const DIAL_MAJ = (DIAL[DISP_WIND] || DIAL.mph).maj;

  /* Optional standardisation to a 10m equivalent. A mast lower than 10m reads
     a fixed fraction of the reference wind — pure height, over rough ground,
     costs roughly 15% at 6m. Set `windScale` to correct for it.

     Display only. The archive weeWX keeps stays exactly what the instrument
     measured, so nothing is rewritten and the correction can be changed or
     removed at any time. The footer states the factor, because an adjusted
     reading presented as raw is worse than no adjustment.

     Note what it cannot fix: shelter from nearby trees or buildings is real
     wind at your site, not an instrument error. Scaling it away makes the
     number match a model rather than reality. Correct for height; think
     harder before correcting for exposure. */
  const WIND_SCALE = Number(CFG.windScale) > 0 ? Number(CFG.windScale) : 1;

  const inWind = v => {
    if (v == null) return v;
    const from = WIND_TO_MPH[_su("wind")] || 1;
    const to = MPH_TO_WIND[String((CFG.units && CFG.units.wind) || "mph").toLowerCase()] || 1;
    return v * from * to * WIND_SCALE;
  };

  /* ── loop packet field names ──────────────────────────────────────────
     The keys Fenland looks for in the MQTT payload (or the polled JSON). The
     defaults match weewx-mqtt with `append_units_label = True` publishing
     METRICWX.

     Values must be METRIC — °C, mm, mbar — whatever units you display in.
     Fenland computes in metric and converts only for display, so a station
     publishing °F would be misread. One line in weewx.conf handles it:

         [[MQTT]]
             unit_system = METRICWX
             append_units_label = True

     If you cannot change what your station publishes — because Home Assistant
     or something else consumes the same topic — override the names below in
     config.js instead. Only list the ones that differ.                     */
  const FIELD = Object.assign({
    temp:        "outTemp_C",
    appTemp:     "appTemp_C",
    dewpoint:    "dewpoint_C",
    humidex:     "humidex_C",
    inTemp:      "inTemp_C",
    inHumidity:  "inHumidity",
    outHumidity: "outHumidity",
    barometer:   "barometer_mbar",
    windSpeed:   "windSpeed_mph",
    windGust:    "windGust_mph",
    windGust10:  "windGust10",
    windDir:     "windDir",
    dayRain:     "dayRain_mm",
    stormRain:   "stormRain",
    rainRate:    "rainRate_mm_per_hour",
    radiation:   "radiation_Wpm2",
    uv:          "UV",
    cloudbase:   "cloudbase_meter",
    beaufort:    "beaufort_count"
  }, CFG.fields || {});

  /* The default field names assume METRICWX with wind overridden to mph — a
     common weeWX setup, but not the only one. A plain METRICWX feed publishes
     wind in m/s under a matching key, and METRIC publishes windSpeed_kph and
     rain in cm. Rather than let that show up as a silently blank gauge, say so
     once, and print the keys that ARE present so the fix is obvious. */
  let fieldsAudited = false;
  function auditFields(data) {
    if (fieldsAudited || !data || typeof data !== "object") return;
    const keys = Object.keys(data);
    if (keys.length < 3) return;              // not a real payload yet
    fieldsAudited = true;
    /* windGust legitimately falls back to windGust10, so its absence is not a
       fault — warning about it would be crying wolf on a working setup. */
    const satisfied = name =>
      name === "windGust" && data[FIELD.windGust10] !== undefined;
    const missing = Object.entries(FIELD)
      .filter(([name, key]) => data[key] === undefined && !satisfied(name))
      .map(([name, key]) => name + " -> " + key);
    if (!missing.length) return;
    console.warn(
      "Fenland: " + missing.length + " configured field(s) are absent from the feed:\n  " +
      missing.join("\n  ") +
      "\n\nThe payload actually contains:\n  " + keys.sort().join(", ") +
      "\n\nMap the right names with `fields` in config.js, and declare the units " +
      "with `stationUnits` if they are not metric. See config.example.js.");
  }



  /* "52.61° N · 0.39° E · 15M ASL — DAVIS VANTAGE · MQTT" assembled from config */
  function stationSubtitle() {
    const bits = [];
    if (CFG.lat != null && CFG.lon != null) {
      bits.push(Math.abs(CFG.lat).toFixed(2) + "° " + (CFG.lat >= 0 ? "N" : "S") + " · " +
                Math.abs(CFG.lon).toFixed(2) + "° " + (CFG.lon >= 0 ? "E" : "W"));
    }
    if (CFG.elevation != null) bits.push(CFG.elevation + "M ASL");
    const src = [CFG.hardware, WS_URL ? "MQTT" : (POLL_URL ? "JSON" : null)].filter(Boolean).join(" · ");
    return bits.join(" · ") + (src ? " — " + src : "");
  }
    const STATION_LAT = 52.606; 
    const STATION_LON = 0.385; 

    let pressureHistory = [];
    let data = {"dateTime": Date.now()/1000, "trendIcon": "0.0", "barometer_mbar": "1012.0", "outTemp_C": "--", "windSpeed_mph": "--", "windDir": "0.0", "dewpoint_C": "--", "outHumidity": "--", "UV": "0.0", "radiation_Wpm2": "0.0", "dayRain_mm": "0.0", "stormRain": "0.0"};
    let dayWindMax = 0; 
    let windGustDir10 = 0; 
    let liveTempMin = "--"; 
    let liveTempMax = "--";
    let liveAqi = null; 
    let liveAqiPm25 = null; 
    let liveLightningCount = null; 
    let liveLightningDistance = null; 
    let liveAqiTrend = null;
    /* Open-Meteo values, used only where the station has no sensor. */
    let modelAqi = null, modelPm25 = null;
    function refreshModelAir() {
      if (!window.__AIRQ__ || !window.__AIRQ__.enabled) return;
      if (TOPIC_AIRGRADIENT) return;              // a real sensor is configured
      window.__AIRQ__.current().then(v => {
        if (!v) return;
        modelAqi = v.aqi; modelPm25 = v.pm25;
      });
    }
    let currentCompassHeading = 0; 
    let currentCompassHeading_mob = 0;
    let currentGustHeading = 0; 
    let currentGustHeading_mob = 0;
    let mqttStatus = 'connecting'; 
    let lastMsgTime = null; 
    let weewxBaroTrendMb = null; 
    let weewxTempTrendC = null; 
    let weewxSummaryData = null; 

    // ── Sunrise / sunset ──
    function getSunTimes(date, lat, lon) {
      const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
      const toJulian = d => d.getTime() / dayMs - 0.5 + J1970;
      const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
      const toDays = d => toJulian(d) - J2000;
      const e = rad * 23.4397;
      const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
      const eclipticLongitude = M => {
        const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
        return M + C + rad * 102.9372 + Math.PI;
      };
      const declination = l => Math.asin(Math.sin(l) * Math.sin(e));
      const julianCycle = (d, lw) => Math.round(d - 0.0009 - lw / (2 * Math.PI));
      const approxTransit = (Ht, lw, n) => 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
      const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d))); 

      const lw = rad * -lon, phi = rad * lat, d = toDays(date);
      const n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
      const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
      const Jnoon = solarTransitJ(ds, M, L); 

      const w0 = hourAngle(-0.833 * rad, phi, dec);
      if (isNaN(w0)) return { sunrise: null, sunset: null }; 
      const Jset = solarTransitJ(approxTransit(w0, lw, n), M, L);
      const Jrise = Jnoon - (Jset - Jnoon);
      return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
    } 

    async function syncBarographHistory() {
      try {
        const res = await fetch(HISTORY_FILE_URL + "?cacheburst=" + Date.now());
        const rawLog = await res.json();
        const now = Math.floor(Date.now() / 1000);
        pressureHistory = rawLog.sort((a, b) => a.t - b.t).map(point => ({
          minsAgo: Math.max(0, Math.round((now - point.t) / 60)),
          mb: inPres2mb(parseFloat(point.mb))
        })).filter(point => point.minsAgo <= 720);
      } catch (e) {
        console.warn("History log file missing or unreadable — keeping last known data:", e);
      }
    } 

    async function syncWeewxSummary() {
      try {
        const res = await fetch(WEEWX_JSON_URL + "?cacheburst=" + Date.now());
        const j = await res.json();
        weewxSummaryData = j;
        /* Both are CHANGES over three hours, not readings. Pressure scales
           linearly so the ordinary converter is fine; temperature does not. */
        const baro = inPres2mb(parseFloat(j?.current?.["baro trend"]?.value));
        weewxBaroTrendMb = isNaN(baro) ? null : baro;
        const temp = inTempDiff2C(parseFloat(j?.current?.["temp trend"]?.value));
        weewxTempTrendC = isNaN(temp) ? null : temp;
      } catch (e) {
        console.warn("weewx.json missing or unreadable — falling back to local trend estimate:", e);
        weewxSummaryData = null;
        weewxBaroTrendMb = null;
        weewxTempTrendC = null;
      }
    } 

    const GRAPHS_JSON_BASE = STATION.jsonBase || "";
    const FORECAST_JSON_URL = STATION.aerisForecast || "";   // legacy Aeris feed, optional

    let highchartsLoadPromise = null;
    let highchartsThemed = false;
    let chartDataCache = {}; 
    let forecastDataCache = null; 
    let currentChartSpan = 'day'; 

    /* colours.js wraps Highcharts.chart() to colour series by value. Install
       that wrapper here, before anything draws — otherwise the first charts
       race its poll and render in the default palette. */
    function applyColourPatch() {
      const c = window.__WXCOLOURS__;
      if (c && typeof c.patch === 'function') c.patch();
    }

    function ensureHighcharts() {
      if (typeof Highcharts !== 'undefined') { applyColourPatch(); return Promise.resolve(); }
      if (highchartsLoadPromise) return highchartsLoadPromise;
      highchartsLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/highcharts@11/highcharts.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Highcharts failed to load'));
        document.head.appendChild(s);
      }).then(applyColourPatch);
      return highchartsLoadPromise;
    } 

    /* ── theme ──────────────────────────────────────────────────────────
       The palette lives entirely in CSS variables, so switching themes is
       just an attribute on <html>. The initial value is set by an inline
       script in the head — before first paint, so there is no white flash —
       and this keeps it in step afterwards: the OS setting can change while
       the page is open, and in "sun" mode the sun keeps moving.            */
    const THEME_MODE = String(CFG.theme || "auto").toLowerCase();
    const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    const THEME_KEY = "fenland-theme";
    const THEME_TOGGLE_ON = CFG.themeToggle !== false;

    /* null means "follow the site's configured behaviour" — which may itself
       be auto, sun, light or dark. Storing only an explicit light/dark keeps
       the visitor able to hand control back. */
    /* Private browsing throws on localStorage. Falling back to a variable
       keeps the button working for the session — without it the control
       looks broken rather than merely forgetful. */
    let themeMemory = null;
    function themeOverride() {
      try { const v = localStorage.getItem(THEME_KEY);
            if (v === "light" || v === "dark") return v;
            return themeMemory; }
      catch (e) { return themeMemory; }
    }
    function setThemeOverride(v) {
      themeMemory = v;
      try { v ? localStorage.setItem(THEME_KEY, v) : localStorage.removeItem(THEME_KEY); }
      catch (e) { /* choice holds for this session, just will not persist */ }
    }

    function wantsDark() {
      const o = themeOverride();
      if (o) return o === "dark";
      if (THEME_MODE === "dark") return true;
      if (THEME_MODE === "light") return false;
      if (THEME_MODE === "sun" && CFG.lat != null && CFG.lon != null) {
        const now = new Date();
        const t = getSunTimes(now, CFG.lat, CFG.lon);
        if (!t || !t.sunrise || !t.sunset) return false;
        return now < t.sunrise || now > t.sunset;
      }
      return !!(darkQuery && darkQuery.matches);
    }

    function applyTheme() {
      const dark = wantsDark();
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (dark === isDark) return;                       // nothing to do
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

      /* Highcharts caches the theme in setOptions, and existing charts keep
         the colours they were built with. Re-theme, then redraw whatever is
         on screen; the other panels rebuild when their tab is next opened. */
      highchartsThemed = false;
      if (typeof Highcharts !== "undefined") {
        themeHighcharts();
        if (document.getElementById("paneCharts")?.classList.contains("active")) {
          renderCharts(currentChartSpan);
        }
      }
      /* The barograph and dials are SVG drawn with var(--…) fills, so they
         reflow on the next render tick without being touched here. */
    }

    /* Three states rather than two: a plain toggle would strand anyone who
       tried it, with no way back to following their system. */
    function paintThemeToggle() {
      const o = themeOverride();
      const label = o === "light" ? "☀ LIGHT" : o === "dark" ? "☾ DARK" : "◐ AUTO";
      const hint = o ? "Theme: " + o + " (click to cycle)"
                     : "Theme: following " + (THEME_MODE === "sun" ? "sunset" : "your system")
                       + " (click to override)";
      ["themeToggle", "themeToggle_mob"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!THEME_TOGGLE_ON) { el.style.display = "none"; return; }
        el.textContent = label;
        el.title = hint;
      });
    }

    function cycleTheme() {
      const o = themeOverride();
      setThemeOverride(o === null ? "light" : o === "light" ? "dark" : null);
      applyTheme();
      paintThemeToggle();
    }

    function watchTheme() {
      if (THEME_MODE === "auto" && darkQuery) {
        const on = () => applyTheme();
        darkQuery.addEventListener ? darkQuery.addEventListener("change", on)
                                   : darkQuery.addListener(on);
      }
      /* "sun" has no event to listen for, so check occasionally. A theme that
         flips a few minutes late at dusk is not worth a tighter loop. */
      if (THEME_MODE === "sun") setInterval(applyTheme, 5 * 60 * 1000);
      applyTheme();
      paintThemeToggle();
    }

    function themeHighcharts() {
      if (highchartsThemed || typeof Highcharts === 'undefined') return;
      const css = getComputedStyle(document.documentElement);
      const v = name => css.getPropertyValue(name).trim();
      const ink = v('--ink'), slate = v('--slate'), faint = v('--faint'), paper = v('--paper'), accent = v('--accent'), highlight = v('--highlight'), maxMarker = v('--max-marker');
      Highcharts.setOptions({
        chart: { backgroundColor: paper, style: { fontFamily: "'IBM Plex Mono',ui-monospace,monospace" }, spacing: [10, 10, 4, 4] },
        title: { text: undefined }, credits: { enabled: false },
        colors: [ink, highlight, accent, maxMarker, slate],
        xAxis: { gridLineColor: faint, lineColor: ink, tickColor: ink, labels: { style: { color: slate, fontSize: '10px' } } },
        yAxis: { gridLineColor: faint, lineColor: ink, title: { style: { color: slate, fontSize: '11px' } }, labels: { style: { color: slate, fontSize: '10px' } } },
        legend: { itemStyle: { color: ink, fontFamily: "'IBM Plex Mono',monospace", fontSize: '11px' } },
        tooltip: { backgroundColor: paper, borderColor: ink, style: { color: ink, fontSize: '12px' } },
        plotOptions: { series: { marker: { enabled: false }, lineWidth: 2, animation: false } }
      });
      highchartsThemed = true;
    } 

    async function fetchChartData(span) {
      if (chartDataCache[span]) return chartDataCache[span];
      const res = await fetch(GRAPHS_JSON_BASE + span + '.json?cacheburst=' + Date.now());
      const j = await res.json();
      chartDataCache[span] = j;
      return j;
    } 

    async function fetchForecast() {
      if (forecastDataCache) return forecastDataCache;
      const res = await fetch(FORECAST_JSON_URL + '?cacheburst=' + Date.now());
      const j = await res.json();
      forecastDataCache = j;
      return j;
    } 

    /* Belchertown publishes these charts in whatever unit system weeWX is set
       to, which is not necessarily what this page displays. Normalise to metric
       using `stationUnits`, then out to the display unit — so the axis label,
       the plotted values and the colour bands in colours.js (which are computed
       in display units) all agree. Pass scale = null to leave a series alone:
       humidity, wind direction and AQI are not unit-bearing. */
    function toDisplay(scale, v) {
      if (v == null || typeof U === "undefined") return v;
      if (scale === "temp") return U.axisTemp(inTemp2C(v));
      if (scale === "rain") return U.axisRain(inRain2mm(v));
      if (scale === "baro") {
        const mb = inPres2mb(v);
        return U.presUnit === "inHg" ? U.conv.mb2inhg(mb) : mb;
      }
      if (scale === "wind") return inWind(v);   // already lands in the display unit
      return v;
    }

    /* Tipping-bucket gauges occasionally report an impossible instantaneous
       rate — two tips microseconds apart, or a counter rolling over. A single
       13,107 mm/hr spike (65535/5) drags the axis to 15k and flattens every
       real reading to a flat line, so one bad sample destroys a year of good
       ones. Points above the sanity limit are dropped, not clamped: inventing
       a plausible number would be worse than showing a gap. The world record
       is ~305 mm in an hour, so 500 leaves generous headroom.
       Set `maxRainRate: null` in config.js to plot everything regardless.    */
    const RAIN_RATE_LIMIT = CFG.maxRainRate === null ? Infinity : (CFG.maxRainRate || 500);
    let rainRateWarned = false;

    function seriesPoints(chartObj, key, scale) {
      const s = chartObj?.series?.[key];
      if (!s || !Array.isArray(s.data)) return [];
      let dropped = 0, worst = 0;
      const out = s.data
        .filter(p => {
          if (p[1] === null || p[1] === undefined) return false;
          if (key === "rainRate" && Math.abs(p[1]) > RAIN_RATE_LIMIT) {
            dropped++; worst = Math.max(worst, Math.abs(p[1])); return false;
          }
          return true;
        })
        .map(p => scale ? [p[0], toDisplay(scale, p[1])] : p);
      if (dropped && !rainRateWarned) {
        rainRateWarned = true;
        console.warn("Fenland: ignored " + dropped + " impossible rain-rate reading(s), "
          + "peaking at " + Math.round(worst) + " mm/hr — almost certainly a gauge "
          + "artefact rather than weather. Raise or disable with `maxRainRate` in config.js.");
      }
      return out;
    } 

    async function renderCharts(span) {
      currentChartSpan = span;
      const targets = ['chartTemp', 'chartWind', 'chartRain', 'chartBaro', 'chartAirQuality'];
      try {
        await ensureHighcharts();
        themeHighcharts();

        // 1. Fetch main weather chart data
        const j = await fetchChartData(span);
        const c1 = j.chart1, c2 = j.chart2, c3 = j.chart3, c4 = j.chart4; 

        Highcharts.chart('chartTemp', {
          chart: { type: 'line', height: 240 }, xAxis: { type: 'datetime' },
          yAxis: [{ title: { text: U.tempUnit } }, { title: { text: '%' }, opposite: true, min: 0, max: 100, gridLineWidth: 0 }],
          series: [{ name: 'Temperature', data: seriesPoints(c1, 'outTemp', 'temp'), yAxis: 0 }, { name: 'Wind Chill', data: seriesPoints(c1, 'windchill', 'temp'), yAxis: 0, dashStyle: 'ShortDot' }, { name: 'Humidity', data: seriesPoints(c1, 'outHumidity'), yAxis: 1, opacity: 0.55 }]
        }); 

        Highcharts.chart('chartWind', {
          chart: { type: 'line', height: 240 }, xAxis: { type: 'datetime' },
          yAxis: [{ title: { text: U.windUnit }, min: 0 }, { title: { text: '°' }, opposite: true, min: 0, max: 360, tickInterval: 90, gridLineWidth: 0 }],
          series: [{ name: 'Wind Speed', data: seriesPoints(c2, 'windSpeed', 'wind'), yAxis: 0 }, { name: 'Gust', data: seriesPoints(c2, 'windGust', 'wind'), yAxis: 0, dashStyle: 'ShortDot' }, { name: 'Direction', type: 'scatter', data: seriesPoints(c2, 'windDir'), yAxis: 1, marker: { enabled: true, radius: 2 } }]
        }); 

        Highcharts.chart('chartRain', {
          chart: { height: 240 }, xAxis: { type: 'datetime' },
          yAxis: [{ title: { text: U.rainUnit + '/hr' }, min: 0 }, { title: { text: U.rainUnit + ' total' }, opposite: true, min: 0, gridLineWidth: 0 }],
          series: [{ name: 'Rain Rate', type: 'column', data: seriesPoints(c3, 'rainRate', 'rain'), yAxis: 0 }, { name: 'Rain Total', type: 'line', data: seriesPoints(c3, 'rainTotal', 'rain'), yAxis: 1 }]
        }); 

        Highcharts.chart('chartBaro', {
          chart: { type: 'spline', height: 240 }, xAxis: { type: 'datetime' },
          yAxis: { title: { text: U.presUnit } },
          series: [{ name: 'Barometer', data: seriesPoints(c4, 'barometer', 'baro') }]
        });

        // 2. Fetch & Render Air Quality History JSON (day_aq.json, week_aq.json, etc.)
        try {
          const aqBase = STATION.airQualityBase || "";
          let aqData = null;
          let aqSource = "station";

          if (aqBase) {
            const aqRes = await fetch(`${aqBase}${span}_aq.json?cacheburst=` + Date.now());
            aqData = await aqRes.json();
          } else if (window.__AIRQ__ && window.__AIRQ__.enabled) {
            /* no sensor configured — model it from Open-Meteo instead of
               leaving an empty card */
            aqData = await window.__AIRQ__.history(span);
            aqSource = "openmeteo";
            if (!aqData) {
              throw new Error(window.__AIRQ__.spans.indexOf(span) === -1
                ? "Open-Meteo air quality does not go back a " + span
                : "Open-Meteo air quality unavailable");
            }
          } else {
            throw new Error("no air quality source configured");
          }

          Highcharts.chart('chartAirQuality', {
            chart: { type: 'line', height: 240 },
            title: { text: undefined },
            xAxis: { type: 'datetime' },
            yAxis: [
              { title: { text: 'µg/m³' }, min: 0 },
              { title: { text: 'AQI' }, opposite: true, min: 0, max: 300, gridLineWidth: 0 }
            ],
            series: [
              { name: 'PM2.5', data: aqData.pm2_5, yAxis: 0, color: '#38bdf8' },
              { name: 'AQI', data: aqData.aqi, yAxis: 1, dashStyle: 'ShortDot', color: '#d97706' }
            ]
          });
        } catch (aqErr) {
          console.warn("Air quality history unavailable:", aqErr.message);
          const aqEl = document.getElementById('chartAirQuality');
          if (aqEl) aqEl.innerHTML = '<div class="chart-loading">' + aqErr.message + '</div>';
        }

      } catch (e) {
        console.warn('Chart data unavailable:', e);
        targets.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = '<div class="chart-loading">Chart data unavailable — check GRAPHS_JSON_BASE path</div>';
        });
      }
    } 

    function switchChartSpan(span) {
      document.querySelectorAll('#chartSpanSwitch button').forEach(b => b.classList.toggle('active', b.dataset.span === span));
      renderCharts(span);
    } 

    function forecastGlyphSvg(desc, isDay) {
      const d = (desc || '').toLowerCase();
      let glyph = 'cloud';
      if (d.includes('rain') || d.includes('shower') || d.includes('drizzle') || d.includes('storm') || d.includes('snow')) glyph = 'rain';
      else if (d.includes('clear') || d.includes('sunny')) glyph = isDay ? 'sun' : 'moon';
      else if (d.includes('cloud') || d.includes('overcast')) glyph = 'cloud';
      else glyph = isDay ? 'sun' : 'moon';

      const G = {
        sun: `<svg width="100%" height="100%" viewBox="0 0 120 120"><g fill="none" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"><circle cx="60" cy="60" r="24"/>${Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return `<line x1="${60+Math.cos(a)*36}" y1="${60+Math.sin(a)*36}" x2="${60+Math.cos(a)*48}" y2="${60+Math.sin(a)*48}"/>`;}).join('')}</g></svg>`,
        cloud: `<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M34 80 a20 20 0 0 1 4-39 a26 26 0 0 1 49 6 a18 18 0 0 1 -3 33 z" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linejoin="round"/></svg>`,
        rain: `<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M34 64 a20 20 0 0 1 4-39 a26 26 0 0 1 49 6 a18 18 0 0 1 -3 33 z" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linejoin="round"/><g stroke="var(--highlight)" stroke-width="6" stroke-linecap="round"><line x1="44" y1="82" x2="40" y2="98"/><line x1="62" y1="82" x2="58" y2="98"/><line x1="80" y1="82" x2="76" y2="98"/></g></svg>`,
        moon: `<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M78 60 a28 28 0 1 1 -28 -28 a22 22 0 0 0 28 28 z" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linejoin="round"/></svg>`
      };
      return G[glyph];
    } 

    async function renderForecast() {
      const hourlyEl = document.getElementById('forecastHourly');
      const dailyEl = document.getElementById('forecastDaily');
      try {
        const j = await fetchForecast();
        const daily = j?.forecast_24hr?.[0]?.response?.[0]?.periods || [];
        const hourly = j?.forecast_1hr?.[0]?.response?.[0]?.periods || []; 

        if (hourlyEl) {
          hourlyEl.innerHTML = hourly.slice(0, 12).map(p => {
            const hr = new Date(p.timestamp * 1000).toLocaleTimeString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), hour: '2-digit', hour12: false });
            return `<div class="forecast-hour"><div class="fh-time">${hr}</div><div class="fh-glyph">${forecastGlyphSvg(p.weatherPrimary, p.isDay)}</div><div class="fh-temp">${Math.round(p.tempC)}°</div></div>`;
          }).join('');
        }
        if (dailyEl) {
          dailyEl.innerHTML = daily.map(p => {
            const dayName = new Date(p.timestamp * 1000).toLocaleDateString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), weekday: 'short' }).toUpperCase();
            return `<div class="forecast-day"><div class="fd-name">${dayName}</div><div class="fd-glyph">${forecastGlyphSvg(p.weatherPrimary, true)}</div><div class="fd-hi">${Math.round(p.maxTempC)}°</div><div class="fd-lo">${Math.round(p.minTempC)}°</div><div class="fd-pop">${Math.round(p.pop)}% rain</div></div>`;
          }).join('');
        }
      } catch (e) {
        console.warn('Forecast data unavailable:', e);
        if (hourlyEl) hourlyEl.innerHTML = '<div class="chart-loading">Forecast unavailable — check FORECAST_JSON_URL path</div>';
        if (dailyEl) dailyEl.innerHTML = '';
      }
    } 

    const STAT_ROWS = [
      { label: 'Temperature', maxKey: 'max temperature', minKey: 'min temperature' },
      { label: 'Dew Point', maxKey: 'max dewpoint', minKey: 'min dewpoint' },
      { label: 'Humidity', maxKey: 'max humidity', minKey: 'min humidity' },
      { label: 'Barometer', maxKey: 'max barometer', minKey: 'min barometer' },
      { label: 'Wind Speed', maxKey: 'max wind speed', minKey: null, isWind: true },
      { label: 'Wind Gust', maxKey: 'max wind gust', minKey: null, isWind: true },
      { label: 'Inside Temp', maxKey: 'max inside temperature', minKey: 'min inside temperature' },
      { label: 'Inside Humidity', maxKey: 'max inside humidity', minKey: 'min inside humidity' },
      { label: 'Rain', isRain: true, rateKey: 'max rain rate', totalKey: 'rain total' }
    ];
    const STAT_PERIODS = [['day','Day'], ['week','Week'], ['month','Month'], ['year','Year']];
    const KMH_TO_MPH = 0.621371;

    /* weewx.json states its own units per value, so rather than assume, read
       the label and convert into whatever the page is displaying. Without this
       the Stats tab silently ignores `units` in config.js and shows °C on a
       page set to Fahrenheit — correct, but inconsistent with every other tab. */
    function fmtStatVal(obj, isWind) {
      if (!obj || obj.value === null || obj.value === undefined) return null;
      let v = parseFloat(obj.value);
      if (isNaN(v)) return null;
      const raw = String(obj.units || '').trim();
      const u = raw.toLowerCase().replace(/[°\s]/g, '');

      if (u === 'c' || u === 'f') {
        const c = u === 'f' ? (v - 32) * 5 / 9 : v;
        return U.t(c, 1);
      }
      if (u === 'mm' || u === 'cm' || u === 'in' || u === 'inch') {
        const mm = u === 'in' || u === 'inch' ? v * 25.4 : u === 'cm' ? v * 10 : v;
        return U.r(mm);
      }
      if (u === 'mm/h' || u === 'mmperhour' || u === 'in/h' || u === 'inperhour') {
        const mm = u.startsWith('in') ? v * 25.4 : v;
        return U.r(mm) + '/h';
      }
      if (u === 'mbar' || u === 'mb' || u === 'hpa' || u === 'inhg') {
        const mb = u === 'inhg' ? v / 0.0295299830714 : v;
        return U.p(mb);
      }
      if (isWind || ['km/h','kmh','mph','m/s','ms','knots','kn'].includes(u)) {
        const toMph = { 'km/h': KMH_TO_MPH, kmh: KMH_TO_MPH, mph: 1,
                        'm/s': 2.23694, ms: 2.23694, knots: 1.15078, kn: 1.15078 }[u];
        if (!toMph) return `${v.toFixed(1)}${raw}`;
        /* U.w labels but does not convert — it expects a value already in the
           display unit — so go via mph and land in the right one. */
        const disp = String((CFG.units && CFG.units.wind) || 'mph').toLowerCase();
        return U.w(v * toMph * (MPH_TO_WIND[disp] || 1));
      }
      /* humidity, UV, anything unitless or unrecognised — pass through */
      return `${v.toFixed(1)}${raw}`;
    } 

    function statCell(periodData, row) {
      if (!periodData) return '—';
      if (row.isRain) {
        const totalStr = fmtStatVal(periodData[row.totalKey]);
        const rateObj = periodData[row.rateKey];
        const rateStr = fmtStatVal(rateObj);
        const parts = [];
        if (totalStr) parts.push(`<span class="stat-hi">${totalStr} total</span>`);
        if (rateStr) parts.push(`<span class="stat-at">Peak ${rateStr}${rateObj?.at ? ' @ ' + rateObj.at : ''}</span>`);
        return parts.length ? parts.join('<br>') : '—';
      }
      const maxObj = periodData[row.maxKey];
      const minObj = row.minKey ? periodData[row.minKey] : null;
      const hiStr = fmtStatVal(maxObj, row.isWind);
      const loStr = fmtStatVal(minObj, row.isWind);
      const parts = [];
      if (hiStr) parts.push(`<span class="stat-hi">${hiStr}</span><span class="stat-at">${maxObj?.at || ''}</span>`);
      if (loStr) parts.push(`<span class="stat-lo">${loStr}</span><span class="stat-at">${minObj?.at || ''}</span>`);
      return parts.length ? parts.join('<br>') : '—';
    } 

    async function renderStats() {
      const wrapEl = document.getElementById('statsTableWrap');
      const asOfEl = document.getElementById('statsAsOf');
      try {
        if (!weewxSummaryData) await syncWeewxSummary();
        if (!weewxSummaryData) throw new Error('weewx.json unavailable');
        if (asOfEl) asOfEl.textContent = `Records as of ${weewxSummaryData?.generation?.time || '—'}`;
        const header = `<tr><th>Variable</th>${STAT_PERIODS.map(([,label]) => `<th>${label}</th>`).join('')}</tr>`;
        const rows = STAT_ROWS.map(row => {
          const cells = STAT_PERIODS.map(([key]) => `<td>${statCell(weewxSummaryData[key], row)}</td>`).join('');
          return `<tr><td>${row.label}</td>${cells}</tr>`;
        }).join('');
        if (wrapEl) wrapEl.innerHTML = `<div class="stats-table-scroll"><table class="stats-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
      } catch (e) {
        console.warn('Stats data unavailable:', e);
        if (wrapEl) wrapEl.innerHTML = '<div class="chart-loading">Stats unavailable — check WEEWX_JSON_URL path</div>';
        if (asOfEl) asOfEl.textContent = '';
      }
    } 

    function openDetailOverlay() { document.getElementById('detailOverlay')?.classList.add('open'); switchDetailTab('charts'); }
    function closeDetailOverlay() { document.getElementById('detailOverlay')?.classList.remove('open'); }
    function switchDetailTab(tab) {
      document.getElementById('tabBtnCharts')?.classList.toggle('active', tab === 'charts');
      document.getElementById('tabBtnForecast')?.classList.toggle('active', tab === 'forecast');
      document.getElementById('tabBtnStats')?.classList.toggle('active', tab === 'stats');
      document.getElementById('tabBtnEnsemble')?.classList.toggle('active', tab === 'ensemble');
      document.getElementById('tabBtnClimate')?.classList.toggle('active', tab === 'climate');
      document.getElementById('tabBtnWindy')?.classList.toggle('active', tab === 'windy');
      document.getElementById('paneCharts')?.classList.toggle('active', tab === 'charts');
      document.getElementById('paneForecast')?.classList.toggle('active', tab === 'forecast');
      document.getElementById('paneStats')?.classList.toggle('active', tab === 'stats');
      document.getElementById('paneEnsemble')?.classList.toggle('active', tab === 'ensemble');
      document.getElementById('paneClimate')?.classList.toggle('active', tab === 'climate');
      document.getElementById('paneWindy')?.classList.toggle('active', tab === 'windy');
      if (tab === 'charts') renderCharts(currentChartSpan);
      else if (tab === 'forecast') { window.__FORECAST2__ ? window.__FORECAST2__.render() : renderForecast();
                                    window.__VERIFY__?.load(); }
      else if (tab === 'ensemble') window.__ENSEMBLE__?.open();
      else if (tab === 'climate') window.__CLIMATE__?.open();
      else if (tab === 'windy') window.__WINDY__?.open();
      else renderStats();
    } 

    function wireDetailOverlay() {
      const wireOnce = (id, handler) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', handler); }
      };
      wireOnce('themeToggle', cycleTheme);
      wireOnce('themeToggle_mob', cycleTheme);
      wireOnce('detailsTrigger', openDetailOverlay);
      wireOnce('detailsTrigger_mob', openDetailOverlay);
      wireOnce('detailCloseBtn', closeDetailOverlay);
      wireOnce('tabBtnCharts', () => switchDetailTab('charts'));
      wireOnce('tabBtnForecast', () => switchDetailTab('forecast'));
      wireOnce('tabBtnStats', () => switchDetailTab('stats'));
      wireOnce('tabBtnEnsemble', () => switchDetailTab('ensemble'));
      wireOnce('tabBtnClimate', () => switchDetailTab('climate'));
      wireOnce('tabBtnWindy', () => switchDetailTab('windy'));
      document.querySelectorAll('#chartSpanSwitch button').forEach(b => {
        if (!b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', () => switchChartSpan(b.dataset.span)); }
      });
    } 

    const NEEDLE_SHADOW_LAYERS = [{ off: 3.6, op: 0.08 }, { off: 2.6, op: 0.13 }, { off: 1.6, op: 0.20 }];
    const MARKER_SHADOW_LAYERS = [{ off: 4.2, op: 0.14 }, { off: 3.0, op: 0.20 }, { off: 1.8, op: 0.28 }];

    function needleShadowSVG() {
      return NEEDLE_SHADOW_LAYERS.map(({ off, op }) => `<g transform="translate(${off},0)"><polygon points="240,95 244,240 236,240" fill="rgba(15,15,20,${op})" /><line x1="240" y1="240" x2="240" y2="312" stroke="rgba(15,15,20,${op})" stroke-width="6" /><circle cx="240" cy="326" r="14" fill="none" stroke="rgba(15,15,20,${op})" stroke-width="6" /></g>`).join('');
    }
    function markerShadowSVG() {
      return MARKER_SHADOW_LAYERS.map(({ off, op }) => `<polygon points="240,20 235,32 245,32" fill="rgba(15,15,20,${op})" transform="translate(${off},0)"/>`).join('');
    } 

    // ── Shared Vector Generator Layout Function ──
    function buildDialVectors(isMobile) {
      const suffix = isMobile ? '_mob' : '';
      const c = 240;
      /* thresholds below are mph; convert them onto the dial's own scale */
      const mm_ = MPH_TO_WIND[DISP_WIND] || 1;
      const colorBands = [{ start: 0, end: 2, color: "#38bdf8" }, { start: 2, end: 5, color: "#22d3ee" }, { start: 4, end: 8, color: "#2dd4bf" }, { start: 8, end: 13, color: "#4ade80" }, { start: 13, end: 19, color: "#a3e635" }, { start: 19, end: 25, color: "#fde047" }, { start: 25, end: 32, color: "#fbbf24" }, { start: 32, end: 39, color: "#f59e0b" }, { start: 39, end: 47, color: "#ea580c" }, { start: 47, end: 60, color: "#ef4444" }]; 

      let s = '';
      colorBands.forEach(b => {
        const degStart = -135 + (b.start * mm_ / DIAL_MAX) * 270;
        const degEnd = -135 + (b.end * mm_ / DIAL_MAX) * 270;
        const a1 = (degStart - 90) * Math.PI / 180;
        const a2 = (degEnd - 90) * Math.PI / 180;
        const rOut = 208; const rIn = 172;
        s += `<path d="M ${c + Math.cos(a1)*rIn} ${c + Math.sin(a1)*rIn} L ${c + Math.cos(a1)*rOut} ${c + Math.sin(a1)*rOut} A ${rOut} ${rOut} 0 0 1 ${c + Math.cos(a2)*rOut} ${c + Math.sin(a2)*rOut} L ${c + Math.cos(a2)*rIn} ${c + Math.sin(a2)*rIn} A ${rIn} ${rIn} 0 0 0 ${c + Math.cos(a1)*rIn} ${c + Math.sin(a1)*rIn} Z" fill="${b.color}" opacity="0.9" />`;
      }); 

      s += `<circle cx="${c}" cy="${c}" r="235" fill="none" stroke="var(--ink)" stroke-width="2.5"/>`;
      s += `<circle cx="${c}" cy="${c}" r="208" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
      s += `<circle cx="${c}" cy="${c}" r="172" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
      const tickStep = DIAL_MAJ / 10;
      for (let speedVal = 0; speedVal <= DIAL_MAX + 1e-9; speedVal += tickStep) {
        const targetDeg = -135 + (speedVal / DIAL_MAX) * 270;
        const a = (targetDeg - 90) * Math.PI / 180;
        const isMaj = Math.abs(speedVal % DIAL_MAJ) < 1e-9;
        const rOut = 235; const rIn = isMaj ? 208 : 224;
        s += `<line x1="${c+Math.cos(a)*rIn}" y1="${c+Math.sin(a)*rIn}" x2="${c+Math.cos(a)*rOut}" y2="${c+Math.sin(a)*rOut}" stroke="var(--ink)" stroke-width="${isMaj?3:1.5}"/>`;
        if (isMaj) {
          s += `<text x="${c+Math.cos(a)*185}" y="${c+Math.sin(a)*185 + 6}" text-anchor="middle" font-family="var(--sans)" font-size="18" font-weight="bold" fill="var(--ink)">${Math.round(speedVal)}</text>`;
        }
      } 

      const beauMap = [{num: 0, start: 0}, {num: 1, start: 1}, {num: 2, start: 4}, {num: 3, start: 8}, {num: 4, start: 13}, {num: 5, start: 19}, {num: 6, start: 25}, {num: 7, start: 32}, {num: 8, start: 39}, {num: 9, start: 47}];
      beauMap.forEach((b) => {
        const deg = -135 + (b.start * mm_ / DIAL_MAX) * 270; const a = (deg - 90) * Math.PI / 180;
        s += `<line x1="${c+Math.cos(a)*160}" y1="${c+Math.sin(a)*160}" x2="${c+Math.cos(a)*172}" y2="${c+Math.sin(a)*172}" stroke="var(--ink)" stroke-width="2"/>`;
        s += `<text x="${c+Math.cos(a)*146}" y="${c+Math.sin(a)*146 + 5}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="700" fill="var(--ink)">B${b.num}</text>`;
      });
      s += `<text x="${c}" y="${c - 25}" text-anchor="middle" font-family="var(--sans)" font-size="24" font-weight="bold" fill="var(--ink)">WIND</text>`;
      s += `<text x="${c}" y="${c + 45}" text-anchor="middle" font-family="var(--sans)" font-size="24" font-weight="bold" fill="var(--ink)">SPEED ${(typeof U !== "undefined" ? U.windUnit : "mph").toUpperCase()}</text>`;
      s += `<g id="maxSpeedMarker${suffix}" class="dial-needle-pivot"><circle cx="240" cy="240" r="240" fill="none" />${markerShadowSVG()}<polygon points="240,16 234,32 246,32" fill="var(--max-marker)"/></g>`;
      s += `<g id="speedNeedle${suffix}" class="dial-needle-pivot"><circle cx="240" cy="240" r="240" fill="none" />${needleShadowSVG()}<polygon points="240,36 246,240 234,240" fill="var(--ink)" /><line x1="240" y1="240" x2="240" y2="312" stroke="var(--ink)" stroke-width="6" /><circle cx="240" cy="326" r="14" fill="none" stroke="var(--ink)" stroke-width="6" /></g><circle cx="240" cy="240" r="12" fill="var(--ink)" /><circle cx="240" cy="240" r="5" fill="var(--paper)" /><circle cx="240" cy="240" r="2" fill="var(--ink)" />`;

      let d = `<circle cx="${c}" cy="${c}" r="235" fill="none" stroke="var(--ink)" stroke-width="2.5"/>`;
      d += `<circle cx="${c}" cy="${c}" r="208" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
      for (let dVal = 0; dVal < 360; dVal += 5) {
        const a = (dVal - 90) * Math.PI / 180; const isMaj = dVal % 30 === 0;
        const rOut = 235; const rIn = isMaj ? 208 : 218;
        d += `<line x1="${c+Math.cos(a)*rIn}" y1="${c+Math.sin(a)*rIn}" x2="${c+Math.cos(a)*rOut}" y2="${c+Math.sin(a)*rOut}" stroke="var(--ink)" stroke-width="${isMaj?3:2}"/>`;
        if (isMaj) {
          let text = dVal === 0 ? "360" : dVal.toString().padStart(3, '0');
          d += `<text x="${c+Math.cos(a)*182}" y="${c+Math.sin(a)*182 + 6}" text-anchor="middle" font-family="var(--sans)" font-size="18" font-weight="bold" fill="var(--ink)">${text}</text>`;
        }
      }
      [['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315]].forEach(([L,degVal])=>{
        const a = (degVal - 90) * Math.PI / 180;
        d += `<text x="${c+Math.cos(a)*135}" y="${c+Math.sin(a)*135+8}" text-anchor="middle" font-family="var(--sans)" font-weight="bold" font-size="26" fill="var(--ink)">${L}</text>`;
      });
      d += `<text x="${c}" y="${c - 25}" text-anchor="middle" font-family="var(--sans)" font-size="24" font-weight="bold" fill="var(--ink)">WIND</text>`;
      d += `<text x="${c}" y="${c + 45}" text-anchor="middle" font-family="var(--sans)" font-size="24" font-weight="bold" fill="var(--ink)">DIRECTION</text>`;
      d += `<g id="avgDirMarker${suffix}" class="dial-needle-pivot"><circle cx="240" cy="240" r="240" fill="none" />${markerShadowSVG()}<polygon points="240,16 234,32 246,32" fill="var(--max-marker)"/></g>`;
      d += `<g id="compassNeedle${suffix}" class="dial-needle-pivot"><circle cx="240" cy="240" r="240" fill="none" />${needleShadowSVG()}<polygon points="240,36 246,240 234,240" fill="var(--ink)" /><line x1="240" y1="240" x2="240" y2="312" stroke="var(--ink)" stroke-width="6" /><circle cx="240" cy="326" r="14" fill="none" stroke="var(--ink)" stroke-width="6" /></g><circle cx="240" cy="240" r="12" fill="var(--ink)" /><circle cx="240" cy="240" r="5" fill="var(--paper)" /><circle cx="240" cy="240" r="2" fill="var(--ink)" />`;
      return { speedStr: s, compassStr: d };
    } 

    const BARO_BANDS = [
      { lo: -Infinity, hi: 980, label: 'STORMY', color: '#dc2626' },
      { lo: 980, hi: 1000, label: 'RAIN', color: '#f97316' },
      { lo: 1000, hi: 1016, label: 'CHANGE', color: '#eab308' },
      { lo: 1016, hi: 1032, label: 'FAIR', color: '#22c55e' },
      { lo: 1032, hi: Infinity, label: 'VERY DRY', color: '#0ea5e9' }
    ]; 

    function buildBarographPath(lo, hi, localHistory) {
      if (isNaN(lo) || isNaN(hi)) return '';
      const W=960, H=360, mL=66, mR=24, mT=22, mB=34;
      const xs=mL, xe=W-mR, yt=mT, yb=H-mB;
      const maxMins=720;
      const X=mins=>xe-(mins/maxMins)*(xe-xs);
      const Y=mb=>yb-((mb-lo)/(hi-lo))*(yb-yt); 

      let s='';
      BARO_BANDS.forEach(band=>{
        const bandLo=Math.max(band.lo, lo), bandHi=Math.min(band.hi, hi);
        if(bandHi<=bandLo) return; 
        const yTop=Y(bandHi), yBot=Y(bandLo);
        s+=`<rect x="${xs}" y="${yTop.toFixed(1)}" width="${xe-xs}" height="${(yBot-yTop).toFixed(1)}" fill="${band.color}" opacity="0.14"/>`;
        if((yBot-yTop)>20){
          s+=`<text x="${xe-8}" y="${(yTop+16).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="11" font-weight="700" letter-spacing=".08em" fill="${band.color}" opacity="0.9">${band.label}</text>`;
        }
      });
      for(let v=lo; v<=hi; v++){
        const y=Y(v);
        s+=`<line x1="${xs}" y1="${y}" x2="${xe}" y2="${y}" stroke="var(--faint)" stroke-width="1.2"/>`;
        s+=`<text x="${xs-12}" y="${y+5}" text-anchor="end" font-family="var(--mono)" font-size="14" fill="var(--slate)">${v}</text>`;
      }
      for(let h=12; h>=0; h-=2){
        const x=X(h*60);
        s+=`<line x1="${x}" y1="${yt}" x2="${x}" y2="${yb}" stroke="var(--faint)" stroke-width="1.2"/>`;
        s+=`<text x="${x}" y="${yb+22}" text-anchor="middle" font-family="var(--mono)" font-size="13" fill="var(--slate)">${h===0?'NOW':'-'+h+'h'}</text>`;
      }
      const pts=localHistory.map(p => `${X(p.minsAgo).toFixed(1)},${Y(p.mb).toFixed(1)}`);
      s+=`<polygon points="${X(maxMins).toFixed(1)},${yb} ${pts.join(' ')} ${xe.toFixed(1)},${yb}" fill="var(--wash)"/>`;
      s+=`<polyline points="${pts.join(' ')}" fill="none" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      const last=localHistory[localHistory.length-1];
      if(last) { s+=`<circle cx="${X(last.minsAgo)}" cy="${Y(last.mb)}" r="6.5" fill="var(--ink)"/>`; }
      s+=`<rect x="${xs}" y="${yt}" width="${xe-xs}" height="${yb-yt}" fill="none" stroke="var(--mist)" stroke-width="1.5"/>`;
      return s;
    } 

    const NEEDLE_STIFFNESS = 0.65; 
    const NEEDLE_DAMPING = 1.29; 
    const NEEDLE_REST_VEL = 0.04; 
    const needleAnim = {};  

    function safeRotate(elementId, targetAngle) {
      const el = document.getElementById(elementId);
      if (!el || isNaN(targetAngle)) return; 

      let st = needleAnim[elementId];

      /* The dial SVGs are rebuilt whenever the wind zoom overlay opens or the
         layout switches between desktop and mobile. That creates a NEW node
         with the same id, while the running animation still holds the old,
         now-detached one — it animates an orphan forever, st.raf never clears,
         and the guard below then returns early on every future call, leaving
         the visible needle frozen at its starting angle while the numbers
         beside it carry on updating. Detect the swap and start again on the
         node that is actually on screen. */
      if (st && st.el !== el) {
        if (st.raf) cancelAnimationFrame(st.raf);
        st = null;
      }

      if (!st) {
        st = needleAnim[elementId] = { el, angle: targetAngle, velocity: 0, target: targetAngle, raf: null };
        el.style.transform = `rotate(${targetAngle}deg)`;
        return;
      } 

      st.target = targetAngle;
      if (st.raf) return;  

      let lastT = null;
      const step = (now) => {
        if (lastT === null) lastT = now;
        const dt = Math.min((now - lastT) / 1000, 0.04); 
        lastT = now; 

        const disp = st.angle - st.target;
        const accel = -NEEDLE_STIFFNESS * disp - NEEDLE_DAMPING * st.velocity;
        st.velocity += accel * dt;
        st.angle += st.velocity * dt;
        if (!st.el.isConnected) { st.raf = null; return; }   // node was replaced
        st.el.style.transform = `rotate(${st.angle}deg)`; 

        if (Math.abs(disp) < 0.05 && Math.abs(st.velocity) < NEEDLE_REST_VEL) {
          st.angle = st.target;
          st.el.style.transform = `rotate(${st.angle}deg)`;
          st.raf = null;
        } else {
          st.raf = requestAnimationFrame(step);
        }
      };
      st.raf = requestAnimationFrame(step);
    } 

    let windZoomState = null;
    function openWindZoom(windEl) {
      if (windZoomState || !windEl) return;
      const overlay = document.createElement('div');
      overlay.className = 'wind-zoom-overlay';
      const hint = document.createElement('div');
      hint.className = 'wind-zoom-hint';
      hint.textContent = 'TAP TO CLOSE';
      overlay.addEventListener('click', closeWindZoom); 

      windZoomState = { windEl, originalParent: windEl.parentNode, originalNextSibling: windEl.nextSibling, overlay };
      overlay.appendChild(windEl);
      overlay.appendChild(hint);
      document.body.appendChild(overlay);
    } 

    function closeWindZoom() {
      if (!windZoomState) return;
      const { windEl, originalParent, originalNextSibling, overlay } = windZoomState;
      originalParent.insertBefore(windEl, originalNextSibling);
      overlay.remove();
      windZoomState = null;
    } 

    function wireWindZoom(windDialsEl) {
      if (windDialsEl && !windDialsEl.dataset.zoomWired) {
        windDialsEl.dataset.zoomWired = '1';
        windDialsEl.addEventListener('click', () => openWindZoom(windDialsEl.closest('.wind')));
      }
    } 

    function render(){
      const num = (k,d=0)=>{const v=parseFloat(data[k]); return isNaN(v)?d:v;};
      const r1 = v=>Math.round(v*10)/10;
      const nowObj = new Date();
      const timeStr = nowObj.toLocaleTimeString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), hour: '2-digit', minute: '2-digit', hour12: false });
      const dateStr = nowObj.toLocaleDateString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase(); 

      const sunTimes = getSunTimes(nowObj, STATION_LAT, STATION_LON);
      const fmtSun = t => t ? t.toLocaleTimeString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), hour: '2-digit', minute: '2-digit', hour12: false }) : '—:—';
      const sunText = `SUNRISE ${fmtSun(sunTimes.sunrise)} · SUNSET ${fmtSun(sunTimes.sunset)}`; 

      let statusText, statusColor;
      const secsAgo = lastMsgTime !== null ? Math.max(0, Math.round((Date.now() - lastMsgTime) / 1000)) : null;
      if (mqttStatus === 'connecting') { statusText = 'CONNECTING…'; statusColor = 'var(--slate)'; }
      else if (mqttStatus === 'reconnecting') { statusText = 'RECONNECTING…'; statusColor = 'var(--max-marker)'; }
      else if (mqttStatus === 'offline') {
        statusText = lastMsgTime ? `OFFLINE · LAST UPDATE ${new Date(lastMsgTime).toLocaleTimeString('en-GB', { timeZone: (CFG.timezone || 'Europe/London'), hour12: false })}` : 'OFFLINE';
        statusColor = 'var(--max-marker)';
      } else if (secsAgo !== null && secsAgo > 120) { statusText = `STALE · NO DATA ${Math.round(secsAgo / 60)}M`; statusColor = 'var(--max-marker)'; }
      else { statusText = 'LIVE'; statusColor = 'var(--accent)'; } 

      const tempVal = inTemp2C(num(FIELD.temp, null));
      /* Values arrive from the station in metric and are converted only
         here, for display. Everything computed below — trends, comfort
         thresholds, the barograph — stays in °C and mb. */
      const airTempText = tempVal !== null ? U.tv(tempVal) : "--";
      const feelsLikeText = tempVal !== null ? U.tv(inTemp2C(num(FIELD.appTemp))) : "--";
      const dewPointText = tempVal !== null ? U.tv(inTemp2C(num(FIELD.dewpoint))) : "--";
      const humidexText = tempVal !== null ? U.tv(inTemp2C(num(FIELD.humidex))) : "--"; 

      const rainRate=inRain2mm(num(FIELD.rainRate)), rad=num(FIELD.radiation);
      let cond = 'Clear night', glyph = 'moon';
      if (tempVal !== null) {
        if(rainRate>0){ cond = rainRate>2.5?'Rain':'Light rain'; glyph='rain'; }
        else if(rad/1>=400){ cond='Sunny · clear'; glyph='sun'; }
        else if(rad/1>=120){ cond='Bright · hazy sun'; glyph='sun'; }
        else if(rad>0){ cond='Overcast'; glyph='cloud'; }
        else { cond = num(FIELD.outHumidity)>92 ? 'Clear · risk of fog' : 'Clear night'; glyph='moon'; }
      }
      const conditionalStatus = tempVal !== null ? cond : "Connecting..."; 

      const G = {
        sun:`<svg width="100%" height="100%" viewBox="0 0 120 120"><g fill="none" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"><circle cx="60" cy="60" r="24"/>${Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return `<line x1="${60+Math.cos(a)*36}" y1="${60+Math.sin(a)*36}" x2="${60+Math.cos(a)*48}" y2="${60+Math.sin(a)*48}"/>`;}).join('')}</g></svg>`,
        cloud:`<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M34 80 a20 20 0 0 1 4-39 a26 26 0 0 1 49 6 a18 18 0 0 1 -3 33 z" fill="none" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/></svg>`,
        rain:`<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M34 64 a20 20 0 0 1 4-39 a26 26 0 0 1 49 6 a18 18 0 0 1 -3 33 z" fill="none" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/><g stroke="var(--highlight)" stroke-width="5" stroke-linecap="round"><line x1="44" y1="82" x2="40" y2="98"/><line x1="62" y1="82" x2="58" y2="98"/><line x1="80" y1="82" x2="76" y2="98"/></g></svg>`,
        moon:`<svg width="100%" height="100%" viewBox="0 0 120 120"><path d="M78 60 a28 28 0 1 1 -28 -28 a22 22 0 0 0 28 28 z" fill="none" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/></svg>`
      };
      const glyphSvgRaw = tempVal !== null ? (G[glyph] || '') : ''; 

      const nowMB = inPres2mb(num(FIELD.barometer));
      let trend3h;
      if (weewxBaroTrendMb !== null) {
        trend3h = r1(weewxBaroTrendMb);
      } else {
        let target3h = { mb: nowMB };
        if (pressureHistory.length > 0) {
          target3h = pressureHistory.reduce((prev, curr) => Math.abs(curr.minsAgo - 180) < Math.abs(prev.minsAgo - 180) ? curr : prev);
        }
        trend3h = r1(nowMB - target3h.mb);
      }
      let state = 'STEADY', arrow = '→';
      if(trend3h <= -1.5){state='FALLING FAST'; arrow='↓';}
      else if(trend3h <= -0.4){state='FALLING'; arrow='↘';}
      else if(trend3h < 0.4){state='STEADY'; arrow='→';}
      else if(trend3h < 1.5){state='RISING'; arrow='↗';}
      else {state='RISING FAST'; arrow='↑';}
      const trendRateText = (trend3h > 0 ? '+' : '') + U.dp(trend3h) + ' / 3h'; 

      let tempTrend3h = weewxTempTrendC !== null ? r1(weewxTempTrendC) : null;
      let tempState = 'STEADY', tempArrow = '→', tempTrendRateText = '—';
      if (tempTrend3h !== null) {
        if (tempTrend3h <= -3) { tempState = 'FALLING FAST'; tempArrow = '↓'; }
        else if (tempTrend3h <= -0.8) { tempState = 'FALLING'; tempArrow = '↘'; }
        else if (tempTrend3h < 0.8) { tempState = 'STEADY'; tempArrow = '→'; }
        else if (tempTrend3h < 3) { tempState = 'RISING'; tempArrow = '↗'; }
        else { tempState = 'RISING FAST'; tempArrow = '↑'; }
        tempTrendRateText = U.dtSigned(tempTrend3h) + ' / 3h';
      } 

      function nowcast(P, dP, windDeg){
        let base;
        if(P>=1024) base = dP<=-1 ? 'Settled, turning unsettled' : 'Settled and fine';
        else if(P>=1012){
          if(dP<=-1.5) base='Fine now, rain within hours';
          else if(dP<=-0.4) base='Fair, becoming unsettled';
          else if(dP>=0.8) base='Fair and improving';
          else base='Fair, little change';
        } else if(P>=1000){
          if(dP<=-0.4) base='Unsettled, rain likely';
          else if(dP>=0.8) base='Showery, slowly improving';
          else base='Changeable, showers around';
        } else { base = dP<0 ? 'Unsettled and windy, rain' : 'Stormy, then clearing'; }
        if(dP<-0.4 && inSector(windDeg, HUMID_SECTOR)) base += ' (humid)';
        return base;
      }
      const wDegRaw = parseFloat(data[FIELD.windDir]);
      const wDeg = isNaN(wDegRaw) ? null : wDegRaw;
      const nowcastOutput = nowcast(nowMB, trend3h, wDeg ?? 0); 

      const wSpd=inWind(num(FIELD.windSpeed));
      const wGust=data[FIELD.windGust]!=null?inWind(num(FIELD.windGust)):inWind(num(FIELD.windGust10));
      const compass16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      const dirName = wDeg !== null ? compass16[Math.round(wDeg/22.5)%16] : null;
      const beauNames=['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze','Strong breeze','Near gale','Gale','Strong gale','Storm','Violent storm','Hurricane'];
      const beau=Math.round(num(FIELD.beaufort)); 

      const windSpeedText = tempVal !== null ? Math.round(wSpd) : "--";
      const windGustText = tempVal !== null ? Math.round(wGust) : "--";
      /* One string, one size, as it always was. It stays on a single line via
         `nowrap` and the wider dir-cell rather than by shrinking the bearing. */
      const windDirText = tempVal === null ? "--" : (wDeg !== null ? `${dirName} ${Math.round(wDeg)}°` : null);
      const dayMaxText = dayExtreme(liveTempMax, tempVal, Math.max);
      const dayMinText = dayExtreme(liveTempMin, tempVal, Math.min);
      const beaufortText = tempVal !== null ? `Force ${beau} · ${beauNames[beau]||''}` : "—"; 

      const uv=Math.round(num(FIELD.uv)*10)/10;
      const uvBand = uv<3?'Low':uv<6?'Moderate':uv<8?'High':uv<11?'Very high':'Extreme';
      const uvPct = Math.min(uv,11)/11*100;
      const cloud = Math.round(num(FIELD.cloudbase));
      const activeRainToday = inRain2mm(parseFloat(data[FIELD.dayRain])) > 0;
      const activeStormRain = inRain2mm(parseFloat(data[FIELD.stormRain])) > 0; 

      /* A real sensor always wins; the model only fills the gap. */
      const aqiSrc = liveAqi !== null ? liveAqi : modelAqi;
      const pm25Src = liveAqiPm25 !== null ? liveAqiPm25 : modelPm25;
      const aqiVal = aqiSrc !== null && aqiSrc !== undefined ? Math.round(aqiSrc) : null;
      const aqiBand = aqiVal===null ? '—' : aqiVal<=50?'Good' : aqiVal<=100?'Moderate' : aqiVal<=150?'Unhealthy (Sensitive)' : aqiVal<=200?'Unhealthy' : aqiVal<=300?'Very Unhealthy' : 'Hazardous';
      const aqiPct = aqiVal===null ? 0 : Math.min(aqiVal,500)/500*100;
      const pm25Val = pm25Src !== null && pm25Src !== undefined ? r1(pm25Src) : null;
      const aqiTrendText = liveAqiTrend ? liveAqiTrend.charAt(0).toUpperCase() + liveAqiTrend.slice(1) : null;
      const aqiNote = aqiTrendText ? `${aqiBand} · ${aqiTrendText}` : aqiBand; 

      const tiles=[
        {lbl:'Relative humidity', val:Math.round(num(FIELD.outHumidity)), unit:'%', note:`Indoor ${r1(inTemp2C(num(FIELD.inTemp)))}°C · ${Math.round(num(FIELD.inHumidity))}%`},
        {lbl:'UV index', val:uv, unit:'', note:uvBand, uv:true},
        {lbl:'Solar radiation', val:Math.round(num(FIELD.radiation)), unit:'W/m²', note:'Shortwave'},
        {lbl:'Cloud base', val:cloud>=1000?(cloud/1000).toFixed(1):cloud, unit:cloud>=1000?'km':'m', note:'Est. LCL'},
        {lbl:'Rain today', val: U.rv(inRain2mm(num(FIELD.dayRain))), unit:U.rainUnit, note:`Rate ${r1(inRain2mm(num(FIELD.rainRate)))} mm/h`, isRain: activeRainToday},
        {lbl:'Storm rain', val:r1(inRain2mm(num(FIELD.stormRain))), unit:U.rainUnit, note:'Storm total', isRain: activeStormRain},
        {lbl:'PM2.5', val:pm25Val===null?'--':pm25Val, unit:'µg/m³', note:'AirGradient'},
        {lbl:'Air quality', val:aqiVal===null?'--':aqiVal, unit:'', note:aqiNote, aqi:true},
        {lbl:'Lightning', val:liveLightningCount===null?'--':Math.round(liveLightningCount), unit:'', note: liveLightningDistance===null ? 'Strikes detected · Blitzortung' : `Nearest ${r1(liveLightningDistance)} km away`}
      ]; 

      let localHistory = [...pressureHistory];
      localHistory = localHistory.filter(p => p.minsAgo > 0);
      if (!isNaN(inPres2mb(parseFloat(data[FIELD.barometer])))) { localHistory.push({ minsAgo: 0, mb: inPres2mb(parseFloat(data[FIELD.barometer])) }); }
      const mbs=localHistory.map(p=>p.mb);
      let lo = NaN, hi = NaN;
      if (localHistory.length > 0) {
        lo=Math.floor(Math.min(...mbs)-1); hi=Math.ceil(Math.max(...mbs)+1);
        if(hi-lo<6){ const m=(hi+lo)/2; lo=Math.round(m-3); hi=Math.round(m+3); }
      } 

      /* ── DESKTOP DOM UPDATE LOOP ── */
      if (window.innerWidth >= 1024) {
        document.getElementById('clockTime').textContent = timeStr;
        document.getElementById('clockDate').textContent = dateStr;
        document.getElementById('airTemp').textContent = airTempText;
        document.getElementById('feelsLike').textContent = feelsLikeText;
        document.getElementById('dewPoint').textContent = dewPointText;
        document.getElementById('humidex').textContent = humidexText;
        document.getElementById('tempMin').textContent = dayMinText;
        document.getElementById('tempMax').textContent = dayMaxText;
        document.getElementById('tempTrendArrow').textContent = tempArrow;
        document.getElementById('tempTrendState').textContent = tempState;
        document.getElementById('tempTrendRate').textContent = tempTrendRateText;
        document.getElementById('condition').textContent = conditionalStatus;
        document.getElementById('heroGlyph').innerHTML = glyphSvgRaw;
        document.getElementById('baroNow').textContent = U.p(nowMB).replace(' ' + U.presUnit, '');
        document.getElementById('tendArrow').textContent = arrow;
        document.getElementById('tendState').textContent = state;
        document.getElementById('tendRate').textContent = trendRateText;
        document.getElementById('nowcastText').textContent = nowcastOutput;
        document.getElementById('windSpeed').textContent = windSpeedText;
        document.getElementById('windGust').textContent = windGustText;
        if (windDirText !== null) document.getElementById('windDir_text').textContent = windDirText;
        document.getElementById('beaufort').textContent = beaufortText; 

        const desktopVectors = buildDialVectors(false);
        const speedSvg = document.getElementById('speedSvg');
        if(speedSvg && !document.getElementById('speedNeedle')) speedSvg.innerHTML = desktopVectors.speedStr; 

        const compassSvg = document.getElementById('compassSvg');
        if(compassSvg && !document.getElementById('compassNeedle')) compassSvg.innerHTML = desktopVectors.compassStr; 

        wireWindZoom(document.getElementById('windDials')); 

        if (wDeg !== null) {
          let diff = (wDeg - (currentCompassHeading % 360));
          if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
          currentCompassHeading += diff;
          safeRotate('compassNeedle', currentCompassHeading);
        }
        safeRotate('speedNeedle', -135 + (Math.min(Math.max(wSpd, 0), DIAL_MAX) / DIAL_MAX) * 270);
        safeRotate('maxSpeedMarker', -135 + (Math.min(Math.max(dayWindMax, 0), DIAL_MAX) / DIAL_MAX) * 270);
        if (!isNaN(windGustDir10)) {
          let gDiff = (windGustDir10 - (currentGustHeading % 360));
          if (gDiff > 180) gDiff -= 360; if (gDiff < -180) gDiff += 360;
          currentGustHeading += gDiff;
          safeRotate('avgDirMarker', currentGustHeading);
        } 

        const baroSvgEl = document.getElementById('baroSvg');
        if (baroSvgEl) {
          if (localHistory.length > 0) baroSvgEl.innerHTML = buildBarographPath(lo, hi, localHistory);
          else baroSvgEl.innerHTML = '';
        } 

        const tilesEl = document.getElementById('tiles');
        if (tilesEl) {
          tilesEl.innerHTML = tiles.map((t,i)=>`<div class="tile"><div class="t-lbl">${t.lbl}</div><div class="t-val" style="color: ${t.isRain ? 'var(--highlight)' : 'var(--ink)'}">${t.val}<span class="u">${t.unit}</span></div>${t.uv? `<div class="uvbar"><div class="seg" style="left:27%"></div><div class="seg" style="left:54%"></div><div class="seg" style="left:72%"></div><div class="mark" style="left:${uvPct}%"></div></div><div class="t-note" style="margin-top:8px">${t.note}</div>`: t.aqi? `<div class="aqibar"><div class="seg" style="left:10%"></div><div class="seg" style="left:20%"></div><div class="seg" style="left:30%"></div><div class="seg" style="left:40%"></div><div class="seg" style="left:60%"></div><div class="mark" style="left:${aqiPct}%"></div></div><div class="t-note" style="margin-top:8px">${t.note}</div>`: `<div class="t-note">${t.note}</div>`}</div>`).join('');
        }
        document.getElementById('footSun').textContent = sunText;
        const footRefreshEl = document.getElementById('footRefresh');
        if (footRefreshEl) { footRefreshEl.textContent = statusText; footRefreshEl.style.color = statusColor; }
      } 

      /* ── MOBILE DOM UPDATE REFLOW STACK ── */
      const mobileWrap = document.getElementById('mobileLayout');
      if (window.innerWidth < 1024 && mobileWrap) {
        if(!document.getElementById('speedSvg_mob')) {
          mobileWrap.innerHTML = `<header class="head"><div class="brand"><div class="name">${CFG.place || "Weather Station"}</div><div class="coords">${stationSubtitle()}</div></div><div class="clock"><div class="time" id="clockTime_mob">—:—</div><div class="dateline" id="clockDate_mob">——</div></div></header><section class="hero"><div class="hero-top"><div class="hero-glyph" id="heroGlyph_mob"></div><div class="hero-temp"><span id="airTemp_mob">--</span><span class="deg wx-unit-temp">°C</span></div></div><div class="hero-cond" id="condition_mob">Connecting...</div><div class="hero-extremes"><span class="hi-t">MAX <span id="tempMax_mob">--</span><span class="wx-unit-temp">°C</span></span><span class="lo-t">MIN <span id="tempMin_mob">--</span><span class="wx-unit-temp">°C</span></span><span class="trend-inline"><span id="tempTrendArrow_mob">→</span> <span id="tempTrendState_mob">STEADY</span> <span id="tempTrendRate_mob">—</span></span></div><div class="hero-sub"><div class="cell"><div class="lbl">Feels like</div><div class="val"><span id="feelsLike_mob">--</span><span class="u wx-unit-temp">°C</span></div></div><div class="cell"><div class="lbl">Dew point</div><div class="val"><span id="dewPoint_mob">--</span><span class="u wx-unit-temp">°C</span></div></div><div class="cell"><div class="lbl">Humidex</div><div class="val"><span id="humidex_mob">--</span><span class="u wx-unit-temp">°C</span></div></div></div></section><section class="baro"><div class="baro-head"><div class="eyebrow">Barometric pressure</div><div class="baro-read"><span id="baroNow_mob">----</span><span class="unit"><span class="wx-unit-pres">mb</span> · sea level</span><span class="trend-inline baro-trend-inline"><span id="tendArrow_mob">→</span> <span id="tendState_mob">STEADY</span> <span id="tendRate_mob">—</span></span></div></div><div class="baro-chart"><svg id="baroSvg_mob" viewBox="0 0 960 360" preserveAspectRatio="none"></svg></div><div class="nowcast"><div class="nc-lbl">Tendency forecast · next 6–12 h</div><div class="nc-txt" id="nowcastText_mob">—</div></div></section><section class="wind"><div class="wind-dials" id="windDials_mob"><div class="compass"><svg id="speedSvg_mob" viewBox="0 0 480 480"></svg></div><div class="compass"><svg id="compassSvg_mob" viewBox="0 0 480 480"></svg></div></div><div class="wind-readout-row"><div class="wind-data-cell"><div class="lbl">Wind speed</div><div class="val"><span id="windSpeed_mob">--</span><span class="u wx-unit-wind"> mph</span></div></div><div class="wind-data-cell dir-cell"><div class="lbl">Direction</div><div class="val"><span id="windDir_text_mob">--</span></div></div><div class="wind-data-cell"><div class="lbl">Gust profile</div><div class="val"><span id="windGust_mob">--</span><span class="u wx-unit-wind"> mph</span></div></div></div><div class="wind-beaufort" id="beaufort_mob">—</div></section><section class="tiles" id="tiles_mob"></section><footer class="foot"><span id="footSrc_mob">SOURCE — MQTT weather feed</span><span id="footSun_mob">SUNRISE —:— · SUNSET —:—</span><span id="footStatus_mob">CONNECTING…</span><span id="footRefresh_mob">—</span><span class="foot-action" id="themeToggle_mob" title="Theme">◐ AUTO</span><span class="foot-action" id="detailsTrigger_mob">HISTORY &amp; FORECAST ▸</span><span class="foot-credit" id="footCredit_mob"></span></footer>`; 

          const mobileVectors = buildDialVectors(true);
          const speedSvgMob = document.getElementById('speedSvg_mob');
          if (speedSvgMob && !document.getElementById('speedNeedle_mob')) speedSvgMob.innerHTML = mobileVectors.speedStr; 

          const compassSvgMob = document.getElementById('compassSvg_mob');
          if (compassSvgMob && !document.getElementById('compassNeedle_mob')) compassSvgMob.innerHTML = mobileVectors.compassStr; 

          wireWindZoom(document.getElementById('windDials_mob'));
          wireDetailOverlay();
        } 

        document.getElementById('clockTime_mob').textContent = timeStr;
        document.getElementById('clockDate_mob').textContent = dateStr;
        document.getElementById('airTemp_mob').textContent = airTempText;
        document.getElementById('feelsLike_mob').textContent = feelsLikeText;
        document.getElementById('dewPoint_mob').textContent = dewPointText;
        document.getElementById('humidex_mob').textContent = humidexText;
        document.getElementById('tempMin_mob').textContent = dayMinText;
        document.getElementById('tempMax_mob').textContent = dayMaxText;
        labelUnits();   // the mobile layout is rebuilt on resize
        labelWindScale();
        applyNowcastSetting();
        paintThemeToggle();
        renderCredit();
        document.getElementById('tempTrendArrow_mob').textContent = tempArrow;
        document.getElementById('tempTrendState_mob').textContent = tempState;
        document.getElementById('tempTrendRate_mob').textContent = tempTrendRateText;
        document.getElementById('condition_mob').textContent = conditionalStatus;
        document.getElementById('heroGlyph_mob').innerHTML = glyphSvgRaw;
        document.getElementById('baroNow_mob').textContent = U.p(nowMB).replace(' ' + U.presUnit, '');
        document.getElementById('tendArrow_mob').textContent = arrow;
        document.getElementById('tendState_mob').textContent = state;
        document.getElementById('tendRate_mob').textContent = trendRateText;
        document.getElementById('nowcastText_mob').textContent = nowcastOutput;
        document.getElementById('windSpeed_mob').textContent = windSpeedText;
        document.getElementById('windGust_mob').textContent = windGustText;
        if (windDirText !== null) document.getElementById('windDir_text_mob').textContent = windDirText;
        document.getElementById('beaufort_mob').textContent = beaufortText; 

        if (wDeg !== null) {
          let diffMob = (wDeg - (currentCompassHeading_mob % 360));
          if (diffMob > 180) diffMob -= 360; if (diffMob < -180) diffMob += 360;
          currentCompassHeading_mob += diffMob;
          safeRotate('compassNeedle_mob', currentCompassHeading_mob);
        }
        safeRotate('speedNeedle_mob', -135 + (Math.min(Math.max(wSpd, 0), DIAL_MAX) / DIAL_MAX) * 270);
        safeRotate('maxSpeedMarker_mob', -135 + (Math.min(Math.max(dayWindMax, 0), DIAL_MAX) / DIAL_MAX) * 270);
        if (!isNaN(windGustDir10)) {
          let gDiffMob = (windGustDir10 - (currentGustHeading_mob % 360));
          if (gDiffMob > 180) gDiffMob -= 360; if (gDiffMob < -180) gDiffMob += 360;
          currentGustHeading_mob += gDiffMob;
          safeRotate('avgDirMarker_mob', currentGustHeading_mob);
        } 

        const baroMobEl = document.getElementById('baroSvg_mob');
        if (baroMobEl) {
          if (localHistory.length > 0) baroMobEl.innerHTML = buildBarographPath(lo, hi, localHistory);
          else baroMobEl.innerHTML = '';
        } 

        const tilesMobEl = document.getElementById('tiles_mob');
        if (tilesMobEl) {
          tilesMobEl.innerHTML = tiles.map((t,i)=>`<div class="tile"><div class="t-lbl">${t.lbl}</div><div class="t-val" style="color: ${t.isRain ? 'var(--highlight)' : 'var(--ink)'}">${t.val}<span class="u">${t.unit}</span></div>${t.uv? `<div class="uvbar"><div class="seg" style="left:27%"></div><div class="seg" style="left:54%"></div><div class="seg" style="left:72%"></div><div class="mark" style="left:${uvPct}%"></div></div><div class="t-note" style="margin-top:8px">${t.note}</div>`: t.aqi? `<div class="aqibar"><div class="seg" style="left:10%"></div><div class="seg" style="left:20%"></div><div class="seg" style="left:30%"></div><div class="seg" style="left:40%"></div><div class="seg" style="left:60%"></div><div class="mark" style="left:${aqiPct}%"></div></div><div class="t-note" style="margin-top:8px">${t.note}</div>`: `<div class="t-note">${t.note}</div>`}</div>`).join('');
        }
        document.getElementById('footSun_mob').textContent = sunText;
        const footStatusMobEl = document.getElementById('footStatus_mob');
        if (footStatusMobEl) { footStatusMobEl.textContent = statusText; footStatusMobEl.style.color = statusColor; }
        document.getElementById('footRefresh_mob').textContent = `OBS ${timeStr} · BEAUFORT ${beau} · ${cond.toUpperCase()}`;
      }
    } 

    const MQTT_STALL_THRESHOLD_MS = 90 * 1000; 
    let mqttClient = null; 

    function connectMqtt() {
      if (!WS_URL || LIVE || typeof mqtt === 'undefined') return;
      if (mqttClient) {
        try { mqttClient.end(true); } catch (e) { }
        mqttClient = null;
      }
      const c = mqtt.connect(WS_URL, { reconnectPeriod: 5000, connectTimeout: 15000, clean: true });
      mqttClient = c;
      c.on('connect', () => {
        mqttStatus = (lastMsgTime === null) ? 'connecting' : 'live';
        c.subscribe(WS_TOPIC); 
        c.subscribe(TOPIC_WIND_MAX); 
        c.subscribe(TOPIC_WIND_DIR10); 
        c.subscribe(TOPIC_TEMP_MIN); 
        c.subscribe(TOPIC_TEMP_MAX);
        c.subscribe(TOPIC_AIRGRADIENT, { qos: 1 }); 
        c.subscribe(TOPIC_LIGHTNING); 
        c.subscribe(TOPIC_AQI_TREND); 
        c.subscribe(TOPIC_LIGHTNING_DISTANCE);
      });
      c.on('reconnect', () => { mqttStatus = 'reconnecting'; });
      c.on('close', () => { mqttStatus = 'offline'; });
      c.on('offline', () => { mqttStatus = 'offline'; });
      c.on('error', () => { mqttStatus = 'offline'; });
      c.on('message', (t, buf) => {
        const valStr = buf.toString().trim();
        /* These arrive on their own topics rather than in the loop packet, so
           they have to be put through the same conversions by hand. Missing
           that left the day-max marker in raw station units while the needle
           beside it was converted and scaled — so the needle could sail past
           its own maximum. The temperature pair had the same gap: harmless on
           a metric station, wrong on one publishing °F. */
        if(t === TOPIC_WIND_MAX) { dayWindMax = inWind(parseFloat(valStr)) || 0; }
        else if(t === TOPIC_WIND_DIR10) { const v = parseFloat(valStr); if (!isNaN(v)) windGustDir10 = v; }
        else if(t === TOPIC_TEMP_MIN) { const v = parseFloat(valStr); liveTempMin = !isNaN(v) ? Math.round(inTemp2C(v) * 10) / 10 : valStr; }
        else if(t === TOPIC_TEMP_MAX) { const v = parseFloat(valStr); liveTempMax = !isNaN(v) ? Math.round(inTemp2C(v) * 10) / 10 : valStr; }
        else if(t === TOPIC_AIRGRADIENT) { 
          try { 
            const agData = JSON.parse(valStr); 
            const pm25 = parseFloat(agData.pm02_corrected ?? agData.pm02); 
            liveAqiPm25 = isNaN(pm25) ? null : pm25; 
            if (liveAqiPm25 !== null) { 
              const pm = liveAqiPm25; 
              if (pm <= 9.0) liveAqi = Math.round(((50 - 0) / (9.0 - 0.0)) * (pm - 0.0) + 0); 
              else if (pm <= 35.4) liveAqi = Math.round(((100 - 51) / (35.4 - 9.1)) * (pm - 9.1) + 51); 
              else if (pm <= 55.4) liveAqi = Math.round(((150 - 101) / (55.4 - 35.5)) * (pm - 35.5) + 101); 
              else if (pm <= 125.4) liveAqi = Math.round(((200 - 151) / (125.4 - 55.5)) * (pm - 55.5) + 151); 
              else if (pm <= 225.4) liveAqi = Math.round(((300 - 201) / (225.4 - 125.5)) * (pm - 125.5) + 201); 
              else if (pm <= 325.4) liveAqi = Math.round(((500 - 301) / (325.4 - 225.5)) * (pm - 225.5) + 301); 
              else liveAqi = 500; 
            } 

            // Trigger immediate re-render when new AirGradient payload arrives
            lastMsgTime = Date.now();
            mqttStatus = 'live';
            render();

          } catch (e) { 
            console.warn("Failed to parse AirGradient MQTT payload", e); 
          } 
        }
        else if(t === TOPIC_LIGHTNING) { const v = parseFloat(valStr); liveLightningCount = isNaN(v) ? null : v; }
        else if(t === TOPIC_LIGHTNING_DISTANCE) { const v = parseFloat(valStr); liveLightningDistance = isNaN(v) ? null : v; }
        else if(t === TOPIC_AQI_TREND) { liveAqiTrend = valStr || null; }
        else if(t === WS_TOPIC) { let m; try { m = JSON.parse(valStr); } catch { return; } data = m; auditFields(data); }
        lastMsgTime = Date.now();
        mqttStatus = 'live';
        render();
      });
    } 

    /* ── polling fallback ──────────────────────────────────────────────
       For anyone without an MQTT broker. weeWX can write the loop packet to
       a JSON file every archive interval; we fetch it on a timer and feed it
       through exactly the same path an MQTT message would take. Slower, but
       it needs no broker at all.                                            */
    let pollTimer = null;

    async function pollOnce() {
      if (!POLL_URL) return false;
      try {
        const res = await fetch(POLL_URL + "?cacheburst=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const m = await res.json();
        if (m && typeof m === "object") {
          data = m;
          auditFields(data);
          lastMsgTime = Date.now();
          mqttStatus = 'live';
          render();
          return true;
        }
      } catch (e) {
        console.warn("poll failed:", e.message);
        mqttStatus = 'offline';
      }
      return false;
    }

    function startPolling() {
      if (pollTimer || !POLL_URL) return;
      console.info("Fenland: polling " + POLL_URL + " every " + (POLL_MS/1000) + "s");
      pollOnce();
      pollTimer = setInterval(pollOnce, POLL_MS);
    }

    /* Unit labels in the markup are placeholders; config decides what they
       actually say. Called after any layout rebuild. */
    /* A small credit in the footer, like Belchertown's. It is how anyone
       looking at your site finds the skin. Set `credit: false` in config.js
       to remove it — no hard feelings. */
    function renderCredit() {
      if (CFG.credit === false) return;
      const html = '<a href="' + FENLAND.url + '" target="_blank" rel="noopener">FENLAND</a> v' + FENLAND.version;
      ["footCredit", "footCredit_mob"].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.innerHTML) el.innerHTML = html;
      });
    }

    /* Hidden entirely when switched off; otherwise carries its own
       explanation on hover / long-press rather than spending a row of the
       layout on a caption. */
    function applyNowcastSetting() {
      const note = "Traditional barometer forecast: pressure, its 3-hour trend "
        + "and wind direction. Calibrated for temperate maritime climates — "
        + "less meaningful in continental interiors and unreliable in the tropics"
        + ((CFG.lat != null && CFG.lat < 0) ? ". Wind sector mirrored for the Southern Hemisphere." : ".");
      document.querySelectorAll(".nowcast").forEach(el => {
        if (!NOWCAST_ON) { el.style.display = "none"; return; }
        el.setAttribute("title", note);
      });
    }

    /* Day max and min arrive on their own MQTT topics, published on a slower
       cadence than the loop packet. On a fast-rising morning the live reading
       overtakes the stored maximum, and the header reads "25.1 now, MAX 24.7"
       — not wrong so much as not yet true. A day's maximum cannot be below the
       current temperature, nor its minimum above it, so reconcile the two.
       Takes the current value as an argument rather than reaching for a global:
       the only reading that matters is the one this render pass is showing. */
    function dayExtreme(stored, current, pick) {
      const s = parseFloat(stored);
      const c = (current == null || isNaN(current)) ? null : current;
      if (isNaN(s)) return c == null ? "--" : U.tv(c);
      return U.tv(c == null ? s : pick(s, c));
    }

    /* Say so where it can be seen, not only in the config file. */
    function labelWindScale() {
      if (WIND_SCALE === 1) return;
      const txt = " · WIND \u00D7" + WIND_SCALE.toFixed(2) + " TO 10 M";
      ["footSrc", "footSrc_mob"].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.textContent.indexOf("WIND \u00D7") === -1) el.textContent += txt;
      });
    }

    function labelUnits() {
      if (typeof U === "undefined") return;
      document.querySelectorAll(".wx-unit-temp").forEach(e => e.textContent = U.tempUnit);
      document.querySelectorAll(".wx-unit-wind").forEach(e => e.textContent = " " + U.windUnit);
      document.querySelectorAll(".wx-unit-pres").forEach(e => e.textContent = U.presUnit);
    }

    function bootloader() {
      /* label the desktop header from config */
      const nameEl = document.getElementById('stationName');
      const coordEl = document.getElementById('stationCoords');
      if (nameEl) nameEl.textContent = CFG.place || 'Weather Station';
      if (coordEl) coordEl.textContent = stationSubtitle();

      render();
      labelUnits();
      labelWindScale();
      applyNowcastSetting();
      watchTheme();
      refreshModelAir();
      setInterval(refreshModelAir, 30 * 60 * 1000);
      renderCredit();
      wireDetailOverlay();
      window.addEventListener('resize', render);
      setInterval(render, 1000); 

      if (LIVE) {
        mqttStatus = 'live';
        lastMsgTime = Date.now();
      } else if (!WS_URL && POLL_URL) {
        startPolling();                       // no broker configured at all
      } else if (WS_URL) {
        connectMqtt();
        setInterval(() => {
          const staleForTooLong = lastMsgTime !== null && (Date.now() - lastMsgTime) > MQTT_STALL_THRESHOLD_MS;
          if (staleForTooLong || mqttStatus === 'offline') {
            console.warn('MQTT looks stuck — forcing a fresh reconnect');
            connectMqtt();
          }
          /* if the broker stays unreachable and a JSON file is configured,
             fall back to it rather than showing a dead dashboard */
          if (POLL_URL && !pollTimer && mqttStatus === 'offline' &&
              (lastMsgTime === null || Date.now() - lastMsgTime > 90000)) {
            console.warn('MQTT unavailable — falling back to JSON polling');
            startPolling();
          }
        }, 20000); 

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') connectMqtt();
        });
      } 

      syncBarographHistory().then(render);
      syncWeewxSummary().then(render);
      setInterval(() => { syncWeewxSummary().then(render); }, WEEWX_JSON_REFRESH_MS);
      setInterval(() => { syncBarographHistory().then(render); }, HISTORY_REFRESH_MS);
    }
    bootloader();
