# Fenland

A weather skin for [weeWX](https://weewx.com) — live dashboard, multi-model
ensemble, 16-day forecast and climatology back to 1940.

**[Live demo](https://digitalurban.github.io/fenland/)** ·
[Install](#install) · [Configuration](#configuration) · [weeWX notes](weewx/README.md)

<a href="img/dashboard.jpg"><img src="img/dashboard.jpg" width="900" alt="Fenland dashboard"></a>

Fenland is a front end, not a data logger. weeWX does the hard work of talking
to your station; this shows it, and adds the forecast side that weeWX skins
usually leave out — where the models disagree, how confident to be, and how
unusual today is against the long record.

It works without a weather station too. Point it at any coordinates and the
forecast, ensemble and climate tabs work on their own.

---

## What's in it

### Live dashboard

<a href="img/gauges.jpg"><img src="img/gauges.jpg" width="460" align="right" alt="Wind gauges"></a>

Hand-drawn SVG instruments — wind speed with Beaufort banding, a compass with a
needle that takes the short way round, a rolling barograph with a tendency
forecast, and metric tiles for whatever else your station reports. Fed either
by MQTT for genuinely live updates, or by polling a JSON file if you don't run
a broker.

The layout is a single screen with no scrolling, scaled to your window: readable
on a 13″ laptop, comfortable on a 4K panel, and it falls back to a stacked
mobile layout on a phone.

<br clear="all">

### Forecast

<a href="img/forecast.jpg"><img src="img/forecast.jpg" width="900" alt="Forecast tab"></a>

Open-Meteo's best-match run, hourly to 16 days, with the temperature line
colour-banded by value. Fourteen day cards that expand to full detail, an hourly
strip, and a written summary in plain English.

Two things set it apart from a normal forecast display. It shows **where the
deterministic run sits inside the ensemble spread** — a forecast at the 90th
percentile of its own ensemble is telling you something. And if you have a
station, it flags when your gauge has already beaten the forecast maximum.

### Ensemble

<a href="img/ensemble.jpg"><img src="img/ensemble.jpg" width="900" alt="Ensemble tab"></a>

120+ members from ECMWF, NOAA GEFS and DWD ICON pooled into one view, coloured
by forecast centre so an outlier model is obvious at a glance. Day-by-day
figures give the pooled mean, the 10–90% range and the full member envelope,
with **separate confidence ratings for temperature and rainfall**, because those
fail independently — you can know the temperature to within a degree and have no
idea whether it will rain.

The written analysis is generated from the live spread on every load.

### Climate

<a href="img/climate.jpg"><img src="img/climate.jpg" width="900" alt="Climate tab"></a>

ERA5 reanalysis from 1940 to today for your coordinates, so the page can say
how unusual today is rather than just what it is: *"the driest July in the 87 years
since 1940"*, *"no year since 1940 has been drier to this date"*. Cumulative
rainfall against the 1991–2020 normal with the driest and wettest years for
context, monthly anomalies, and ranked tables with the current year highlighted.

About a megabyte, fetched once and cached for 24 hours.

### History and stats

The weeWX charts you'd expect — temperature, wind, rain, barometer, air quality
— plus a wind rose computed in the browser from your own direction and speed
data, and solar radiation and UV if your station reports them.

These two tabs read the chart JSON published by the
[Belchertown skin](https://github.com/poblabs/weewx-belchertown) (`day.json`,
`week.json`, `weewx.json` and so on). If you don't run Belchertown they stay
empty and the other three tabs work exactly as normal — Fenland doesn't
duplicate work that skin already does well.

Every series is colour-banded by value — temperature on a cold-to-hot scale,
wind on Beaufort colours, AQI on the standard bands — and converted into your
display units on the way through, so these tabs read in the same units as the
rest of the page even if weeWX publishes in another.

---

## Install

You need somewhere to serve static files. That can be your existing web host,
or GitHub Pages for free.

```bash
git clone https://github.com/digitalurban/fenland.git
cd fenland
cp config.example.js config.js
```

Edit `config.js` — at minimum `place`, `lat`, `lon` and `timezone`. Then serve
the folder:

```bash
python3 -m http.server 8000     # then visit localhost:8000
```

**Opening `index.html` directly won't work.** Browsers block outbound requests
from `file://` pages, so nothing can reach the APIs. It has to be served over
http, even locally.

Without a `station` block you get the forecast, ensemble and climate tabs
working from Open-Meteo alone — no weather station required. Add one and the
dashboard comes alive from MQTT or a polled JSON file; add Belchertown's chart
JSON and the history and stats tabs fill in too. See [weewx/README.md](weewx/README.md) for what weeWX needs to publish.

### Hosting on GitHub Pages

Push the repo, then Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

One catch worth knowing before you spend an evening on it: **your JSON files
must send a CORS header**, because the page is now on a different origin from
your data. On Apache, add this to `.htaccess` in your web root — at the very
top, outside any `# BEGIN WordPress` block, since those get rewritten:

```apache
<IfModule mod_headers.c>
  <FilesMatch "\.json$">
    Header set Access-Control-Allow-Origin "*"
  </FilesMatch>
</IfModule>
```

Check it worked:

```bash
curl -sI -H "Origin: https://yourname.github.io" \
  https://yoursite.example/weewx.json | grep -i access-control
```

Keep the JSON on your own host rather than in the repo. Pages throttles frequent
rebuilds, and weather data changing every five minutes will hit that limit.

---

## How it fits together

No framework, no npm, nothing to compile before deploying. Three things load
from a CDN: **Highcharts** for the charts, **mqtt.js** for the live feed, and
**IBM Plex** from Google Fonts. Everything else is in the repo. `index.html`
loads a handful of independent files:

| File | Does |
|---|---|
| `config.js` | Your settings. The only file you have to edit |
| `index.html` | **Generated** by `build.py` from `panes/` — do not edit directly |
| `src/units.js` | Converts metric internals into your chosen display units. **Loads first** — everything else formats through it |
| `src/dashboard.js` | Live gauges, tiles and barograph, over MQTT or JSON polling |
| `src/forecast.js` | Forecast tab |
| `src/ensemble.js` | Ensemble tab |
| `src/climate.js` | Climate tab |
| `src/verify-panel.js` | Forecast-accuracy panel, if verification is set up |
| `src/colours.js` | Colours every chart series by value |
| `src/windrose.js`, `src/solar.js` | Two extra history charts |

Each panel defines exactly one global, loads its own data lazily the first time
its tab is opened, and fails quietly if its data source is missing. Deleting any
of them removes that feature and breaks nothing else.

The page markup lives in `panes/` and `index.html` is assembled from it:

```bash
python3 build.py        # after editing anything in panes/
```

To be clear about the apparent contradiction above: there is no build step to
*install* Fenland — clone it, edit `config.js`, serve it. `build.py` only
matters if you change the markup, and it exists because editing `index.html`
directly works right up until you forget, at which point the two copies drift
and a change silently fails to reach the site.

It also stamps `?v=<version>` onto every local script and stylesheet, taking
the version from `FENLAND.version` in `src/dashboard.js`. That matters more
than it sounds: GitHub Pages serves CSS and JS with a long cache lifetime, and
a query string on the *page* URL does not reach the assets underneath it.
Without the stamp, anyone who updates Fenland keeps running the old code until
they happen to hard-refresh — and reports bugs that were already fixed.

So shipping an update is:

```bash
# bump FENLAND.version in src/dashboard.js, then
python3 build.py && git commit -am "v1.1.0" && git push
```

Browsers pick it up on the next load, no hard refresh needed. The one
exception is `config.js`, which carries the same stamp — if you edit your own
settings without bumping the version, hard-refresh once to see them.

---

## Configuration

Everything is in `config.js`; `config.example.js` is the annotated reference.

| Key | Required | Notes |
|---|---|---|
| `place` | yes | Shown in the header |
| `lat`, `lon` | yes | Decimal degrees, negative for S/W |
| `timezone` | yes | IANA name, e.g. `Europe/London` |
| `elevation`, `hardware` | no | Cosmetic, shown under the title |
| `credit` | no | Small "FENLAND" footer link. `false` removes it |
| `units.temp` | no | `c` or `f`. Default `c` |
| `units.rain` | no | `mm` or `in`. Default `mm` |
| `units.pressure` | no | `mb` or `inhg`. Default `mb` |
| `units.wind` | no | `mph`, `kmh`, `ms`, `kn`. Default `mph` |
| `mqtt` | no | Broker URL and topics — see below |
| `pollSeconds` | no | JSON polling interval. Default 20 |
| `station.*` | no | URLs of your weeWX JSON files |
| `stationUnits` | no | What your station *publishes*, if not metric — see below |
| `fields` | no | Loop-packet key names, if yours differ from the defaults |
| `ensembleModels` | no | Which ensembles to pool |
| `climate.baselineFrom/To` | no | Default 1991–2020, the WMO normal |
| `climate.firstYear` | no | Start of the record. Default 1940, the ERA5 limit |
| `nowcast` | no | Barometric tendency line. `false` hides it — see below |
| `maxRainRate` | no | Ignore impossible gauge spikes above this mm/hr. Default 500, `null` disables |
| `windy` | no | Adds a Windy radar tab. Omit the block and the tab is hidden |

Everything is computed internally in metric and converted only for display, so
thresholds, rankings and confidence ratings stay consistent whichever units you
pick. Temperature differences (bias, anomaly, spread) convert correctly as
differences rather than as temperatures — a −1.5 °C bias reads as −2.7 °F, not
29.3 °F.

### Barometric tendency

The line under the barograph — *"Fair, becoming unsettled"* — comes from the
pressure reading, its 3-hour trend and the wind direction. It's the same family
as the Negretti & Zambra barometer tables of the 1850s, and it carries their
assumptions with it.

Those assumptions are regional. The band edges are temperate-maritime values,
too narrow for a continental interior and close to useless in the tropics,
where sea-level pressure hardly moves and a station would sit in one band all
year. The wind rule — easterly through southerly meaning humid air — is
Northern Hemisphere; south of the equator the circulation around a low runs the
other way, so Fenland mirrors the sector automatically when `lat` is negative.
The reversal is settled physics, but the sector itself is a heuristic in either
hemisphere.

The panel explains this on hover. If your climate isn't temperate maritime,
`nowcast: false` removes it rather than leaving you a plausible-looking
sentence that doesn't apply where you are.

---

### Radar


An embedded Windy map, centred on your coordinates and using your units, so
it agrees with the rest of the page rather than contradicting it. Belchertown
does this by having you paste an iframe into `radar_html`, which works but
hardcodes the location, size and units — move the station or switch to
Fahrenheit and you regenerate it by hand. Here it's derived from `config.js`.

```js
windy: { zoom: 8, overlay: "radar", level: "surface" }
```

Omit the block and the tab doesn't appear. The frame is built only when the
tab is first opened, so if you never open it nothing contacts Windy — this is
the one place Fenland talks to a third-party service rather than a CDN.

**`overlay: "radar"` is regional.** It's a composite of national radar
networks: good over Europe, North America, Japan and Australia, empty over
much of the rest of the world. Outside coverage the map looks broken when it
isn't. Use `overlay: "rain"` there — modelled precipitation, global but
forecast rather than observed.

`embed:` takes raw iframe markup if you'd rather configure Windy yourself, or
use another provider entirely.

---

### Live data

Two ways, and you can set both:

**MQTT** gives genuinely live updates. Your broker needs to allow anonymous
subscribe over `wss://` — no credentials are used, and none should be, since
anything in `config.js` is public.

**JSON polling** needs no broker at all: weeWX writes the loop packet to a file,
the page fetches it on a timer. Slower, but far easier to set up.

Either way, tell Fenland what your station publishes and what you want to see —
they are two separate settings and they don't have to agree:

```js
units:        { temp: "c", rain: "mm", pressure: "mb",   wind: "mph" },  // what you read
stationUnits: { temp: "f", rain: "in", pressure: "inhg", wind: "mph" },  // what arrives
```

That example is a US station displayed in Celsius. Reverse them for a metric
station displayed in Fahrenheit. Both are optional and both default to metric,
so a station publishing METRICWX needs neither.

The reason they're separate is that everything in Fenland — the trend
thresholds, the ensemble spread, the 86-year rankings — is computed in metric.
Values are converted once on arrival and once for display, and nothing in
between has to care.

The **names** in the payload are a different question again, and the defaults
are worth being precise about: they assume `unit_system = METRICWX` with
`append_units_label = True`, *and* wind overridden to mph. That override is
common but it is not stock, so be aware of what you actually publish:

| Your weeWX setting | Wind arrives as | Rain arrives as |
|---|---|---|
| METRICWX + mph override | `windSpeed_mph` | `dayRain_mm` |
| METRICWX (stock) | m/s | `dayRain_mm` |
| METRIC | `windSpeed_kph` | `dayRain_cm` |
| US | mph | inches |

Only the first row works untouched. For the others, remap with `fields` and
declare the units with `stationUnits` — for a stock METRIC feed:

```js
fields:       { windSpeed: "windSpeed_kph", windGust: "windGust_kph",
                dayRain: "dayRain_cm", rainRate: "rainRate_cm_per_hour" },
stationUnits: { rain: "cm", wind: "kmh" },
```

You don't have to work this out from the table. If a configured name is absent
from your feed, Fenland says so once in the browser console — naming what it
looked for and listing every key the payload actually contains. Open the
developer console if a gauge stays blank.

`stationUnits` governs **everything your station sends**, not just the live
packet: the barograph history, the three-hour trends in `weewx.json`, and the
Belchertown chart JSON behind the History tab. All of it is normalised on
arrival and re-expressed in your display units, so one setting is enough.

The wind dial rescales with `units.wind` too — 0–60 mph, 0–100 km/h, 0–30 m/s
or 0–55 kn — with the Beaufort marks landing at the right physical speeds
whichever you pick.

One warning: getting `stationUnits` wrong is silent rather than noisy. 21°C
labelled as °F reads as a cold day, not as an error. If the numbers look
consistently wrong, check this before anything else.

With both configured, MQTT is used and polling waits in reserve — if the broker
goes unreachable for 90 seconds, the page falls back rather than sitting dead.

---

## Forecast verification

Optional, and the most interesting part if you have a station.

`scripts/verify.py` runs nightly, records what five different models forecast
and what your station actually measured, and scores one against the other by
lead time. After a few weeks it can tell you **which model is genuinely best for
your site** — not in general, but for your field, your valley, your patch of
coast. It scores Open-Meteo's blend, UK Met Office, ECMWF, DWD ICON and NOAA GFS
side by side.

Setup in [docs/verification.md](docs/verification.md).

---

## Data sources

- **[Open-Meteo](https://open-meteo.com)** — forecast, ensemble and ERA5 archive
  APIs. Free, no key, no registration. Data is CC BY 4.0 and the pages carry the
  attribution.
- **ERA5** reanalysis (ECMWF / Copernicus) via the Open-Meteo archive.

Please don't hammer the API. Nothing loads until a tab is opened and the
climatology caches for 24 hours; if you deploy somewhere busy, consider
Open-Meteo's paid tier.

---

## Status and roadmap

Version 1.1.0. Running in production at
[digitalurban.github.io/fenland](https://digitalurban.github.io/fenland/), which
is also the demo — so if the demo is broken, so is the author's weather station.

**Known gaps, honestly:**

- **Imperial display is tested headlessly, not visually.** Every panel is
  exercised across both temperature systems and all four wind units, including
  the awkward case of temperature *differences* — but no one has yet looked at
  the page in Fahrenheit in a real browser, so layout and label-width problems
  are entirely possible. If you are the first, please open an issue with a
  screenshot of anything that reads oddly.
- **Forecast verification needs weeks before it says much.** That is inherent,
  not a defect, but do not judge the model league table on a fortnight.
- **Only Fahrenheit-style US units are handled on input.** `stationUnits`
  covers °F, inHg, inches, cm, kPa and the four wind units. Anything more exotic
  needs converting before it reaches the page.

**On the list:**

- Air quality from Open-Meteo's air-quality API, so the panel works without an
  AirGradient or any other sensor
- A health panel flagging stale or zero-byte JSON files before they show up as
  a blank chart. Written after exactly that happened
- Cumulative rainfall for the year on the history tab, which needs `chart3`
  adding to the `[year]` group in `graphs.conf`

## Contributing

Issues and pull requests welcome. Two things that help:

- **Say what your station publishes.** Most problems are field names or units —
  paste a sample of your MQTT payload or `loop.json` and it is usually obvious.
- **Quote the version** from the footer credit. It is there so that "which
  version?" is answerable from a screenshot.

Run `python3 build.py` after editing anything in `panes/`, and commit both the
pane and the regenerated `index.html`.

## Licence

MIT — see [LICENSE](LICENSE).

**Highcharts** renders the charts and is *not* covered by that licence. It is
free for personal and non-commercial use; commercial use needs a licence from
Highsoft. Chart calls are isolated, so swapping in ECharts or uPlot (both MIT)
is a contained job if that matters to you.

[mqtt.js](https://github.com/mqttjs/MQTT.js) is MIT. IBM Plex is SIL OFL. If
you would rather not call Google Fonts, drop the two `fonts.googleapis.com`
`<link>` tags from the header block in `build.py`, re-run it, and the page falls
back to the system monospace stack.

Nothing else, and nothing to compile.

---

## Credits

Built on [weeWX](https://weewx.com), which does the real work of talking to the
hardware and keeping the archive.

The History and Stats tabs read the JSON published by the
[Belchertown skin](https://github.com/poblabs/weewx-belchertown) rather than
reinventing it. Belchertown is the more established skin and worth your time
either way — the two coexist happily, and if you would rather keep your existing
site and take only the Forecast, Ensemble and Climate panels, that is a
documented path: see [weewx/README.md](weewx/README.md).

Weather data from [Open-Meteo](https://open-meteo.com), whose free, keyless,
attribution-only API is the reason a project like this can exist at all.
