#!/usr/bin/env python3
"""
verify.py — forecast verification for fenland

Every night this records two things:

  1. what the station actually measured today (from weewx.json), and
  2. what the forecast says for the next 10 days (from Open-Meteo).

Over time that builds a record of what was predicted versus what happened, and
the script scores it by lead time: how wrong is the forecast one day ahead,
three days ahead, ten days ahead. The result is uploaded as verification.json
for the FORECAST tab to display.

It answers a question no general forecast page can: not "how good is this
model" in the abstract, but how well it does for your field, your valley, your
particular patch of coast. A fortnight of data starts to answer it; a season
answers it well.

    cp config.example.py config.py   # then edit it
    python3 verify.py                # run once by hand to check it works

    Then once a day, late enough that the day's max and min are settled:

        50 23 * * *  cd /path/to/fenland/scripts && python3 verify.py

Nothing is destroyed if it misses a night — gaps just mean slightly fewer
samples. The local history file is the valuable part: back it up, not the
uploaded JSON, which can always be regenerated.
"""

import os
import time
import json
import ftplib
import datetime as dt

import requests

# ── config ───────────────────────────────────────────────────────────────────
# Everything lives in config.py (copy config.example.py). Environment
# variables of the same name win, which is handy under systemd.
try:
    import config
except ImportError:
    raise SystemExit(
        "No config.py found.\n"
        "    cp config.example.py config.py\n"
        "then edit it with your location, station URL and upload details."
    )


def _cfg(name, default=None):
    return os.environ.get(name, getattr(config, name, default))


LAT = float(_cfg("LAT", 52.6033))
LON = float(_cfg("LON", 0.3822))
TZ = _cfg("TZ", "Europe/London")

WEEWX_JSON_URL = _cfg("WEEWX_JSON_URL")
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

PUBLISH = str(_cfg("PUBLISH", "ftp")).lower()
LOCAL_OUTPUT_DIR = _cfg("LOCAL_OUTPUT_DIR", ".")
FTP_HOST = _cfg("FTP_HOST", "")
FTP_USER = _cfg("FTP_USER", "")
FTP_PASS = _cfg("FTP_PASS", "")
FTP_TLS = str(_cfg("FTP_TLS", "")).lower() in ("1", "true", "yes")
REMOTE_JSON_DIR = _cfg("REMOTE_JSON_DIR", "/public_html/weewx/json")

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "verify_history.json")     # the accumulating record
LOG_FILE = os.path.join(HERE, "verify.log")
OUTPUT = "verification.json"

MAX_LEAD = int(_cfg("MAX_LEAD", 10))
RECENT_DAYS = int(_cfg("RECENT_DAYS", 30))
WET = float(_cfg("WET", 0.2))
MODELS = getattr(config, "MODELS", ["best_match", "ukmo_seamless", "ecmwf_ifs025",
                                    "icon_seamless", "gfs_seamless"])
PRIMARY = getattr(config, "PRIMARY", "best_match")



def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


# ── local store ──────────────────────────────────────────────────────────────
def load_store():
    if os.path.exists(STORE):
        try:
            with open(STORE) as f:
                s = json.load(f)
            s.setdefault("observations", {})
            s.setdefault("forecasts", {})
            return s
        except Exception as e:
            log(f"WARNING: history unreadable ({e}) — starting fresh")
    return {"observations": {}, "forecasts": {}}


def save_store(store):
    """Atomic write — a truncated history file would lose months of samples."""
    tmp = STORE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(store, f)
    os.replace(tmp, STORE)


# ── observations ─────────────────────────────────────────────────────────────
def to_c(value, units):
    """weewx reports whatever it is configured for; normalise to Celsius."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if units and "f" in str(units).strip().lower().replace("°", ""):
        return (v - 32.0) * 5.0 / 9.0
    return v


def to_mph(value, units):
    """weewx may report wind in km/h, m/s, knots or mph depending on how it
    is configured. Normalise, because the whole point of this check is
    comparing like with like over months."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    u = str(units or "").strip().lower().replace(" ", "")
    if u in ("km/h", "kmh", "kph"):
        return v * 0.621371
    if u in ("m/s", "ms", "mps"):
        return v * 2.236936
    if u in ("knot", "knots", "kt", "kts"):
        return v * 1.150779
    return v                      # already mph, or unlabelled


def to_mm(value, units):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    u = str(units or "").strip().lower()
    if u in ("in", "inch", "inches", '"'):
        return v * 25.4
    if u == "cm":
        return v * 10.0
    return v


