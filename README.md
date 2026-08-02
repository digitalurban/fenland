# Fenland

Ensemble, forecast and climatology panels for personal weather sites.

Three self-contained panels that run entirely in the browser from free,
keyless APIs. They work as a standalone page for any location on earth, and
drop into an existing weeWX site — Belchertown or otherwise — if you have one.

**[Live demo](https://YOURNAME.github.io/fenland/)** ·
**[Install](#quick-start-standalone)** ·
**[weeWX integration](weewx/README.md)**

<!-- screenshots: replace these once you have them
![Ensemble tab](docs/img/ensemble.png)
![Forecast tab](docs/img/forecast.png)
![Climate tab](docs/img/climate.png)
-->

---

## What you get

### Ensemble

Pools 120+ members from ECMWF, NOAA GEFS and DWD ICON — optionally ECCC and
BOM too — into one view. Members are coloured by forecast centre, so you can
see at a glance when one model is the outlier rather than trusting a single
line. Underneath: a day-by-day table with the pooled mean, the 10–90% range
and the full member envelope, and separate confidence ratings for temperature
and rainfall, because those fail independently.

The written analysis is generated from the live spread each time you open it.
It says things like *"the members are tightly clustered"* or *"ECMWF is
materially warmer than GFS — treat the headline numbers as provisional"*.

### Forecast

Open-Meteo's best-match deterministic run, hourly out to 16 days: colour-banded
temperature, feels-like, rainfall and probability, an hourly strip, and 14 day
cards that expand into full detail.

Two things make it more than a forecast display. It shows **where the
deterministic run sits inside the ensemble spread** — a forecast at the 90th
percentile of its own ensemble is telling you something. And if you connect a
station, it flags when your gauge has already beaten the forecast maximum.

### Climate

86 years of ERA5 reanalysis for your exact coordinates, so the panel can say
how unusual today actually is: *"the driest July in the 87 years since 1940"*,
*"no year since 1940 has been drier to this date"*. Cumulative rainfall against
the 1991–2020 normal with the driest and wettest years for context, monthly
rain and temperature anomalies, and ranked tables with the current year
highlighted.

Roughly a megabyte of data, downloaded once and cached for 24 hours.

---

## Quick start (standalone)

No server, no build step, no dependencies to install.

1. Download or clone this repository.
2. `cp config.example.js config.js`
3. Edit `config.js` — set `place`, `lat`, `lon` and `timezone`. That's it.
4. Serve the folder over http. **Opening `index.html` directly will not
   work** — browsers block outbound requests from `file://` pages, so the
   panels can't reach the API. Any of these will do:

   ```bash
   python3 -m http.server 8000        # then visit localhost:8000
   ```

   ...or drop the folder into any web host, or publish it with GitHub Pages.

5. Open it. The first tab loads immediately; the others load when clicked.

### Hosting it for free

Push the repo to GitHub, then Settings → Pages → deploy from `main`. Your
panels are live at `https://yourname.github.io/fenland/` with no server to
maintain.

---

## Configuration

Everything lives in `config.js`. The commented template in
`config.example.js` is the full reference; the essentials:

| Key | Required | Notes |
|---|---|---|
| `place` | yes | Shown in the header |
| `lat`, `lon` | yes | Decimal degrees, negative for S/W |
| `timezone` | yes | IANA name, e.g. `Europe/London`, `America/Denver` |
| `units.wind` | no | `mph`, `kmh`, `ms` or `kn`. Default `mph` |
| `ensembleModels` | no | Which ensembles to pool. Default: ECMWF, GFS, ICON |
| `climate.baselineFrom/To` | no | Default 1991–2020, the WMO standard normal |
| `station.*` | no | See below — unlocks the station comparisons |

Temperature is °C and rainfall mm throughout. The written analysis is phrased
around those units, so Fahrenheit isn't supported yet.

---

## If you have a weather station

Set the `station` block in `config.js` and the panels gain:

- **`weewxJson`** — the "station so far" reading on the forecast card, and the
  warning when your gauge beats the forecast maximum
- **`verification`** — the forecast accuracy panel and model league table
  (see [docs/verification.md](docs/verification.md))
- **`jsonBase`** — used by the weeWX integration for the history charts and
  wind rose

For embedding the panels into an existing Belchertown page rather than running
the standalone one, see **[weewx/README.md](weewx/README.md)**.

---

## Forecast verification

Optional, and the most interesting thing here if you have a station.

`scripts/verify.py` runs nightly, records what each model forecast and what
your station actually measured, and scores one against the other by lead time.
After a few weeks it can tell you which model is genuinely best *for your
site* — not in general, but for your field, your valley, your patch of coast.

It scores Open-Meteo's blend, UK Met Office, ECMWF, DWD ICON and NOAA GFS
side by side. Full setup in [docs/verification.md](docs/verification.md).

---

## Data sources

- **[Open-Meteo](https://open-meteo.com)** — forecast, ensemble and ERA5
  archive APIs. Free, no key, no registration. Data is CC BY 4.0 and the
  panels display the attribution.
- **ERA5** reanalysis (ECMWF/Copernicus) via the Open-Meteo archive.

Please don't hammer the API. The panels are deliberately lazy — nothing loads
until a tab is opened, and the climatology caches for 24 hours. If you deploy
this somewhere busy, consider Open-Meteo's paid tier.

---

## Licence and dependencies

fenland is MIT licensed — see [LICENSE](LICENSE).

**Highcharts** is loaded from a CDN for the charts. It is free for personal
and non-commercial use, but **commercial use requires a licence from
Highsoft**. If that's a problem for your deployment, the chart calls are
isolated and swapping in ECharts or uPlot (both MIT) is a contained job.

No other dependencies. No build step, no npm, no framework.

---

## Scope

These are panels, not a dashboard. They cover the forecast end of things —
what's coming, how confident to be about it, and how unusual it is against the
long record. They do **not** show live readings, gauges, MQTT feeds or air
quality.

That's a boundary, not a judgement. Live display is what a weeWX skin is for,
and it's what sits on the author's own site: MQTT-fed gauges reading the Davis
loop packet and updating every few seconds, alongside these panels. They were
built to fill the gap between *what is it doing right now* and *what has it
done historically* — neither of which they attempt, because something else was
already doing both well.

So: if you already have a live dashboard, these slot in beside it
([weewx/README.md](weewx/README.md)). If you don't, the standalone page stands
on its own and you can add gauges later.

### On the roadmap

- **Air quality from Open-Meteo's air-quality API** — PM2.5, PM10, ozone and
  European AQI for any coordinates, so it works without an AirGradient or any
  other sensor.
- **A health panel** — flags stale or zero-byte JSON files before you notice
  them as a blank chart. Written after exactly that happened.
