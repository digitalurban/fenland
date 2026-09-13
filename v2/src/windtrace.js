/*
   Fenland — Beaufort gauge + tape compass (v2 wind panel)

   Drop-in replacement for the two round dials. Loads AFTER src/dashboard.js
   and changes none of it: the panel markup is swapped at runtime and the
   readings are read back out of the cells dashboard.js has already written,
   so MQTT, the units layer, windScale and the theme all keep working.

   Two graphics:
     gauge — the dial's own Beaufort colour bands unrolled into a strip, with
             the current speed, the gust reach and the hour's peak marked
     tape  — the compass unrolled on a fixed S·W·N·E·S scale

   Sizing — each SVG measures the box it has been given and builds a viewBox
   of exactly that shape, so the drawing is never stretched and never spills.
   The old .compass faces were sized from the row WIDTH by aspect-ratio, ran
   taller than the wind cell allowed, and painted over the readout row.

   Motion — every marker is sprung with the constants dashboard.js uses for
   the needles (stiffness 0.65, damping 1.29), so the panel settles with the
   same weight the dials had.
 */
(function () {
  "use strict";

  var N = 60;                       // samples kept — an hour's worth
  var SAMPLE_MS = 60 * 1000;
  var KEY = "fenland-windtrace-v1";

  /* matched to dashboard.js so gauge, tape and the old needles agree */
  var STIFFNESS = 0.65, DAMPING = 1.29, REST_VEL = 0.04;

  /* the gauge's bands are authored in mph, like buildDialVectors */
  var MPH_TO = { mph: 1, kmh: 1.609344, ms: 0.44704, kn: 0.868976 };

  /* ── buffer ─────────────────────────────────────────────────────────── */

  var buf = [];
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) buf = saved.filter(function (p) {
      return p && typeof p.t === "number" && Date.now() - p.t < 2 * 3600 * 1000;
    }).slice(-N);
  } catch (e) { buf = []; }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(buf)); } catch (e) {} }

  /* Read what dashboard.js has already painted rather than re-parsing the
     feed — unit conversion and wind scaling then live in one place only. */
  function readCells(sfx) {
    var num = function (id) {
      var el = document.getElementById(id + sfx);
      if (!el) return null;
      var v = parseFloat(String(el.textContent).replace(/[^0-9.\-]/g, ""));
      return isNaN(v) ? null : v;
    };
    var s = num("windSpeed");
    if (s === null) return null;
    var g = num("windGust");
    var dirEl = document.getElementById("windDir_text" + sfx);
    var d = null;
    if (dirEl) {
      var m = String(dirEl.textContent).match(/(\d{1,3})\s*°/);
      if (m) d = parseInt(m[1], 10);
    }
    return { t: Date.now(), s: s, g: (g === null ? s : g), d: d };
  }

  /* live values, read every second so the markers move with the feed rather
     than once a minute with the buffer */
  function live() { return readCells("") || readCells("_mob"); }

  function sample() {
    var p = live();
    if (!p) return;
    var last = buf[buf.length - 1];
    if (last && p.t - last.t < SAMPLE_MS * 0.5) buf[buf.length - 1] = p;
    else buf.push(p);
    while (buf.length > N) buf.shift();
    save();
    render();
  }

  /* Published by dashboard.js off the windmax topic — the same figure the
     WIND MAX TODAY tile shows, so the two can never disagree. */
  function dayMax() {
    var v = window.__FENLAND_WINDMAX__;
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : null;
  }

  function hourPeak() {
    var pk = 0;
    buf.forEach(function (p) { pk = Math.max(pk, p.g, p.s); });
    return pk;
  }

  /* ── palette (theme variables, so dark mode follows) ────────────────── */

  var INK = "var(--ink)", SLATE = "var(--slate)", MIST = "var(--mist)",
      FAINT = "var(--faint)", ACCENT = "var(--accent)", LIGHT = "var(--accent-light)",
      RED = "var(--max-marker)", PAPER = "var(--paper)",
      SANS = "var(--sans)", MONO = "var(--mono)";

  function f(n) { return (Math.round(n * 10) / 10).toString(); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function windUnit() { return (typeof U !== "undefined" && U.windUnit) ? U.windUnit : "mph"; }
  function unitKey() {
    var u = String(windUnit()).toLowerCase().replace("/", "");
    return MPH_TO[u] ? u : (u === "kmh" || u === "kph" ? "kmh" : u === "ms" ? "ms" : u === "kts" || u === "kn" ? "kn" : "mph");
  }

  /* ── the spring, lifted from dashboard.js's needle animation ─────────
     One entry per animated node. place() is re-supplied on every call so a
     resize can change the mapping without restarting the motion. */

  var anim = [];
  function spring(node, target, place, jump) {
    if (!node || target === null || isNaN(target)) return;
    var st = null, i;
    for (i = 0; i < anim.length; i++) if (anim[i].el === node) { st = anim[i]; break; }
    if (st && !st.el.isConnected) { if (st.raf) cancelAnimationFrame(st.raf); anim.splice(i, 1); st = null; }

    if (!st) {
      st = { el: node, val: target, velocity: 0, target: target, raf: null, place: place };
      anim.push(st);
      place(target);
      return;
    }
    st.place = place;
    if (jump) {                       // a discontinuity, not a movement
      st.val = target; st.velocity = 0; st.target = target;
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
      place(target);
      return;
    }
    st.target = target;
    if (st.raf) return;

    var lastT = null;
    var stepFn = function (now) {
      if (lastT === null) lastT = now;
      var dt = Math.min((now - lastT) / 1000, 0.04);
      lastT = now;
      var disp = st.val - st.target;
      st.velocity += (-STIFFNESS * disp - DAMPING * st.velocity) * dt;
      st.val += st.velocity * dt;
      if (!st.el.isConnected) { st.raf = null; return; }
      st.place(st.val);
      if (Math.abs(disp) < 0.05 && Math.abs(st.velocity) < REST_VEL) {
        st.val = st.target;
        st.place(st.val);
        st.raf = null;
      } else {
        st.raf = requestAnimationFrame(stepFn);
      }
    };
    st.raf = requestAnimationFrame(stepFn);
  }

  /* ── the Beaufort gauge ─────────────────────────────────────────────── */

  /* thresholds and colours as they are on the dial face today */
  var BANDS = [[0, 2, "#38bdf8"], [2, 5, "#22d3ee"], [4, 8, "#2dd4bf"], [8, 13, "#4ade80"],
               [13, 19, "#a3e635"], [19, 25, "#fde047"], [25, 32, "#fbbf24"], [32, 39, "#f59e0b"],
               [39, 47, "#ea580c"], [47, 60, "#ef4444"]];
  var BEAU = [[0, 0], [1, 1], [2, 4], [3, 8], [4, 13], [5, 19], [6, 25], [7, 32], [8, 39], [9, 47]];

  function gaugeScale() {
    var m = MPH_TO[unitKey()];
    var base = 45 * m;                                   // the everyday range
    var pk = Math.max(hourPeak(), 0);
    if (pk > base * 0.92) base = Math.ceil((pk * 1.12) / (5 * m)) * 5 * m;
    return { max: base, m: m };
  }

  /* The labels live outside the column — B numbers to the left, gust and
     peak to the right — so the column may only have what is left after both
     are reserved, or the text runs off the viewBox. */
  function gaugeFont(k) { return Math.min(13 * k, 64); }   // caps the type in a very narrow box

  /* The column's width follows its own HEIGHT, not the box's width. 150k
     viewBox units is 150 real pixels in any box, so pinning the width to k
     made the tower thin in the tall desktop spine and a thick block in a
     full-width phone column — the same code, two different shapes. Deriving
     it from the height instead holds one aspect ratio everywhere, and the
     desktop spine is already at the 150k ceiling so it does not move. */
  var COL_ASPECT = 5.5;

  function columnBox(k, H) {
    var fs = gaugeFont(k);
    var left = 2.4 * fs + 10 * k;                      // "B8" plus its tick
    var right = 7.6 * fs + 6 * k;                      // "00.0 mph" at 1.5x
    var avail = 960 - left - right;
    var wanted = (H - 56 * k) / COL_ASPECT;            // 56k is Y0 + the bottom margin
    var colW = Math.min(150 * k, Math.max(40 * k, Math.min(avail, wanted)));
    return { colW: colW, cx: left + Math.max(0, (avail - colW) / 2) };
  }

  function gaugeGeom(el) {
    var k = parseFloat(el.dataset.k), H = parseFloat(el.dataset.h), max = parseFloat(el.dataset.max);
    var g = columnBox(k, H);
    var Y0 = 26 * k, Y1 = H - 30 * k;
    return { k: k, H: H, max: max, colW: g.colW, cx: g.cx, Y0: Y0, Y1: Y1,
             y: function (v) { return Y1 - (Y1 - Y0) * Math.max(0, Math.min(v, max)) / max; } };
  }

  /* Vertical, because the wind cell has height to spare and the strip only
     ever used its width: the scale gets the long axis and the Beaufort
     labels get room to sit beside it rather than on top of each other. */
  function gaugeStatic(H, k, max, m) {
    var box = columnBox(k, H), colW = box.colW, cx = box.cx, fs = gaugeFont(k);
    var Y0 = 26 * k, Y1 = H - 30 * k;
    var y = function (v) { return Y1 - (Y1 - Y0) * Math.max(0, Math.min(v, max)) / max; };
    var s = "";

    BANDS.forEach(function (b) {
      var a = b[0] * m, z = Math.min(b[1] * m, max);
      if (a >= max) return;
      s += '<rect x="' + f(cx) + '" y="' + f(y(z)) + '" width="' + f(colW) + '" height="' + f(y(a) - y(z)) +
           '" fill="' + b[2] + '" opacity="0.9"></rect>';
    });
    s += '<rect x="' + f(cx) + '" y="' + f(Y0) + '" width="' + f(colW) + '" height="' + f(Y1 - Y0) +
         '" fill="none" stroke="' + INK + '" stroke-width="' + f(2 * k) + '"></rect>';

    var lastLbl = 1e9;
    BEAU.forEach(function (b) {
      var v = b[1] * m;
      if (v > max) return;
      var py = y(v);
      s += '<line x1="' + f(cx - 8 * k) + '" y1="' + f(py) + '" x2="' + f(cx) + '" y2="' + f(py) +
           '" stroke="' + INK + '" stroke-width="' + f(1.6 * k) + '"></line>';
      if (lastLbl - py < 17 * k) return;              // B0/B1 would collide
      lastLbl = py;
      s += '<text x="' + f(cx - 10 * k) + '" y="' + f(py + fs * 0.36) + '" text-anchor="end" font-family="' + MONO +
           '" font-size="' + f(fs) + '" font-weight="700" fill="' + SLATE + '">B' + b[0] + '</text>';
    });

    var rx = cx + colW + 8 * k;
    s += '<text x="' + f(rx) + '" y="' + f(Y0 + 12 * k) + '" font-family="' + MONO + '" font-size="' + f(fs) +
         '" fill="' + SLATE + '">' + Math.round(max) + '</text>' +
         '<text x="' + f(rx) + '" y="' + f(Y1) + '" font-family="' + MONO + '" font-size="' + f(fs) +
         '" fill="' + SLATE + '">0</text>';

    /* The two maxima — the hour's and the day's — as pointers at the
       column's edge rather than lines across it. A line reads as a threshold
       the colour bands have to be seen through; an arrow reads as a mark on
       a scale, which is what these are, and it is the same language as the
       direction tape's pointer. Filled is the live hour, hollow the day: the
       longer window is the fainter claim. */
    var mk = function (cls, lblCls, fill) {
      return '<g class="' + cls + '" style="display:none">' +
        '<polygon points="' + f(cx + colW + 3 * k) + ',0 ' + f(cx + colW + 17 * k) + ',' + f(-7 * k) +
        ' ' + f(cx + colW + 17 * k) + ',' + f(7 * k) + '" fill="' + fill + '" stroke="' + RED +
        '" stroke-width="' + f(1.6 * k) + '"></polygon>' +
        '<text class="' + lblCls + '" x="' + f(960 - 6 * k) + '" y="' + f(fs * 0.34) +
        '" text-anchor="end" font-family="' + MONO + '" font-size="' + f(fs * 0.92) +
        '" fill="' + RED + '"></text></g>';
    };
    s += mk("wt-daymax", "wt-daymax-lbl", PAPER);
    s += mk("wt-peak", "wt-peak-lbl", RED);
    s += '<g class="wt-needle"><text class="wt-now-lbl" x="' + f(cx + colW + 12 * k) + '" y="' + f(fs * 0.36) +
         '" font-family="' + MONO + '" font-size="' + f(fs * 1.5) + '" font-weight="600" fill="' + INK + '"></text>' +
         '<line x1="' + f(cx) + '" y1="0" x2="' + f(cx + colW) + '" y2="0" stroke="' + PAPER +
         '" stroke-width="' + f(6 * k) + '" opacity="0.75"></line>' +
         '<line x1="' + f(cx) + '" y1="0" x2="' + f(cx + colW) + '" y2="0" stroke="' + INK +
         '" stroke-width="' + f(3 * k) + '"></line><polygon points="' + f(cx - 2 * k) + ',0 ' + f(cx - 17 * k) +
         ',' + f(-8 * k) + ' ' + f(cx - 17 * k) + ',' + f(8 * k) + '" fill="' + INK + '"></polygon></g>';
    return s;
  }

  function paintGauge(el) {
    if (!el) return;
    var m = measure(el);
    if (!m) return;
    var sc = gaugeScale();
    var key = m.H + ":" + f(m.k) + ":" + f(sc.max) + ":" + windUnit();
    if (el.dataset.geom !== key) {
      el.dataset.geom = key;
      el.dataset.k = m.k; el.dataset.h = m.H; el.dataset.max = sc.max;
      el.setAttribute("viewBox", "0 0 960 " + m.H);
      el.innerHTML = gaugeStatic(m.H, m.k, sc.max, sc.m);
      el._wtSpeed = null;
    }
    var g = gaugeGeom(el), p = live();
    if (!p) return;


    var nowLbl = el.querySelector(".wt-now-lbl");
    if (nowLbl) nowLbl.textContent = f(p.s) + " " + windUnit();
    spring(el.querySelector(".wt-needle"), p.s, function (v) {
      el._wtSpeed = v;
      el.querySelector(".wt-needle").style.transform = "translateY(" + g.y(v) + "px)";
    });

    /* Both markers hide rather than sit on top of the needle: a peak equal
       to the current speed is not a peak, it is the reading you can already
       see, and a red arrow claiming otherwise is noise. */
    var fsz = gaugeFont(g.k), placed = [];
    var marker = function (cls, lblCls, value, tag) {
      var grp = el.querySelector("." + cls), lbl = grp && grp.querySelector("." + lblCls);
      if (!grp) return;
      /* Snapshot the markers placed BEFORE this one. Reading the live array
         inside the callback would include this marker's own position, so it
         would find a clash with itself on every frame after the first. */
      var peers = placed.slice();
      var live = value !== null && el._wtSpeed !== null && value > el._wtSpeed + 0.5;
      grp.style.display = live ? "" : "none";
      if (!live) return;
      spring(grp, value, function (v) {
        grp.style.transform = "translateY(" + g.y(v) + "px)";
        if (!lbl) return;
        lbl.textContent = tag + " " + f(value);
        /* The needle's reading is the one that must stay put — it is the
           largest text on the tower — so anything landing on its line, or on
           a marker already placed, steps down instead. */
        var y = g.y(v), off = fsz * 0.34, i;
        var clash = function (other) { return Math.abs(y - other) < fsz * 1.45; };
        if (clash(g.y(el._wtSpeed))) off = fsz * 1.5;
        for (i = 0; i < peers.length; i++) if (clash(peers[i])) off = fsz * 1.5;
        lbl.setAttribute("y", f(off));
      });
      placed.push(g.y(value));
    };

    marker("wt-peak", "wt-peak-lbl", hourPeak(), "1H");
    marker("wt-daymax", "wt-daymax-lbl", dayMax(), "DAY");
  }

  /* ── the tape compass ───────────────────────────────────────────────────
     A FIXED scale, not one centred on the current bearing: centring looks
     static, because the marker never leaves the middle and the scale slides
     instead. Laid out S · W · N · E · S, so the usual south-westerlies sit
     mid-tape and an hour's run never crosses the seam. */

  var LO = 180, HI = 540;
  function norm(d) { var v = ((d % 360) + 360) % 360; return v < LO ? v + 360 : v; }

  function tapeGeom(el) {
    var k = parseFloat(el.dataset.k), H = parseFloat(el.dataset.h);
    var X0 = 8 * k, X1 = 960 - 8 * k;
    return { k: k, H: H, X0: X0, X1: X1,
             bx: function (d) { return X0 + (X1 - X0) * (norm(d) - LO) / (HI - LO); } };
  }

  function tapeStatic(H, k) {
    var W = 960, X0 = 8 * k, X1 = W - 8 * k, fsCard = 16 * k;
    var top = 12 * k, bot = H - fsCard * 1.7;
    var bx = function (d) { return X0 + (X1 - X0) * (norm(d) - LO) / (HI - LO); };

    var s = '<rect x="' + f(X0) + '" y="' + f(top) + '" width="' + f(X1 - X0) + '" height="' + f(bot - top) +
            '" fill="' + PAPER + '" stroke="' + FAINT + '" stroke-width="' + f(1.6 * k) + '"></rect>';
    s += '<rect class="wt-band" x="0" y="' + f(top + 1.6 * k) + '" width="0" height="' + f(bot - top - 3.2 * k) +
         '" fill="' + LIGHT + '"></rect>';

    for (var d = LO; d <= HI; d += 10) {
      var x = bx(d), deg = ((d % 360) + 360) % 360;
      var maj = deg % 45 === 0, mid = deg % 30 === 0;
      var t = maj ? top : mid ? top + (bot - top) * 0.26 : top + (bot - top) * 0.46;
      /* The desktop frame is transform-scaled to fit the viewport, so a tick
         drawn at 1.4 units came out around three-quarters of a CSS pixel on a
         1024-wide iPad — and in MIST, the palette's lightest grey, which
         washed the 10° and 20° ticks out altogether. Heavier weights survive
         the scale, and crispEdges snaps them to the pixel grid rather than
         letting antialiasing spread them below visibility. */
      s += '<line x1="' + f(x) + '" y1="' + f(t) + '" x2="' + f(x) + '" y2="' + f(bot) +
           '" shape-rendering="crispEdges" stroke="' + (maj ? INK : mid ? SLATE : MIST) +
           '" stroke-width="' + f((maj ? 3.4 : mid ? 2.8 : 2.2) * k) + '"></line>';
    }

    var NAMES = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
    for (var dd = LO; dd <= HI; dd += 45) {
      var nm = NAMES[((dd % 360) + 360) % 360];
      if (!nm) continue;
      var lx = Math.min(Math.max(bx(dd), X0 + 14 * k), X1 - 14 * k);
      s += '<text x="' + f(lx) + '" y="' + f(H - 2 * k) + '" text-anchor="middle" font-family="' + SANS +
           '" font-size="' + f(fsCard) + '" font-weight="bold" fill="' + INK + '">' + nm + '</text>';
    }

    s += '<g class="wt-track"></g>';
    /* The pointer alone — a line down the strip reads as a second reading.
       Its tip is pinned to bot, the same line the ticks stand on, so it
       lands exactly on the scale instead of hanging past it. */
    s += '<g class="wt-mark"><polygon points="0,' + f(bot) + ' ' + f(-10 * k) + ',0 ' +
         f(10 * k) + ',0" fill="' + ACCENT + '" stroke="' + INK + '" stroke-width="' +
         f(1.4 * k) + '" stroke-linejoin="miter"></polygon></g>';
    return s;
  }

  function tapeEmpty(H, k) {
    return '<text x="480" y="' + f(H / 2) + '" text-anchor="middle" font-family="' + MONO +
           '" font-size="' + f(15 * k) + '" fill="' + MIST + '">NO DIRECTION IN FEED</text>';
  }

  function tapeData(el) {
    var g = tapeGeom(el), band = el.querySelector(".wt-band"), track = el.querySelector(".wt-track");
    if (!band || !track) return;
    var lo = null, hi = null, dots = "";
    var top = 12 * g.k, bot = g.H - 16 * g.k * 1.7;
    buf.forEach(function (p, idx) {
      if (p.d === null) return;
      var v = norm(p.d);
      lo = (lo === null) ? v : Math.min(lo, v);
      hi = (hi === null) ? v : Math.max(hi, v);
      var t = idx / Math.max(1, buf.length - 1);
      dots += '<circle cx="' + f(g.bx(p.d)) + '" cy="' + f(bot - (bot - top) * 0.12) + '" r="' +
              f((1 + 1.6 * t) * g.k) + '" fill="' + ACCENT + '" opacity="' + (0.15 + 0.6 * t).toFixed(2) + '"></circle>';
    });
    if (lo !== null && hi > lo) {
      band.setAttribute("x", f(g.bx(lo)));
      band.setAttribute("width", f(g.bx(hi) - g.bx(lo)));
    } else band.setAttribute("width", "0");
    track.innerHTML = dots;
  }

  function paintTape(el) {
    if (!el) return;
    var m = measure(el);
    if (!m) return;
    var p = live();
    var bearing = p && p.d !== null ? p.d : null;
    if (bearing === null) for (var i = buf.length - 1; i >= 0; i--) if (buf[i].d !== null) { bearing = buf[i].d; break; }

    var key = m.H + ":" + f(m.k) + ":" + (bearing === null ? "none" : "live");
    if (el.dataset.geom !== key) {
      el.dataset.geom = key;
      el.dataset.k = m.k; el.dataset.h = m.H;
      el.setAttribute("viewBox", "0 0 960 " + m.H);
      el.innerHTML = bearing === null ? tapeEmpty(m.H, m.k) : tapeStatic(m.H, m.k);
    }
    if (bearing === null) return;
    tapeData(el);

    var mark = el.querySelector(".wt-mark"), g = tapeGeom(el);

    /* The spring has to run in the tape's own coordinates, not in raw
       degrees. NE to NW is 90 degrees across north — a short hop on the
       strip — but as raw numbers it is 45 to 315, and interpolating that
       drags the pointer the long way through south and back. So convert to
       tape space first, then pick whichever 360-equivalent of the target
       lies nearest the pointer's current position: that is always the
       shortest visible path.

       Only one move is genuinely impossible to animate — crossing the seam
       at due south, where the strip actually ends. The nearest equivalent
       then falls outside the drawn range, and the pointer jumps from one
       edge to the other instead of sweeping between them. */
    var st = null;
    for (var j = 0; j < anim.length; j++) if (anim[j].el === mark) { st = anim[j]; break; }

    var nb = norm(bearing), target = nb, seam = false;
    if (st) {
      var best = Infinity;
      [nb - 360, nb, nb + 360].forEach(function (c) {
        var d = Math.abs(c - st.val);
        if (d < best) { best = d; target = c; }
      });
      if (target < LO || target > HI) { seam = true; target = nb; }
    }
    spring(mark, target, function (deg) { mark.style.transform = "translateX(" + g.bx(deg) + "px)"; }, seam);
  }

  /* ── panel markup ───────────────────────────────────────────────────── */

  function headHtml(lbl, key) {
    return '<div class="wt-head"><span class="wt-lbl">' + lbl + '</span><span class="wt-key">' + key + '</span></div>';
  }

  function gaugeBlock(sfx) {
    return '<div class="wt-block wt-block-gauge">' +
      headHtml('Wind force · ' + esc(windUnit()), '') +
      '<div class="wt-box"><svg id="wtGauge' + sfx + '" preserveAspectRatio="xMidYMid meet"></svg></div></div>';
  }

  function tapeBlock(sfx) {
    return '<div class="wt-block wt-block-tape">' +
      headHtml('Direction · 60 min', '<span class="wt-sw wt-sw-band"></span>Wander') +
      '<div class="wt-box"><svg id="wtTape' + sfx + '" preserveAspectRatio="xMidYMid meet"></svg></div></div>';
  }

  /* The old .compass nodes are HIDDEN, not removed. dashboard.js rebuilds the
     whole mobile layout whenever #speedSvg_mob is absent and re-points the
     needles by id on every update, so deleting them starts a fight the script
     cannot win. Hidden, every existing code path still finds what it expects. */
  function mount(sfx) {
    var host = document.getElementById("windDials" + sfx);
    if (!host || host.dataset.wt === "1") return false;
    host.dataset.wt = "1";
    host.classList.add("wt-dials");
    var i, kids = host.querySelectorAll(".compass");
    for (i = 0; i < kids.length; i++) kids[i].style.display = "none";
    var holder = document.createElement("div");
    holder.className = "wt-holder";
    /* On desktop the tape has its own full-width row under the tiles, so the
       cell is left to the tower alone. The mobile layout is built by
       dashboard.js and has no such row, so there the two stack as before. */
    /* On desktop both graphics have their own slots — the tower in the
       spine, the tape in its full-width row — so the cell holds neither. The
       mobile layout is built by dashboard.js and has no such slots, so there
       the two stack in the cell as before. */
    var desktop = sfx === "" && document.getElementById("windSpine");
    holder.innerHTML = desktop ? "" : gaugeBlock(sfx) + tapeBlock(sfx);
    host.appendChild(holder);
    return true;
  }

  function mountSpine() {
    var col = document.getElementById("windSpine");
    if (!col || col.dataset.wt === "1") return false;
    col.dataset.wt = "1";
    col.innerHTML = gaugeBlock("") + '<div class="wt-spine-foot"></div>';
    /* The Beaufort description is MOVED, not copied — dashboard.js writes it
       by id on every update, so the node has to stay the same node. */
    var beau = document.getElementById("beaufort");
    if (beau) col.querySelector(".wt-spine-foot").appendChild(beau);
    return true;
  }

  function mountTape() {
    var row = document.getElementById("windTapeFull");
    if (!row || row.dataset.wt === "1") return false;
    row.dataset.wt = "1";
    row.innerHTML = tapeBlock("");
    /* same trick for the bearing: the tape shows where, this says exactly */
    var dir = document.querySelector(".wind-readout-row .dir-cell");
    if (dir) {
      dir.classList.add("wt-dir-inline");
      row.querySelector(".wt-head").insertBefore(dir, row.querySelector(".wt-key"));
    }
    return true;
  }

  function measure(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return null;
    return { k: 960 / r.width, H: Math.round(r.height * (960 / r.width)) };
  }

  function render() {
    ["", "_mob"].forEach(function (sfx) {
      paintGauge(document.getElementById("wtGauge" + sfx));
      paintTape(document.getElementById("wtTape" + sfx));
    });
  }

  /* dashboard.js rebuilds the mobile layout on resize, so re-mount on a timer
     rather than once. The same tick moves the markers, which is why they
     follow the feed rather than the once-a-minute buffer. */
  function tick() {
    var a = mountSpine(), b = mountTape(), c = mount(""), e = mount("_mob");
    if (a || b || c || e) render();
    else ["", "_mob"].forEach(function (sfx) {
      paintGauge(document.getElementById("wtGauge" + sfx));
      paintTape(document.getElementById("wtTape" + sfx));
    });
  }

  function start() {
    tick();
    sample();
    render();
    setInterval(tick, 1000);
    setInterval(sample, SAMPLE_MS);
    var t = null;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(render, 150); });
  }

  /* config.windPanel picks the skin. On "dials" this file does nothing at
     all: css/windtrace.css is not loaded either, so the page keeps the round
     speed dial and compass rose exactly as v1 drew them. */
  if (String(((window.WXCONFIG || {}).windPanel) || "bars").toLowerCase() === "dials") return;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
