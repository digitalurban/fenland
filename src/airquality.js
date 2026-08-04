/* ═══════════════════════════════════════════════════════════════════════
   fenland — air quality from Open-Meteo

   The dashboard originally took air quality from an AirGradient over MQTT,
   which is fine if you own one and useless if you don't — and most people
   don't. This fills the gap from Open-Meteo's air-quality API: free, no
   key, no registration, same terms as the forecast and archive endpoints
   already used elsewhere.

   A real sensor still wins where one exists. This is a fallback, not a
   replacement: it is a model interpolated to your coordinates, so it will
   not see the bonfire in the next field.

   Scale note: values are US AQI (0–500), not the European index. That is
   deliberate — the coloured bar on the dashboard tile is built around the
   US breakpoints (50/100/150/200/300), and reporting one scale against
   another's bands would be quietly wrong.
   ═══════════════════════════════════════════════════════════════════════ */
window.__AIRQ__ = (function () {
  "use strict";

  const CFG = window.WXCONFIG || {};
  const API = "https://air-quality-api.open-meteo.com/v1/air-quality";
  const TZ = CFG.timezone || "auto";

  /* "auto" uses the station's own sensor when one is configured and falls
     back to Open-Meteo when it is not. false switches the fallback off. */
  const MODE = CFG.airQuality === undefined ? "auto" : CFG.airQuality;
  const HAS_COORDS = CFG.lat != null && CFG.lon != null;
  const ENABLED = MODE !== false && HAS_COORDS;

  /* how much history each span needs; the API caps past_days at 92, so a
     year of hourly air quality simply isn't available from this source */
  const PAST_DAYS = { day: 1, week: 7, month: 31 };

  let currentCache = null;      // { at, value }
  const histCache = {};

  function qs(extra) {
    const p = new URLSearchParams(Object.assign({
      latitude: CFG.lat, longitude: CFG.lon, timezone: TZ
    }, extra));
    return API + "?" + p.toString();
  }

  /* ── current conditions, for the dashboard tiles ─────────────────────
     Cached for half an hour: the model updates hourly, so polling harder
     would just be rude to a free service. */
  async function current() {
    if (!ENABLED) return null;
    if (currentCache && Date.now() - currentCache.at < 30 * 60 * 1000) {
      return currentCache.value;
    }
    try {
      const r = await fetch(qs({ current: "pm2_5,us_aqi" }) + "&cacheburst=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const c = j.current || {};
      const value = {
        pm25: typeof c.pm2_5 === "number" ? c.pm2_5 : null,
        aqi: typeof c.us_aqi === "number" ? c.us_aqi : null
      };
      currentCache = { at: Date.now(), value: value };
      return value;
    } catch (e) {
      console.warn("Open-Meteo air quality unavailable:", e.message);
      return null;
    }
  }

  /* ── history, in the same shape the station JSON uses ────────────────
     [[epochMillis, value], …] so renderCharts can plot either source
     without caring which it got. */
  async function history(span) {
    if (!ENABLED) return null;
    const days = PAST_DAYS[span];
    if (!days) return null;                 // year: out of range, say so upstream
    if (histCache[span]) return histCache[span];
    try {
      const r = await fetch(qs({
        hourly: "pm2_5,us_aqi", past_days: days, forecast_days: 1
      }) + "&cacheburst=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const h = j.hourly || {};
      const t = h.time || [];
      const now = Date.now();
      const pair = key => t.map((iso, i) => {
        const v = h[key] ? h[key][i] : null;
        return v == null ? null : [new Date(iso).getTime(), v];
      }).filter(p => p && p[0] <= now);      // don't plot the forecast tail
      const out = { pm2_5: pair("pm2_5"), aqi: pair("us_aqi") };
      histCache[span] = out;
      return out;
    } catch (e) {
      console.warn("Open-Meteo air quality history unavailable:", e.message);
      return null;
    }
  }

  return {
    enabled: ENABLED,
    mode: MODE,
    spans: Object.keys(PAST_DAYS),
    current: current,
    history: history
  };
})();