def fetch_observed():
    """Today's max, min and rain total as measured by the Davis."""
    r = requests.get(WEEWX_JSON_URL + "?cacheburst=" + str(int(time.time())), timeout=20)
    r.raise_for_status()
    try:
        body = r.json()
    except ValueError:
        # a 404 page or a redirect returns HTML, and the bare JSON error
        # ("Expecting value: line 1 column 1") gives no clue which
        raise RuntimeError(f"{WEEWX_JSON_URL} did not return JSON — got "
                           f"{r.headers.get('content-type','?')}, "
                           f"starting {r.text[:60]!r}")
    day = (body or {}).get("day") or {}

    def grab(key, conv):
        o = day.get(key) or {}
        return conv(o.get("value"), o.get("units"))

    return {
        "tmax": grab("max temperature", to_c),
        "tmin": grab("min temperature", to_c),
        "rain": grab("rain total", to_mm),
        "wind": grab("max wind speed", to_mph),
        "gust": grab("max wind gust", to_mph),
    }


# ── forecast ─────────────────────────────────────────────────────────────────
def _by_model(daily, var):
    """Open-Meteo suffixes each key with the model name when several are
    requested (temperature_2m_max_ukmo_seamless), but leaves it bare when only
    one is. Handle both."""
    out = {}
    for m in MODELS:
        key = f"{var}_{m}"
        if key in daily:
            out[m] = daily[key]
    if not out and var in daily and len(MODELS) == 1:
        out[MODELS[0]] = daily[var]
    return out


def fetch_forecast():
    """Returns {date: {model: {tmax, tmin, rain, pop, wind}}}."""
    params = {
        "latitude": f"{LAT:.4f}", "longitude": f"{LON:.4f}",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,"
                 "precipitation_probability_max,wind_speed_10m_max",
        "models": ",".join(MODELS),
        "timezone": TZ, "wind_speed_unit": "mph", "forecast_days": 16,
    }
    r = requests.get(FORECAST_URL, params=params, timeout=45)
    r.raise_for_status()
    d = (r.json() or {}).get("daily") or {}

    cols = {
        "tmax": _by_model(d, "temperature_2m_max"),
        "tmin": _by_model(d, "temperature_2m_min"),
        "rain": _by_model(d, "precipitation_sum"),
        "pop":  _by_model(d, "precipitation_probability_max"),
        "wind": _by_model(d, "wind_speed_10m_max"),
    }

    out = {}
    for i, date in enumerate(d.get("time", [])):
        per_model = {}
        for m in MODELS:
            vals = {}
            for field, series in cols.items():
                arr = series.get(m) or []
                vals[field] = arr[i] if i < len(arr) else None
            # skip models that returned nothing at all for this date
            if any(v is not None for v in vals.values()):
                per_model[m] = vals
        if per_model:
            out[date] = per_model
    return out



# ── anemometer health ─────────────────────
def fetch_reference_wind(start=None, end=None, days=21):
    """The reanalysis view of what the wind actually did, used as a yardstick
    for the station's anemometer.

    ERA5 rather than the forecast API's analysis, deliberately. The backfill
    script needs to reach back months, which only the archive can do — and if
    the two used different sources, the join between backfilled and live rows
    would show up as a step change in the ratio. That is precisely the shape
    this check hunts for, so a methodology artefact would read as a failing
    bearing.

    ERA5 lags about five days. That does not matter for a trend measured in
    months, and the window requested here is wide enough that days fill in as
    they become available.
    """
    if end is None:
        end = dt.date.today()
    if start is None:
        start = end - dt.timedelta(days=days)
    params = {
        "latitude": f"{LAT:.4f}", "longitude": f"{LON:.4f}",
        "daily": "wind_speed_10m_max,wind_gusts_10m_max",
        "timezone": TZ, "wind_speed_unit": "mph",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
    }
    r = requests.get(ARCHIVE_URL, params=params, timeout=60)
    r.raise_for_status()
    d = (r.json() or {}).get("daily") or {}
    spd = d.get("wind_speed_10m_max") or []
    gus = d.get("wind_gusts_10m_max") or []
    out = {}
    for i, date in enumerate(d.get("time", [])):
        w = spd[i] if i < len(spd) else None
        g = gus[i] if i < len(gus) else None
        if w is None and g is None:
            continue                       # not yet published by ERA5
        out[date] = {"wind": w, "gust": g}
    return out


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2.0


