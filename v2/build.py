#!/usr/bin/env python3
"""
build.py — assemble index.html from the pieces in panes/

index.html is generated, not edited. The markup lives once, in panes/, which
is also what the weeWX integration guide tells people to copy. Editing
index.html directly means the two drift apart and a change silently fails to
appear on the site — which is exactly what happened before this script existed.

    python3 build.py

Run it after touching anything in panes/, then commit both.
"""

import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
pane = lambda n: open(os.path.join(HERE, "panes", n + ".html"), encoding="utf-8").read().rstrip("\n")


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def insert_after(text, anchor, block, what):
    i = text.find(anchor)
    if i == -1:
        die("could not find the %s anchor in the pane markup:\n    %s" % (what, anchor[:70]))
    j = i + len(anchor)
    return text[:j] + block + text[j:]


# ── the forecast pane gains the verification card ────────────────────────────
forecast = pane("forecast")
verify_anchor = ('            <div id="fcCross"><div class="chart-loading">Waiting for ensemble data…</div></div>\n'
                 '          </div>')
forecast = insert_after(forecast, verify_anchor, "\n" + pane("verify-panel"), "forecast cross-check card")

# ── the overlay gains two tabs, three panes and two history charts ───────────
overlay = pane("overlay")

overlay = insert_after(overlay,
    '<button class="detail-tab" id="tabBtnForecast">FORECAST</button>',
    '\n        <button class="detail-tab" id="tabBtnEnsemble">ENSEMBLE</button>', "FORECAST tab")
overlay = insert_after(overlay,
    '<button class="detail-tab" id="tabBtnStats">STATS</button>',
    '\n        <button class="detail-tab" id="tabBtnClimate">CLIMATE</button>'
    '\n        <button class="detail-tab" id="tabBtnWindy">RADAR</button>', "STATS tab")

overlay = insert_after(overlay,
    '<div class="forecast-daily" id="forecastDaily"></div>',
    "\n" + forecast, "#forecastDaily")

# wind rose and solar go inside the history chart grid, after air quality.
# Matching to the card's own closing tag matters — the obvious regex stops at
# the card BODY's closing tag and nests them inside it instead.
m = re.search(r'<div class="chart-card"><div class="chart-card-title">Air Quality[^<]*</div>'
              r'<div class="chart-card-body" id="chartAirQuality">'
              r'<div class="chart-loading">[^<]*</div></div></div>', overlay)
if not m:
    die("could not locate the complete Air Quality card")
overlay = overlay[:m.end()] + "\n        " + pane("windrose").strip() + \
                              "\n        " + pane("solar").strip() + overlay[m.end():]

# ensemble and climate panes follow the stats pane
m = re.search(r'<div class="detail-pane" id="paneStats">.*?\n    </div>\n', overlay, re.S)
if not m:
    die("could not locate the #paneStats block")
overlay = overlay[:m.end()] + "\n" + pane("ensemble") + "\n\n" + pane("climate") + "\n\n" + pane("windy") + "\n" + overlay[m.end():]

HTML = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<!-- Revalidate the HTML on every load. The ?v= stamps below keep the CSS and
     JS cached until the version changes, which is what you want — but those
     stamps live in THIS file, so a cached copy of it keeps asking for the old
     versions and the whole mechanism is defeated. One small conditional
     request per load fixes that; the assets themselves stay cached. -->
<meta http-equiv="Cache-Control" content="no-cache, must-revalidate">
<title>Fenland</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="config.js"></script>
<script>
/* Resolve the theme before the stylesheets paint, otherwise a dark-mode user
   gets a white flash on every load. Deliberately inline and dependency-free:
   anything in an external file arrives too late to prevent it.
     auto  follow the operating system (default)
     sun   dark between sunset and sunrise, using the configured coordinates
     light / dark  forced  */
