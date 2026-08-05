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
<link rel="stylesheet" href="css/dashboard.css">
<link rel="stylesheet" href="css/panels.css">
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