def anemometer(store):
    """Watch the station's wind against the model's, and say whether the
    relationship is drifting.

    The absolute ratio means little on its own: a lower mast in a sheltered
    village will always read well under an open-terrain 10m model, and that
    is siting, not a fault. What matters is CHANGE. A bearing that is drying
    out adds friction gradually, so the ratio falls over weeks to months
    while nothing else about the site alters.

    Gust ratio is tracked alongside because a stiffening rotor loses the
    peaks before it loses the mean — but note it cannot catch uniform
    under-reading, where mean and gust fall together and their ratio holds.
    """
    obs = store.get("observations", {})
    ref = store.get("reference", {})
    rows = []
    for date in sorted(obs):
        o, r = obs[date], ref.get(date)
        if not r:
            continue
        if o.get("wind") and r.get("wind"):
            rows.append({
                "date": date,
                "speed": o["wind"] / r["wind"] if r["wind"] else None,
                "gust": (o["gust"] / r["gust"]) if o.get("gust") and r.get("gust") else None,
                "ratio_g2m": (o["gust"] / o["wind"]) if o.get("gust") and o["wind"] else None,
            })

    today = dt.date.today()
    def window(lo, hi):
        a = (today - dt.timedelta(days=hi)).isoformat()
        b = (today - dt.timedelta(days=lo)).isoformat()
        return [x for x in rows if a <= x["date"] <= b]

    recent = window(0, 30)
    baseline = window(31, 120)

    out = {
        "days": len(rows),
        "recent_days": len(recent),
        "speed_ratio_recent": _median([x["speed"] for x in recent]),
        "gust_ratio_recent": _median([x["gust"] for x in recent]),
        "gust_to_mean_recent": _median([x["ratio_g2m"] for x in recent]),
        "speed_ratio_baseline": _median([x["speed"] for x in baseline]),
        "verdict": None,
        "note": None,
    }

    if len(recent) < 14:
        out["verdict"] = "collecting"
        out["note"] = (f"{len(recent)} of 14 days needed before this means anything.")
        return out

    r_now, r_base = out["speed_ratio_recent"], out["speed_ratio_baseline"]
    if r_base and r_now and len(baseline) >= 21:
        drop = 1 - (r_now / r_base)
        out["drop_vs_baseline"] = round(drop, 3)
        if drop >= 0.25:
            out["verdict"] = "check the bearing"
            out["note"] = (f"Reads {drop*100:.0f}% lower against the model than it did "
                           f"a month or more ago. Spin the cups by hand: they should "
                           f"turn freely and coast several seconds to a silent stop.")
        elif drop >= 0.12:
            out["verdict"] = "watch"
            out["note"] = f"Down {drop*100:.0f}% on its own baseline — not conclusive, worth watching."
        else:
            out["verdict"] = "steady"
            out["note"] = "No meaningful drift against the model."
    else:
        out["verdict"] = "steady"
        out["note"] = "Not enough history yet for a trend; no drift visible so far."

    g2m = out["gust_to_mean_recent"]
    if g2m and g2m > 2.6:
        out["note"] = ((out["note"] or "") +
                       f" Gusts are running {g2m:.1f}x the mean, which is high — a stiff "
                       f"rotor loses the average before it loses the peaks.")
    return out


# ── scoring ──────────────────────────────────────────────────────────────────
def _forecast_for(entry, model):
    """Pull one model out of a stored entry, tolerating the original
    single-model format where the fields sat directly on the entry."""
    if not isinstance(entry, dict):
        return None
    if "tmax" in entry or "rain" in entry:          # pre-multi-model records
        return entry if model == PRIMARY else None
    return entry.get(model)


