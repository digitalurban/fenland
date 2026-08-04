/* ═══════════════════════════════════════════════════════════════════════
   fenland configuration

   Copy this file to  config.js  and edit it. That is the only file you need
   to change to run the panels for your own location.

   Nothing here is secret — it is served to the browser. Credentials for the
   optional upload script live in scripts/config.py instead, which is
   gitignored.
   ═══════════════════════════════════════════════════════════════════════ */

window.WXCONFIG = {

  /* ── required ───────────────────────────────────────────────────────
     Your location. Everything else has a sensible default.              */
  place: "Downham Market",
  lat: 52.6033,
  lon: 0.3822,

  /* IANA timezone name. Times, day boundaries and "today" all follow this. */
  timezone: "Europe/London",

  /* Shown under the title. Optional, cosmetic. */
  elevation: 15,

  /* ── units ──────────────────────────────────────────────────────────
     Everything is computed internally in metric and converted only for
     display, so thresholds and rankings stay consistent whatever you pick.

       temp:     "c" | "f"
       rain:     "mm" | "in"
       pressure: "mb" | "inhg"
       wind:     "mph" | "kmh" | "ms" | "kn"

     Omit any of them for metric.                                        */
  units: {
    temp: "c",
    rain: "mm",
    pressure: "mb",
    wind: "mph"
  },

  /* Small "FENLAND v1.1.0" credit in the page footer, linking to the
     project. It is how people find the skin — but set false to remove it. */
  credit: true,

  /* ── barometric tendency forecast ───────────────────────────────────
     The short "next 6-12 h" line under the barograph, worked out from the
     pressure reading, its 3-hour trend and the wind direction — the same
     family as the Negretti & Zambra barometer tables of the 1850s.

     It is regional. The pressure bands are temperate-maritime values: too
     narrow for a continental interior, and near-useless in the tropics,
     where sea-level pressure barely moves. The wind rule is Northern
     Hemisphere by default and mirrors automatically when `lat` is negative,
     because circulation around a low reverses south of the equator.

     If your climate is not temperate maritime, consider turning it off
     rather than trusting it.                                              */
  // nowcast: true,

  /* ── hardware label ─────────────────────────────────────────────────
     Shown in the header after the coordinates, e.g. "DAVIS VANTAGE".     */
  hardware: "DAVIS VANTAGE",

  /* ── live data: MQTT ────────────────────────────────────────────────
     The dashboard reads your station live over websockets. The broker
     must allow anonymous subscribe over wss:// — no credentials are used
     or wanted here, since anything in this file is public.

     Leave `mqtt` out entirely to use JSON polling instead (below).       */
  // mqtt: {
  //   url:        "wss://broker.example.com:8081/mqtt",
  //   loopTopic:  "weather/loop",          // the full loop packet as JSON
  //   // all optional — omit any you don't publish:
  //   tempMaxTopic: "weather/tempmax",
  //   tempMinTopic: "weather/tempmin",
  //   windMaxTopic: "weather/windmax",
  //   windDirTopic: "weather/windGustDir10",
  //   airGradientTopic: "airgradient",
  //   lightningTopic: "lightning/count",
  //   lightningDistanceTopic: "lightning/distance",
  //   aqiTrendTopic: "airquality/trend"
  // },

  /* How often to poll, in seconds, when using the JSON fallback.         */
  pollSeconds: 20,

  /* ── what YOUR STATION publishes ────────────────────────────────────
     Independent of `units` above, which is what the page DISPLAYS.

     `units`        = what you want to read
     `stationUnits` = what arrives in the MQTT or JSON feed

     They do not have to match. A US station publishing °F can be shown in
     Celsius, and a METRICWX station can be shown in Fahrenheit — Fenland
     converts on the way in, and again on the way out.

       temp:     "c" | "f"
       rain:     "mm" | "in" | "cm"
       pressure: "mb" | "inhg" | "kpa"
       wind:     "mph" | "kmh" | "ms" | "kn"

     Defaults are metric (mph for wind), matching weewx-mqtt publishing
     METRICWX with `append_units_label = True`. A typical US setup:

         stationUnits: { temp: "f", rain: "in", pressure: "inhg", wind: "mph" }

     Getting this wrong is silent, not noisy — 21°C labelled 21°F looks
     plausible. If your readings are consistently off, check here first.  */
  // stationUnits: { temp: "c", rain: "mm", pressure: "mb", wind: "mph" },

  /* ── loop packet field names ────────────────────────────────────────
     Only needed if your MQTT payload uses different keys. Defaults match
     weewx-mqtt with `append_units_label = True` publishing METRICWX.

     This maps NAMES only. If your station publishes in US units, say so in
     `stationUnits` below — you do not have to reconfigure weeWX.

     The defaults below assume METRICWX with wind overridden to mph. Stock
     METRICWX sends wind in m/s; METRIC sends windSpeed_kph and rain in cm;
     US sends _F and inches. If a name is wrong, Fenland logs the mismatch
     to the browser console with the payload's real keys — check there first.

     Override only the names that differ:                                */
  // fields: {
  //   temp: "outTemp_C",   appTemp: "appTemp_C",  dewpoint: "dewpoint_C",
  //   humidex: "humidex_C", inTemp: "inTemp_C",   inHumidity: "inHumidity",
  //   outHumidity: "outHumidity", barometer: "barometer_mbar",
  //   windSpeed: "windSpeed_mph", windGust: "windGust_mph",
  //   windGust10: "windGust10",   windDir: "windDir",
  //   dayRain: "dayRain_mm",      stormRain: "stormRain",
  //   rainRate: "rainRate_mm_per_hour", radiation: "radiation_Wpm2",
  //   uv: "UV", cloudbase: "cloudbase_meter", beaufort: "beaufort_count"
  // },

  /* ── optional: your own weather station ─────────────────────────────
     Leave the whole `station` block out and the panels still work — you
     simply get forecast, ensemble and climate with no station comparison.

     These are the extras it unlocks:

       weewxJson     weewx.json from the Belchertown skin. Adds the
                     "station so far" reading to the forecast card and the
                     warning when observations beat the forecast.

       jsonBase      Base URL of the Belchertown chart JSONs (day.json,
                     week.json …). Used by the wind rose and the history
                     charts in the weeWX integration (Path B only).

       verification  verification.json produced by scripts/verify.py. Adds
                     the forecast accuracy panel and the model league table.
                                                                         */
  // station: {
  //   /* live loop packet as JSON — the polling alternative to MQTT.
  //      weeWX can write this every archive interval.                    */
  //   loopJson:        "https://example.com/loop.json",
  //
  //   /* day/week/month/year stats from the Belchertown skin             */
  //   weewxJson:       "https://example.com/weewx.json",
  //
  //   /* base URL of the Belchertown chart JSONs (day.json, week.json…)  */
  //   jsonBase:        "https://example.com/json/",
  //
  //   /* barograph history written by your own logger                    */
  //   pressureHistory: "https://example.com/pressure_history.json",
  //
  //   /* air quality history, "<span>_aq.json" appended — optional       */
  //   airQualityBase:  "https://example.com/weewx/json/",
  //
  //   /* written by scripts/verify.py — see docs/verification.md         */
  //   verification:    "https://example.com/weewx/json/verification.json"
  // },

  /* ── optional: ensemble models ──────────────────────────────────────
     Which ensembles to pool on the Ensemble tab, and which are on by
     default. More members is better but slower; three is a good balance.
     Valid ids: ecmwf_ifs025, gfs_seamless, icon_seamless, gem_global,
                bom_access_global_ensemble                               */
  ensembleModels: ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"],

  /* ── optional: climate baseline ─────────────────────────────────────
     1991–2020 is the current WMO standard normal period. 1961–1990 is the
     older one, and will make present-day anomalies look larger.          */
  climate: {
    baselineFrom: 1991,
    baselineTo: 2020,
    firstYear: 1940          // ERA5 starts here; earlier values are ignored
  }
};