(function () {
  try {
    var c = window.WXCONFIG || {}, t = String(c.theme || "auto").toLowerCase(), dark;
    /* A visitor's own choice outranks both the config and the OS — someone
       running a dark desktop may still want this page light. */
    var saved = null;
    try { saved = localStorage.getItem("fenland-theme"); } catch (e) {}
    if (saved === "light" || saved === "dark") t = saved;
    if (t === "dark") dark = true;
    else if (t === "light") dark = false;
    else if (t === "sun" && c.lat != null && c.lon != null) {
      /* cheap solar elevation — good to a few minutes, which is all a theme
         switch needs, and avoids pulling the full sunrise maths in here */
      var n = new Date(), r = Math.PI / 180,
          day = Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 864e5),
          dec = 23.44 * r * Math.sin(2 * Math.PI * (day - 81) / 365),
          hr = n.getUTCHours() + n.getUTCMinutes() / 60,
          ha = (hr - 12) * 15 * r + c.lon * r,
          el = Math.asin(Math.sin(c.lat * r) * Math.sin(dec) +
                         Math.cos(c.lat * r) * Math.cos(dec) * Math.cos(ha));
      dark = el < 0;
    } else dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) { /* a broken config must never leave the page unstyled */ }
})();
</script>
<script>
/* Whole-dashboard view on a phone. iOS "Request Desktop Website" changes the
   user-agent, not the viewport: the page still lays out at 390 CSS px and
   still gets the stacked phone layout, because the layout is chosen by a
   1024px media query. Telling the phone it is 1024 wide and letting it zoom
   out is the only thing that actually shows the whole frame — small, but
   whole, and pinch-zoom still works. Inline and ahead of the stylesheets,
   because swapping the viewport after first paint is not reliable. */
(function () {
  try {
    var full = false;
    try { full = localStorage.getItem("fenland-view") === "full"; } catch (e) {}
    if (full) {
      document.documentElement.setAttribute("data-view", "full");
      var m = document.querySelector('meta[name="viewport"]');
      /* user-scalable spelled out: pinch had stopped working because the
         desktop rules put overflow:hidden on html and body, so there was
         nothing to pan once zoomed. */
      if (m) m.setAttribute("content", "width=1024, viewport-fit=cover, user-scalable=yes, maximum-scale=6");
      /* Added to the home screen, iOS runs the page under the status bar
         because of the black-translucent bar style. At 1x that is what the
         safe-area padding is for; zoomed out to a 1024px viewport the inset
         no longer matches the bar, and the frame's top edge — the place name
         and clock — ended up behind it with no way to scroll to it. In full
         view the bar becomes its own opaque strip instead, so the page starts
         below it. Set here, before first paint, because iOS reads the bar
         style once. */
      var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (bar) bar.setAttribute("content", "default");

      /* --k, measured rather than declared. The CSS fit is built on viewport
         units, and on this phone in standalone they do not describe the space
         the frame actually gets: against 473px of real visible height, dvh
         reported 594 and svh was no better, so the frame kept being built
         taller than the screen and running off the bottom. visualViewport
         does report 473, so full view sizes the design pixel from that and
         from the scaler's own padding, with no lower clamp — whole frame,
         however small that makes it. Re-run on resize and rotation. */
      var fitFrame = function () {
        var vv = window.visualViewport;
        var w = vv ? vv.width : window.innerWidth;
        var h = vv ? vv.height : window.innerHeight;
        var pad = 24;
        var sc = document.querySelector(".desktop-only-scaler");
        if (sc) {
          var cs = getComputedStyle(sc);
          pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        }
        /* Fit the design pixel to whichever axis runs out first, then let the
           frame keep the screen's own width rather than sitting in a 4:3
           letterbox. The grid inside is proportional, so a landscape phone
           spends the spare width on the columns instead of on empty margins.
           The stretch is capped so the frame cannot become a ribbon. */
        var kH = (h - pad - 4) / 1404;
        var kW = (w - 8) / 1872;
        var k = Math.min(kH, kW);
        if (!(k > 0)) return;
        var fw = Math.min(w - 8, 1872 * k * 2.2);
        document.documentElement.style.setProperty("--k", k.toFixed(4) + "px");
        document.documentElement.style.setProperty("--frame-w", Math.round(fw) + "px");
        if (/diag/.test(location.hash)) {
          var d = document.getElementById("fenFit") || document.createElement("div");
          d.id = "fenFit";
          d.setAttribute("style", "position:fixed;left:0;bottom:0;z-index:99999;background:#000;" +
            "color:#0f0;font:600 11px ui-monospace,monospace;padding:2px 5px");
          d.textContent = Math.round(w) + "x" + Math.round(h) + " pad" + Math.round(pad) +
                          " k" + k.toFixed(3) + " frame" + Math.round(fw) + "x" + Math.round(1404 * k);
          document.body.appendChild(d);
        }
      };
      var onReady = function () {
        fitFrame();
        /* a second pass once fonts and the status bar have settled */
        setTimeout(fitFrame, 300);
        window.addEventListener("resize", fitFrame);
        window.addEventListener("orientationchange", function () { setTimeout(fitFrame, 250); });
        if (window.visualViewport) window.visualViewport.addEventListener("resize", fitFrame);
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
      else onReady();
    }
    var paint = function () {
      ["viewToggle", "viewToggle_mob"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = full ? "\u25A3 PHONE VIEW" : "\u25A2 FULL VIEW";
        el.title = full ? "Showing the whole dashboard — tap for the phone layout"
                        : "Show the whole dashboard, scaled down to fit";
        el.style.display = (full || window.innerWidth < 1024) ? "" : "none";
      });
    };
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("#viewToggle, #viewToggle_mob");
      if (!t) return;
      try { localStorage.setItem("fenland-view", full ? "phone" : "full"); } catch (err) {}
      location.reload();
    });
    document.addEventListener("DOMContentLoaded", paint);
    setInterval(paint, 1000);
  } catch (e) { /* a broken storage must never leave the page unusable */ }
})();
</script>
<link rel="stylesheet" href="css/dashboard.css">
<link rel="stylesheet" href="css/panels.css">
<script>
/* The bar skin is a stylesheet override, so it has to be decided before the
   first paint rather than by a script at the end of the body — otherwise the
   dial layout renders and is then thrown away. Inline for the same reason
   the theme resolver above is inline. */