def score(store, since=None, model=PRIMARY):
    """Compare one model's forecasts against the observation for each target.

    Bias is forecast minus observed, so a negative temperature bias means the
    forecast runs cold. MAE ignores sign and shows typical size of error.
    """
    obs = store["observations"]
    leads = {}

    for issue, targets in store["forecasts"].items():
        issue_d = dt.date.fromisoformat(issue)
        for target, entry in targets.items():
            if target not in obs:
                continue
            if since and target < since:
                continue
            fc = _forecast_for(entry, model)
            if not fc:
                continue
            lead = (dt.date.fromisoformat(target) - issue_d).days
            if lead < 1 or lead > MAX_LEAD:
                continue

            o = obs[target]
            b = leads.setdefault(lead, {
                "n": 0, "tmax_e": [], "tmin_e": [], "rain_e": [],
                "hit": 0, "miss": 0, "false_alarm": 0, "correct_dry": 0,
            })
            counted = False
            for key, bucket in (("tmax", "tmax_e"), ("tmin", "tmin_e"), ("rain", "rain_e")):
                if o.get(key) is not None and fc.get(key) is not None:
                    b[bucket].append(fc[key] - o[key])
                    counted = True
            if o.get("rain") is not None and fc.get("rain") is not None:
                f_wet, o_wet = fc["rain"] >= WET, o["rain"] >= WET
                if f_wet and o_wet:
                    b["hit"] += 1
                elif o_wet and not f_wet:
                    b["miss"] += 1
                elif f_wet and not o_wet:
                    b["false_alarm"] += 1
                else:
                    b["correct_dry"] += 1
            if counted:
                b["n"] += 1

    def summarise(b):
        def stats(errs):
            if not errs:
                return None
            return {
                "bias": round(sum(errs) / len(errs), 2),
                "mae": round(sum(abs(e) for e in errs) / len(errs), 2),
                "n": len(errs),
            }
        hits, misses, fa = b["hit"], b["miss"], b["false_alarm"]
        return {
            "n": b["n"],
            "tmax": stats(b["tmax_e"]),
            "tmin": stats(b["tmin_e"]),
            "rain": stats(b["rain_e"]),
            # probability of detection and false alarm ratio, the standard pair
            "pod": round(hits / (hits + misses), 2) if (hits + misses) else None,
            "far": round(fa / (hits + fa), 2) if (hits + fa) else None,
            "wet_days": hits + misses,
        }

    return [dict(lead=k, **summarise(v)) for k, v in sorted(leads.items())]


def scored_dates(store):
    """Dates the forecast verification can actually speak about.

    Not simply every observation: backfill_wind.py adds wind-only rows going
    back months to seed the anemometer check, and counting those as
    verification history would claim a record that does not exist. A day
    counts here only if the nightly run recorded weather for it.
    """
    obs = store.get("observations", {})
    return sorted(d for d, o in obs.items()
                  if o.get("tmax") is not None or o.get("rain") is not None)


def daily_series(store, days=45, model=PRIMARY):
    """Observed vs day-ahead forecast, for the chart."""
    obs = store["observations"]
    out = []
    for target in scored_dates(store)[-days:]:
        issue = (dt.date.fromisoformat(target) - dt.timedelta(days=1)).isoformat()
        entry = (store["forecasts"].get(issue) or {}).get(target)
        fc = _forecast_for(entry, model) or {}
        out.append({
            "date": target,
            "o_tmax": obs[target].get("tmax"),
            "f_tmax": fc.get("tmax"),
            "o_rain": obs[target].get("rain"),
            "f_rain": fc.get("rain"),
        })
    return out


def league(store, since=None, lead=1):
    """One row per model at a given lead time, best first — the answer to
    'which forecast should I actually trust for this field?'"""
    rows = []
    for m in MODELS:
        for L in score(store, since=since, model=m):
            if L["lead"] != lead:
                continue
            rows.append({
                "model": m, "lead": lead, "n": L["n"],
                "tmax_mae": (L["tmax"] or {}).get("mae"),
                "tmax_bias": (L["tmax"] or {}).get("bias"),
                "tmin_mae": (L["tmin"] or {}).get("mae"),
                "rain_mae": (L["rain"] or {}).get("mae"),
                "pod": L["pod"], "far": L["far"],
            })
    rows.sort(key=lambda r: (r["tmax_mae"] is None, r["tmax_mae"]))
    return rows


# ── upload ───────────────────────────────────────────────────────────────────
def publish(payload):
    """Write verification.json where the website can read it.

    Local publishing is a plain atomic rename and is the better option when
    this runs on the web server itself. FTP is for the common case of a
    separate always-on box uploading to shared hosting."""
    if PUBLISH == "local":
        os.makedirs(LOCAL_OUTPUT_DIR, exist_ok=True)
        dest = os.path.join(LOCAL_OUTPUT_DIR, OUTPUT)
        tmp = dest + ".part"
        with open(tmp, "w") as f:
            json.dump(payload, f)
        os.replace(tmp, dest)
        log(f"wrote {dest} ({os.path.getsize(dest):,}B)")
        return True
    return upload(payload)


