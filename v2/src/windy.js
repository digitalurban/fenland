/* ═══════════════════════════════════════════════════════════════════════
   fenland — Windy radar tab

   An embedded Windy map, built from the coordinates and units already in
   config.js rather than from a pasted iframe blob. Belchertown takes the
   blob approach (`radar_html`), which works but hardcodes the location,
   the size and the units — move the station or switch to Fahrenheit and
   you regenerate it by hand. Here the frame is derived, so it follows the
   rest of your configuration automatically.

   Omit the `windy` block from config.js and the tab does not appear.

   The frame is only created the first time the tab is opened. That is
   partly performance, but mostly courtesy: this is the one place Fenland
   talks to a third-party service rather than a CDN, and nobody who never
   opens the tab ever touches Windy's servers.
   ═══════════════════════════════════════════════════════════════════════ */
window.__WINDY__ = (function () {
  "use strict";

  const CFG = window.WXCONFIG || {};
  const W = CFG.windy;
  const ENABLED = !!W && CFG.lat != null && CFG.lon != null;

  /* Windy's own unit tokens — not the same spellings we use internally. */
  const WIND_TOKEN = { mph: "mph", kmh: "km/h", ms: "m/s", kn: "kt" };

  function frameUrl() {
    const u = CFG.units || {};
    const p = new URLSearchParams({
      lat: CFG.lat,
      lon: CFG.lon,
      detailLat: CFG.lat,
      detailLon: CFG.lon,
      zoom: W.zoom || 8,
      level: W.level || "surface",
      overlay: W.overlay || "radar",
      product: W.overlay || "radar",
      menu: "",
      message: "true",
      marker: "true",
      calendar: "now",
      pressure: "",
      type: "map",
      location: "coordinates",
      detail: "",
      /* so the map agrees with every other number on the page */
      metricWind: WIND_TOKEN[String(u.wind || "mph").toLowerCase()] || "mph",
      metricTemp: String(u.temp || "c").toLowerCase() === "f" ? "°F" : "°C",
      radarRange: "-1"
    });
    return "https://embed.windy.com/embed2.html?" + p.toString();
  }

  let built = false;

  function open() {
    if (!ENABLED || built) return;
    const host = document.getElementById("windyFrame");
    if (!host) return;
    built = true;

    /* An escape hatch, in the same spirit as the `fields` map: if you want a
       specific Windy configuration, or a different provider entirely, paste
       your own markup and Fenland gets out of the way. */
    if (W.embed) { host.innerHTML = W.embed; return; }

    const f = document.createElement("iframe");
    f.src = frameUrl();
    f.title = "Windy weather map";
    f.loading = "lazy";
    /* Don't hand Windy the URL of the page the visitor came from. */
    f.referrerPolicy = "no-referrer";
    /* Without an allow attribute the browser logs permission warnings for
       the sensors Windy asks for — Belchertown hit exactly this. Granting
       the motion sensors is harmless and silences it. Geolocation is
       deliberately NOT granted: the map already has the station's
       coordinates, so the only thing it would add is the ability to locate
       whoever is looking at the page. */
    f.setAttribute("allow", "accelerometer; gyroscope");
    f.setAttribute("frameborder", "0");
    host.innerHTML = "";
    host.appendChild(f);
  }

  /* Hide the tab when there is no windy block, or when coordinates are
     missing — a map centred on null is worse than no map. */
  function init() {
    if (ENABLED) return;
    const btn = document.getElementById("tabBtnWindy");
    const pane = document.getElementById("paneWindy");
    if (btn) btn.style.display = "none";
    if (pane) pane.style.display = "none";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { open: open, enabled: ENABLED, url: ENABLED ? frameUrl : null };
})();