(function () {
  try {
    if (String(((window.WXCONFIG || {}).windPanel) || "bars").toLowerCase() === "dials") return;
    document.write('<link rel="stylesheet" href="css/windtrace.css">');
  } catch (e) { /* a broken config must never leave the page unstyled */ }
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"></script>
</head>
<body>
<!-- GENERATED BY build.py — edit panes/*.html and re-run, do not edit this file -->

{dashboard}

{overlay}

<script src="src/units.js"></script>
<script src="src/colours.js"></script>
<script src="src/airquality.js"></script>
<script src="src/dashboard.js"></script>
<script src="src/windtrace.js"></script>
<script src="src/tempchart.js"></script>
<script src="src/ensemble.js"></script>
<script src="src/forecast.js"></script>
<script src="src/climate.js"></script>
<script src="src/verify-panel.js"></script>
<script src="src/windrose.js"></script>
<script src="src/solar.js"></script>
<script src="src/windy.js"></script>
</body>
</html>
'''.replace("{dashboard}", pane("dashboard")).replace("{overlay}", overlay)

# ── cache-busting ────────────────────────────────────────────────────────
# GitHub Pages serves CSS and JS with a long cache lifetime, and a query
# string on the page URL does not reach the assets underneath it. Without
# this, someone who updates Fenland keeps running the old code until they
# happen to hard-refresh — and will report bugs that were already fixed.
# Stamping the version on every LOCAL asset means a version bump invalidates
# them automatically. External URLs are left alone: the CDNs are already
# versioned in their paths, and Google Fonts rejects unknown parameters.
VERSION = re.search(r'version:\s*"([^"]+)"',
                    open(os.path.join(HERE, "src", "dashboard.js"), encoding="utf-8").read())
if not VERSION:
    die("could not read FENLAND.version from src/dashboard.js")
VERSION = VERSION.group(1)

def stamp(m):
    attr, url = m.group(1), m.group(2)
    if url.startswith(("http://", "https://", "//", "data:")):
        return m.group(0)
    joiner = "&" if "?" in url else "?"
    return '%s="%s%sv=%s"' % (attr, url, joiner, VERSION)

HTML = re.sub(r'\b(src|href)="([^"]+)"', stamp, HTML)

out = os.path.join(HERE, "index.html")
open(out, "w", encoding="utf-8").write(HTML)

# sanity checks — cheaper to fail here than to notice on the live site
ids = re.findall(r'id="(chart\w+|pane\w+|tabBtn\w+|footCredit)"', HTML)
need = ["chartTemp", "chartWind", "chartRain", "chartBaro", "chartAirQuality", "chartRose", "chartSolar",
        "paneCharts", "paneForecast", "paneStats", "paneEnsemble", "paneClimate",
        "tabBtnCharts", "tabBtnForecast", "tabBtnEnsemble", "tabBtnStats", "tabBtnClimate",
        "tabBtnWindy", "paneWindy", "footCredit"]
missing = [n for n in need if n not in ids]
if missing:
    die("built file is missing: " + ", ".join(missing))

print("index.html rebuilt — %d bytes" % os.path.getsize(out))
print("  history charts: " + ", ".join(i for i in ids if i.startswith("chart")))
print("  tabs:           " + ", ".join(i for i in ids if i.startswith("tabBtn")))
