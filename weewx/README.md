# Adding the panels to an existing weeWX site

`../index.html` is the complete Fenland skin: dashboard plus all five tabs. Use
that if you want the whole thing.

This guide is for the other case — you already have a weeWX site you like,
Belchertown or your own, and want only the Forecast, Ensemble and Climate
panels added to it as extra tabs.

There is no installer, deliberately. Every weeWX site's HTML is different, and
a script that guesses at your markup would break in ways that are hard to
diagnose. What follows is five edits, and they are the same five whatever your
skin looks like.

---

## What you need

- A page that already has some form of tab or panel switching (Belchertown's
  detail overlay works well), or anywhere you can put a `<div>` and show or
  hide it.
- Somewhere to serve the `src/`, `css/` and `panes/` folders from.

The panels don't care what generates your page. They only need to be on it.

---

## 1. Copy the files

Put `src/`, `css/`, `panes/` and your `config.js` somewhere your web server
serves — for example `/public_html/fenland/`.

## 2. Add the stylesheets and scripts

Before `</head>`:

```html
<link rel="stylesheet" href="/fenland/css/panels.css">
```

You do **not** need `base.css` — your skin already provides the cards, tables
and colour variables. If your skin uses different names, see
[Styling](#styling) below.

Before `</body>`:

```html
<script src="/fenland/config.js"></script>
<script src="/fenland/src/units.js"></script>
<script src="/fenland/src/colours.js"></script>
<script src="/fenland/src/ensemble.js"></script>
<script src="/fenland/src/forecast.js"></script>
<script src="/fenland/src/climate.js"></script>
<script src="/fenland/src/verify-panel.js"></script>   <!-- optional -->
<script src="/fenland/src/windy.js"></script>          <!-- optional: radar -->
```

`windy.js` needs a container with `id="windyFrame"` and a tab button with
`id="tabBtnWindy"` in your own markup — copy `panes/windy.html` for the
shape. Without a `windy` block in `config.js` it hides itself and does
nothing, so it is safe to include either way.

If you update Fenland later, add `?v=1.2.0` (or whatever version you are on)
to each `src` above and bump it when you upgrade. Browsers cache these files
hard, so without it your visitors keep running the old copy. The standalone
`index.html` does this automatically via `build.py`; hand-written tags do not.

`config.js` and `units.js` must come **first** — every panel formats its output
through `U`, and they will fail with `U is not defined` otherwise. The rest can
be in any order; each defines one global (`window.__ENSEMBLE__` and so on) and
does nothing until you call it.

Omit any panel you don't want. Leaving out `verify-panel.js` simply means no
forecast-accuracy section.

## 3. Add the pane markup

Paste the contents of `panes/ensemble.html` and `panes/climate.html` wherever
your other panes live. They are already wrapped in
`<div class="detail-pane" id="paneEnsemble">`, so if your skin uses a
different class for "hidden unless active", change it to match.

For the forecast panel, paste `panes/forecast.html` inside your existing
forecast pane — or into a new one if you'd rather keep your skin's own
forecast display.

## 4. Add the tab buttons

```html
<button class="detail-tab" id="tabBtnEnsemble">Ensemble</button>
<button class="detail-tab" id="tabBtnClimate">Climate</button>
```

## 5. Wire them up

Wherever your page decides which pane to show, call the matching `open()`:

```js
if (tab === 'ensemble')      window.__ENSEMBLE__?.open();
else if (tab === 'climate')  window.__CLIMATE__?.open();
else if (tab === 'forecast') { window.__FORECAST2__?.render();
                               window.__VERIFY__?.load(); }
```

Each panel loads its own data the first time it is opened and redraws its
charts on later opens — that second part matters, because a chart drawn into a
hidden element gets its dimensions wrong.

---

## Units

Set these in `config.js` and every panel follows:

```js
units: { temp: "f", rain: "in", pressure: "inhg", wind: "mph" }
```

Everything is computed in metric internally and converted only for display, so
thresholds and rankings behave identically whichever you choose. Omit the block
entirely for metric.

Note that this governs the *panels* only. Your own skin's dashboard will keep
displaying whatever weeWX sends it — Fenland doesn't reach into your markup.

If you also run Fenland's own dashboard (Path A), add `stationUnits` alongside
this to declare what your loop packet contains. `units` is what you read;
`stationUnits` is what arrives. Both default to metric. See the main
[README](../README.md#configuration).

---

## Styling

The panels expect a handful of classes that Belchertown already provides:
`.chart-card`, `.chart-card-title`, `.chart-card-body`, `.chart-loading`,
`.chart-grid`, `.chart-timespan-switch`, `.stats-table`,
`.stats-table-scroll`, `.stat-hi`, `.stat-lo`, `.stat-at`, and the CSS
variables `--ink`, `--slate`, `--faint`, `--wash`, `--paper`, `--accent`,
`--highlight`, `--max-marker`, `--mono`, `--sans`.

If your skin doesn't have them, copy the relevant rules out of
`../css/base.css` — it defines every one.

---

## Highcharts

The panels call `Highcharts.chart()` and will use whatever version your page
has already loaded. If your skin loads Highcharts on demand behind a function
called `ensureHighcharts()`, they'll use that automatically. If Highcharts
isn't present at all, the tables and written analysis still render and only
the charts are skipped.

---

## Two extras for Belchertown specifically

`src/windrose.js` and `src/solar.js` read Belchertown's chart JSON
(`chartDataCache`) directly, so they only work on a Belchertown-derived page.
They add two more charts to the history pane:

- **Wind rose** — computed from `windDir` and `windSpeed`, so it needs no
  config change at all. Add `<div class="chart-card"><div class="chart-card-body"
  id="chartRose"></div></div>` to your chart grid.
- **Solar radiation and UV** — needs `radiation` and `UV` adding to your
  `graphs.conf` chart groups. Until they're there the panel shows the config
  block you need rather than an error. Container id: `chartSolar`.

Both hook `renderCharts()` if it exists, so they follow your day/week/month/
year switch automatically.

`src/colours.js` is worth adding even on its own: it wraps `Highcharts.chart()`
and colours every series by value — temperature on a cold-to-hot scale, wind on
Beaufort colours, AQI on the standard bands. It also fixes a common Belchertown
annoyance: the month and year temperature charts plot only `outTemp` (the daily
*maximum*), so they never dip below freezing even when the overnight minimum
did. Where `outTemp_min` exists in the JSON, it gets plotted too.

---

## Sanity check

Open the page, click the Ensemble tab, and watch the browser console. Common
first-run problems:

| Symptom | Cause |
|---|---|
| "Could not load ensemble data" | Page opened over `file://`, or an ad-blocker is blocking open-meteo.com |
| Charts blank, tables fine | Highcharts not loaded |
| Panels don't appear at all | `open()` never called — check step 5 |
| Text clipped sideways on mobile | Your skin's grid needs `min-width: 0` on its children |
