/* ═══════════════════════════════════════════════════════════════════════
   Fenland configuration — Downham Market

   Nothing here is secret. Every value is either public information or a URL
   already visible in the page source, which is why this file is committed
   rather than gitignored: the GitHub Pages demo needs it to configure
   itself. Credentials for the optional upload script live in
   scripts/config.py, which IS gitignored.
   ═══════════════════════════════════════════════════════════════════════ */

window.WXCONFIG = {

  place: "Downham Market",
  lat: 52.6033,
  lon: 0.3822,
  timezone: "Europe/London",
  elevation: 15,
  windy: {
    zoom: 8,
    overlay: "radar",
    level: "surface"
  },

  hardware: "DAVIS VANTAGE",

  units: { wind: "mph" },

  /* Anemometer is on a 6 m mast, so it reads about 68% of the 10 m
     reference. Of that shortfall, 1.21 is height and 1.21 is shelter from
     the surrounding trees. Correcting the height only — the shelter is real
     wind at this site, and scaling it away would make the numbers agree with
     a model rather than with reality. Display only; the weeWX archive still
     holds what the instrument actually measured. */
  windScale: 1.21,

  /* ── live data over MQTT ────────────────────────────────────────────
     Anonymous read over websockets — no credentials used or wanted.     */
  mqtt: {
    url:       "wss://mqtt.cetools.org:8081/mqtt",
    loopTopic: "personal/ucfnaps/downhamweather/loop",

    tempMaxTopic: "personal/ucfnaps/downhamweather/tempmax",
    tempMinTopic: "personal/ucfnaps/downhamweather/tempmin",
    windMaxTopic: "personal/ucfnaps/downhamweather/windmax",
    windDirTopic: "personal/ucfnaps/downhamweather/windGustDir10",

    airGradientTopic:       "personal/ucfnaps/airgradient",
    aqiTrendTopic:          "personal/ucfnaps/airquality/davistrend",
    lightningTopic:         "personal/ucfnaps/homeassistant/sensor/blitzortung_lightning_counter/state",
    lightningDistanceTopic: "personal/ucfnaps/homeassistant/sensor/blitzortung_lightning_distance/state"
  },

  pollSeconds: 20,

  /* ── station data files ─────────────────────────────────────────────
     These stay on the existing host rather than moving to Pages, because
     they change every few minutes and Pages throttles frequent rebuilds.
     That host must send Access-Control-Allow-Origin for a github.io page
     to read them — see the README.                                      */
  station: {
    weewxJson:       "https://finchamweather.co.uk/weewx.json",
    jsonBase:        "https://finchamweather.co.uk/json/",
    pressureHistory: "https://finchamweather.co.uk/pressure_history.json",
    airQualityBase:  "https://finchamweather.co.uk/weewx/json/",
    verification:    "https://finchamweather.co.uk/weewx/json/verification.json"
  },

  ensembleModels: ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"],

  climate: { baselineFrom: 1991, baselineTo: 2020, firstYear: 1940 }
};
