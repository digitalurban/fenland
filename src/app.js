/*
   app.js — the standalone page's shell.

   Only used by index.html (Path A). If you are embedding the panels into an
   existing weeWX site (Path B) your own page already has tab switching, so
   this file is not needed — see weewx/README.md.

   Its whole job is: label the header from config, switch tabs, and call the
   matching panel's open() the first time each is shown. The panels load their
   own data lazily, so nothing is fetched until a tab is actually opened.
 */

(function () {
  "use strict";

  const CFG = window.WXCONFIG || {};

  /* ── header ───────────────────────────────────────────────────────── */
  function fmtCoord(v, pos, neg) {
    if (v == null) return "";
    return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? pos : neg);
  }
  const name = document.getElementById("placeName");
  const where = document.getElementById("placeWhere");
  if (name) name.textContent = CFG.place || "Weather Panels";
  if (where) {
    where.textContent = [
      fmtCoord(CFG.lat, "N", "S") + ", " + fmtCoord(CFG.lon, "E", "W"),
      CFG.elevation != null ? CFG.elevation + " m ASL" : "",
      CFG.station && CFG.station.weewxJson ? "station data connected" : ""
    ].filter(Boolean).join(" · ");
  }

  const clock = document.getElementById("clock");
  function tick() {
    if (!clock) return;
    const d = new Date();
    clock.textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) +
                        " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 30000);

  /* ── tabs ─────────────────────────────────────────────────────────── */
  const PANES = {
    forecast: { el: "paneForecast", open: () => { window.__FORECAST2__ && window.__FORECAST2__.render();
                                                  window.__VERIFY__ && window.__VERIFY__.load(); } },
    ensemble: { el: "paneEnsemble", open: () => window.__ENSEMBLE__ && window.__ENSEMBLE__.open() },
    climate:  { el: "paneClimate",  open: () => window.__CLIMATE__ && window.__CLIMATE__.open() }
  };

  function show(tab) {
    Object.keys(PANES).forEach(k => {
      const el = document.getElementById(PANES[k].el);
      if (el) el.classList.toggle("active", k === tab);
    });
    document.querySelectorAll(".detail-tab").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === tab));
    try { PANES[tab] && PANES[tab].open(); } catch (e) { console.warn(tab + " panel failed:", e); }
    // remember the tab across reloads, and make it linkable
    try { location.hash = tab; } catch (e) {}
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".detail-tab");
    if (b && b.dataset.tab) show(b.dataset.tab);
  });

  const initial = (location.hash || "").replace("#", "");
  show(PANES[initial] ? initial : "forecast");
})();
