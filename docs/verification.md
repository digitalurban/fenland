# Forecast verification

Most weather sites show you a forecast. Almost none tell you whether it was
right. This does.

`scripts/verify.py` runs once a night. It records what your station actually
measured that day, and what five different models are forecasting for the days
ahead. Over time it scores one against the other, by lead time, and works out
which model is genuinely best **for your site** — not in general, but for your
field, your valley, your patch of coast.

That's a question no global verification study can answer for you, because the
answer is different in a frost hollow than on a ridge.

---

## What you need

- A weeWX station publishing `weewx.json` (the Belchertown skin does this)
- Any always-on machine that can run Python once a day — the weeWX Pi itself
  is fine, or a separate box
- Somewhere to put the resulting `verification.json` that your web page can
  read

---

## Setup

```bash
cd fenland/scripts
cp config.example.py config.py
nano config.py
```

Set at minimum:

```python
LAT, LON = 52.6033, 0.3822
WEEWX_JSON_URL = "https://yoursite.example/weewx.json"
PUBLISH = "local"                              # or "ftp"
LOCAL_OUTPUT_DIR = "/var/www/html/weewx/json"  # if local
```

If the script runs on the same machine as your web server, use
`PUBLISH = "local"` — it's simpler and can't fail halfway. Use FTP only when
uploading to shared hosting from elsewhere; set `FTP_TLS = True` if your host
supports it, because plain FTP sends your password in clear text.

Run it once by hand:

```bash
python3 verify.py
```

You should see four lines:

```
[...] observed 2026-08-01: max 28.1, min 12.4, rain 0.0
[...] stored forecast issued 2026-08-01 for 15 days from 5 models: ...
[...] scored 1 days; 0 lead times have samples
[...] wrote /var/www/html/weewx/json/verification.json (291B)
```

"0 lead times have samples" is correct on the first night — it has today's
observations and forecasts for the days ahead, but nothing yet to check them
against. The first real score appears tomorrow.

Then add it to cron, late enough that the day's max and min have settled:

```
50 23 * * * cd /path/to/fenland/scripts && python3 verify.py
```

Finally, point the page at the result in `config.js`:

```js
station: {
  verification: "https://yoursite.example/weewx/json/verification.json"
}
```

---

## Reading the output

**Bias** is forecast minus observed. Negative means the forecast runs cold.
A persistent bias is more useful than a large one is alarming — you can
mentally correct for a model that's reliably 1.5 °C cold, but not for one
that's randomly 1.5 °C out either way.

**MAE** (mean absolute error) is the typical size of the miss regardless of
direction. This is the number to compare models on.

**POD** (probability of detection) is the share of genuinely wet days the
forecast called. **FAR** (false alarm ratio) is the share of forecast rain
that never arrived. A model can score well on temperature and badly on both of
these, which is why they're shown side by side.

**Lead time** is days between issue and target. Error growing steeply with
lead time is normal; how steeply is the interesting part.

---

## How long before it means anything

| After | What you can say |
|---|---|
| 3 days | Nothing. The panel says so. |
| 2 weeks | Day-ahead bias is becoming real |
| 1 month | Bias and MAE by lead time are solid |
| 1 season | The model league table is trustworthy |

Early on the league table can be decided by a single bad afternoon, and the
panel flags this itself while sample counts are low.

---

## Things worth watching for

**A seasonal bias.** Models often run cold on maxima during drought — dry soil
has no moisture left to evaporate, so more of the sun's energy goes into
heating the air than the model assumes. If a cold bias appears during a dry
spell and vanishes when the rain returns, you've measured a real soil-moisture
effect on your own patch.

**A model that wins locally.** High-resolution national models (UKMO at 2 km,
ICON-D2, HRRR) often beat the global ones close in, but not always, and not
everywhere. If one is consistently ahead after a season, switch your forecast
source to it — that's a one-line change in `config.js`.

**Lead-time cliffs.** If error jumps sharply at a particular lead, that's
usually the point where the model switches from a high-resolution run to a
coarser one.

---

## Files

| File | What it is |
|---|---|
| `verify_history.json` | The accumulating record. **This is the valuable one** — back it up. It cannot be regenerated. |
| `verification.json` | The published scores. Derived, disposable. |
| `verify.log` | What happened each night. Check here first if the panel stops updating. |

The history file is pruned to two years and stays small — a few hundred KB
after a year.
