#!/usr/bin/env python3
"""
Backfill the anemometer health history from data you already have.

The nightly verification run records the station's daily maximum wind and
gust alongside the reanalysis figure for the same day, and watches the ratio
between them for the slow decline that means a bearing is drying out. Started
from scratch that needs a fortnight before it says anything and a couple of
months before it can see a trend.

But the history already exists. Belchertown's year.json holds a daily maximum
wind and gust for every day of the year, and ERA5 covers the same dates. This
script joins the two and writes them into the verification store, so the check
starts with real months behind it instead of nothing.

Two details make the join safe, and both were checked rather than assumed:

  * year.json's windSpeed and windGust carry no aggregate_type, so they are
    daily MAXIMA — the same statistic the live run takes from weewx.json's
    "max wind speed". windDir, by contrast, declares aggregate_type "avg".
  * Their yAxis_label reads "Wind Speed (mph)", so they are already mph, the
    same unit the archive is asked for.

If either of those is not true of your own Belchertown output the script will
say so and stop, rather than quietly poisoning the baseline.

Usage:
    python3 backfill_wind.py --dry-run      # show what it would do
    python3 backfill_wind.py                # do it, after taking a backup

Existing values are never overwritten. Re-running is safe.
"""

import argparse
import datetime as dt
import json
import os
import shutil
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    import config
except ImportError:
    config = None


def _cfg(name, default=None):
    return getattr(config, name, os.environ.get(name, default)) if config \
        else os.environ.get(name, default)


LAT = float(_cfg("LAT", 52.6033))
LON = float(_cfg("LON", 0.3822))
TZ = _cfg("TZ", "Europe/London")
STORE = os.path.join(HERE, _cfg("STORE_FILE", "verify_history.json"))
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Where the daily station history lives. Override in config.py if your
# Belchertown JSON sits elsewhere.
YEAR_JSON = _cfg("YEAR_JSON_URL", "https://finchamweather.co.uk/json/year.json")


def log(msg):
    print(msg, flush=True)


def station_daily():
    """Daily max wind and gust from Belchertown's year.json, as {date: {...}}."""
    log("reading %s" % YEAR_JSON)
    r = requests.get(YEAR_JSON, timeout=60)
    r.raise_for_status()
    j = r.json()

    chart = None
    for key, val in j.items():
        if isinstance(val, dict) and isinstance(val.get("series"), dict) \
                and "windSpeed" in val["series"]:
            chart = val["series"]
            break
    if not chart:
        sys.exit("could not find a windSpeed series in that file")

    # verify the two assumptions this whole exercise rests on
    for name in ("windSpeed", "windGust"):
        s = chart.get(name)
        if not s:
            sys.exit("%s missing from the chart series" % name)
        agg = s.get("aggregate_type")
        if agg and agg != "max":
            sys.exit("%s is aggregated as '%s', not max — the live run records "
                     "daily maxima, so these would not be comparable" % (name, agg))
        label = str(s.get("yAxis_label", ""))
        if "mph" not in label.lower():
            sys.exit("%s is labelled '%s' — this script expects mph, which is "
                     "what the archive is queried in. Convert first, or the "
                     "baseline will be wrong." % (name, label))

    out = {}
    for name, key in (("windSpeed", "wind"), ("windGust", "gust")):
        for point in chart[name]["data"]:
            if not point or point[1] is None:
                continue
            date = dt.datetime.utcfromtimestamp(point[0] / 1000).date().isoformat()
            out.setdefault(date, {})[key] = float(point[1])
    return out


def archive_daily(start, end):
    """ERA5 daily max wind and gust, in mph, as {date: {...}}."""
    log("fetching ERA5 reference %s to %s" % (start, end))
    params = {
        "latitude": "%.4f" % LAT, "longitude": "%.4f" % LON,
        "daily": "wind_speed_10m_max,wind_gusts_10m_max",
        "timezone": TZ, "wind_speed_unit": "mph",
        "start_date": start, "end_date": end,
    }
    r = requests.get(ARCHIVE_URL, params=params, timeout=90)
    r.raise_for_status()
    d = (r.json() or {}).get("daily") or {}
    spd, gus = d.get("wind_speed_10m_max") or [], d.get("wind_gusts_10m_max") or []
    out = {}
    for i, date in enumerate(d.get("time", [])):
        w = spd[i] if i < len(spd) else None
        g = gus[i] if i < len(gus) else None
        if w is None and g is None:
            continue
        out[date] = {"wind": w, "gust": g}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change and write nothing")
    args = ap.parse_args()

    st = station_daily()
    if not st:
        sys.exit("no station wind data found")
    dates = sorted(st)
    log("station: %d days, %s to %s" % (len(dates), dates[0], dates[-1]))

    ref = archive_daily(dates[0], dates[-1])
    log("archive: %d days returned" % len(ref))

    store = {"observations": {}, "forecasts": {}, "reference": {}}
    if os.path.exists(STORE):
        with open(STORE) as f:
            store = json.load(f)
        store.setdefault("observations", {})
        store.setdefault("forecasts", {})
        store.setdefault("reference", {})
        log("existing store: %d observations, %d reference days"
            % (len(store["observations"]), len(store["reference"])))
    else:
        log("no existing store — creating one")

    added_obs = added_ref = skipped = 0
    for date in dates:
        if date not in ref:
            continue                      # no reanalysis for that day
        o = store["observations"].setdefault(date, {})
        # never overwrite anything already recorded
        wrote = False
        for key in ("wind", "gust"):
            if key in st[date] and o.get(key) is None:
                o[key] = round(st[date][key], 2)
                wrote = True
        if wrote:
            added_obs += 1
        elif date in store["reference"]:
            skipped += 1
        if date not in store["reference"]:
            store["reference"][date] = {k: (round(v, 2) if v is not None else None)
                                        for k, v in ref[date].items()}
            added_ref += 1

    usable = sum(1 for d in store["observations"]
                 if store["observations"][d].get("wind") and store["reference"].get(d, {}).get("wind"))

    log("")
    log("  observation days gaining wind : %d" % added_obs)
    log("  reference days added          : %d" % added_ref)
    log("  already present, left alone   : %d" % skipped)
    log("  usable comparison days after  : %d" % usable)

    if args.dry_run:
        log("\ndry run — nothing written")
        return

    if os.path.exists(STORE):
        backup = STORE + ".before-backfill"
        shutil.copy2(STORE, backup)
        log("\nbacked up existing store to %s" % os.path.basename(backup))

    tmp = STORE + ".part"
    with open(tmp, "w") as f:
        json.dump(store, f)
    os.replace(tmp, STORE)
    log("written to %s" % os.path.basename(STORE))
    log("\nRun verify.py next; the anemometer line should now report a verdict "
        "rather than 'collecting'.")


if __name__ == "__main__":
    main()
