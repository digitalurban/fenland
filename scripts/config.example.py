# ═══════════════════════════════════════════════════════════════════════════
# fenland — verification script configuration
#
#   cp config.example.py config.py     and edit config.py
#
# config.py is listed in .gitignore. Never commit it: once a password is in
# git history it is there permanently, even if you delete it in a later
# commit. If you think you have committed one, rotate it rather than trying
# to rewrite history.
#
# Every value can also be supplied as an environment variable of the same
# name, which is tidier if you run this under systemd:
#
#   Environment="FTP_PASS=..."
# ═══════════════════════════════════════════════════════════════════════════

# ── your location ──────────────────────────────────────────────────────────
LAT = 52.6033
LON = 0.3822
TZ = "Europe/London"

# ── your station ───────────────────────────────────────────────────────────
# weewx.json as published by the Belchertown skin. The script reads the day's
# max, min and rain total from it to score the forecast against.
WEEWX_JSON_URL = "https://example.com/weewx.json"

# ── publishing ─────────────────────────────────────────────────────────────
# Where to put verification.json so the web page can read it.
#
# Set PUBLISH = "local" to write straight to a directory (use this if the
# script runs on the same box as the web server — simpler and safer than FTP).
PUBLISH = "ftp"                  # "ftp" or "local"

# only used when PUBLISH = "local"
LOCAL_OUTPUT_DIR = "/var/www/html/weewx/json"

# only used when PUBLISH = "ftp"
FTP_HOST = "ftp.example.com"
FTP_USER = "you@example.com"
FTP_PASS = "change-me"
FTP_TLS = False                  # True if your host supports FTPS. Prefer it:
                                 # plain FTP sends your password in clear text.
REMOTE_JSON_DIR = "/public_html/weewx/json"

# ── which models to score ──────────────────────────────────────────────────
# Each is checked against your station separately, so the page can tell you
# which forecast is actually best where you live.
#   best_match      Open-Meteo's blend of whatever is best for the location
#   ukmo_seamless   UK Met Office
#   ecmwf_ifs025    ECMWF
#   icon_seamless   DWD ICON
#   gfs_seamless    NOAA GFS
#   meteofrance_seamless
MODELS = ["best_match", "ukmo_seamless", "ecmwf_ifs025", "icon_seamless", "gfs_seamless"]
PRIMARY = "best_match"           # the one your web page displays

# ── scoring ────────────────────────────────────────────────────────────────
MAX_LEAD = 10                    # days ahead to score
RECENT_DAYS = 30                 # window for the "lately" figures
WET = 0.2                        # mm, the threshold for "it rained"