def upload(payload):
    """Atomic FTP publish — upload to .part, then rename over the live file, so
    a dropped connection can never leave a 0-byte file being served."""
    local = "temp_" + OUTPUT
    with open(local, "w") as f:
        json.dump(payload, f)
    size = os.path.getsize(local)

    ftp = None
    try:
        ftp = (ftplib.FTP_TLS if FTP_TLS else ftplib.FTP)(FTP_HOST, timeout=60)
        ftp.login(FTP_USER, FTP_PASS)
        if FTP_TLS:
            ftp.prot_p()          # encrypt the data channel too
        try:
            ftp.cwd(REMOTE_JSON_DIR)
        except Exception as e:
            log(f"WARNING: could not cd to {REMOTE_JSON_DIR} ({e}); using {ftp.pwd()}")

        with open(local, "rb") as f:
            ftp.storbinary(f"STOR {OUTPUT}.part", f)
        try:
            ftp.rename(OUTPUT + ".part", OUTPUT)
        except ftplib.error_perm:
            try:
                ftp.delete(OUTPUT)
            except ftplib.error_perm:
                pass
            ftp.rename(OUTPUT + ".part", OUTPUT)

        log(f"uploaded {OUTPUT} ({size:,}B)")
        return True
    except Exception as e:
        log(f"FTP FAILED: {e}")
        return False
    finally:
        if os.path.exists(local):
            os.remove(local)
        if ftp is not None:
            try:
                ftp.quit()
            except Exception:
                try:
                    ftp.close()
                except Exception:
                    pass


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    store = load_store()
    today = dt.date.today().isoformat()

    # 1. today's observations
    try:
        o = fetch_observed()
        if any(v is not None for v in o.values()):
            store["observations"][today] = o
            log(f"observed {today}: max {o['tmax']}, min {o['tmin']}, rain {o['rain']}")
        else:
            log("WARNING: weewx.json returned no usable values for today")
    except Exception as e:
        log(f"could not fetch observations: {e}")

    # 2. today's forecast for the days ahead
    try:
        fc = fetch_forecast()
        # keep only future dates — a forecast for today is not a forecast
        store["forecasts"][today] = {d: v for d, v in fc.items() if d > today}
        got = sorted({m for v in store["forecasts"][today].values() for m in v})
        log(f"stored forecast issued {today} for {len(store['forecasts'][today])} days "
            f"from {len(got)} models: {', '.join(got)}")
        missing = [m for m in MODELS if m not in got]
        if missing:
            log(f"WARNING: no data returned for {', '.join(missing)}")
    except Exception as e:
        log(f"could not fetch forecast: {e}")

    # 3. the model's own view of the last few days, as an anemometer yardstick
    try:
        store.setdefault("reference", {}).update(fetch_reference_wind())
        log("stored wind reference for the last few days")
    except Exception as e:
        log(f"could not fetch wind reference: {e}")

    # 4. prune anything older than two years, to keep the file sane
    cutoff = (dt.date.today() - dt.timedelta(days=730)).isoformat()
    store["observations"] = {k: v for k, v in store["observations"].items() if k >= cutoff}
    store["forecasts"] = {k: v for k, v in store["forecasts"].items() if k >= cutoff}
    store["reference"] = {k: v for k, v in store.get("reference", {}).items() if k >= cutoff}
    save_store(store)

    # 5. score and publish
    recent_from = (dt.date.today() - dt.timedelta(days=RECENT_DAYS)).isoformat()
    all_dates = scored_dates(store)
    air = anemometer(store)
    log(f"anemometer: {air['verdict']} — {air['note']}")

    payload = {
        "generated": int(time.time() * 1000),
        "anemometer": air,
        "days_collected": len(all_dates),
        "first_date": all_dates[0] if all_dates else None,
        "last_date": all_dates[-1] if all_dates else None,
        "recent_days": RECENT_DAYS,
        "wet_threshold_mm": WET,
        "models": MODELS,
        "primary": PRIMARY,
        "all_time": score(store),
        "recent": score(store, since=recent_from),
        "series": daily_series(store),
        # per-model scores, so the page can rank them against each other
        "by_model": {m: {"all_time": score(store, model=m),
                         "recent": score(store, since=recent_from, model=m)}
                     for m in MODELS},
        "league_d1": league(store, since=recent_from, lead=1),
        "league_d3": league(store, since=recent_from, lead=3),
    }
    best = payload["league_d1"][0]["model"] if payload["league_d1"] else None
    log(f"scored {payload['days_collected']} days; "
        f"{len(payload['all_time'])} lead times have samples"
        + (f"; best at day 1 so far: {best}" if best else ""))
    publish(payload)


if __name__ == "__main__":
    main()
