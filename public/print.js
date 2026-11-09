// ════════════════════════════════════════════════════════════════
//  print.js — draws the print of one entry: its path through the tiers this round, as a scribble.
//
//  drawRankPrint(data) → an SVG string (69.5 × 90.16 mm, upright). data comes from GET /api/track:
//    { entry: {title, image}, current: {rank, tier, of}, startedAt, now, tiers[], track[] }
//    track = [{ t, score, tier, rank, pos, of }]  (a point whenever its score or place changed)
//
//  The six tiers are six bands from S (top) to F (bottom), like the ranking screen.
//  There is no time axis: the line starts at the bottom in the middle and then goes up and down
//  to every place the entry had, in order, swinging left and right on the way. The heights are the
//  data; the sideways swings, the wobble and the curls (more where it stayed longer) are noise.
//  One color: the tier the entry is in right now.
// ════════════════════════════════════════════════════════════════
(function () {
  // the format of the reference (print_referenz_2.svg): units of the drawing, 197.01 × 255.58 = 69.5 × 90.16 mm
  const VW = 197.01, VH = 255.58;
  const BOX = { x: 9.72, y: 11.15, w: 175.48, h: 233.28 }; // the six tier bands (each 38.88 high)
  const FRAME = 0.94; // thin outline of the card (to cut along), 0 = none
  const STROKE = 30; // line width
  const OUTLINE = 0.9; // fine dark outline around the line (0 = none)
  const OUTLINE_COLOR = "#181716";
  // the tier colors of the tierlist (the same as the tier chips in feed.html)
  const COLORS = { S: "#ff7f7f", A: "#ffff7f", B: "#7fff7f", C: "#7fffff", D: "#ff7fff", F: "#9b30ff" };
  const INK = "#000";
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const FONT_SIZE = 23.2; // as in the reference (capitals 16.7 high)
  const LEADING = 0.87; // line distance relative to the font size (tight)
  const TRACKING = -0.02; // letter spacing relative to the font size (a bit tighter)
  const TEXT_Y = 0.485; // middle of the text block, relative to the height
  const MAX_STOPS = 14; // at most this many places from the history (more would be one blob)
  const SWING_MIN = 0.35, SWING_MAX = 0.75; // how far the line swings sideways per stop, relative to the width
  const NOISE = 0.1; // how wobbly the line is, relative to one tier band
  const LOOP_EVERY_MS = 20000; // one curl for every 20 s the entry stayed in one place …
  const LOOP_MAX = 2; // … but at most this many at one stop
  const LOOP_R = 0.95; // curl radius, relative to one tier band (bigger than the line, so the hole stays open)
  const STEPS = 18; // points drawn between two stops

  // a small seeded random, so the same entry gets the same scribble on every print
  function seeded(str) {
    let h = 2166136261;
    for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }
  // smooth noise from a few sine waves with random speeds and phases, about -1 … 1
  function wave(rnd) {
    const parts = [1, 2.3, 5.1, 11.7].map((f, i) => ({ f: f * (0.8 + rnd() * 0.4), p: rnd() * 6.283, a: 1 / (i + 1.3) }));
    const sum = parts.reduce((n, w) => n + w.a, 0);
    return (u) => parts.reduce((n, w) => n + w.a * Math.sin(u * 6.283 * w.f + w.p), 0) / sum;
  }
  // a smooth curve through the points (Catmull-Rom)
  function spline(p, steps) {
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], d = p[i + 2] || c;
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t3)));
      }
    }
    out.push(p[p.length - 1]);
    return out;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.drawRankPrint = function (data) {
    const tiers = data.tiers && data.tiers.length ? data.tiers : ["S", "A", "B", "C", "D", "F"].map((id, i) => ({ id, min: [90, 70, 50, 30, 10, 0][i] }));
    const left = BOX.x, top = BOX.y, W = BOX.w, bandH = BOX.h / tiers.length;
    const rnd = seeded(data.entry && data.entry.image);

    // a point → height: the band of its tier, and inside the band its place in that tier's row
    // (so it also moves when others push it); while it was still hovering: by its score
    function yOf(p) {
      let i = tiers.findIndex((t) => (p.tier ? t.id === p.tier : p.score >= t.min));
      if (i < 0) i = tiers.length - 1;
      let f;
      if (Number.isFinite(p.pos) && p.of) f = (p.pos + 1) / (p.of + 1);
      else {
        const max = i === 0 ? 100 : tiers[i - 1].min;
        const min = Math.max(1, tiers[i].min);
        f = (max - p.score) / Math.max(1, max - min);
      }
      return top + (i + Math.max(0.12, Math.min(0.88, f))) * bandH;
    }

    // the stops: every tier it was in, in order (staying in the same tier counts once, with all its time;
    // the height inside the band is where it was when it arrived there)
    const pts = (data.track || []).filter((p) => p && Number.isFinite(p.score)).sort((a, b) => a.t - b.t);
    if (!pts.length) pts.push({ t: data.now || Date.now(), score: 50 });
    const now = Math.max(data.now || Date.now(), pts[pts.length - 1].t);
    let stops = [];
    pts.forEach((p, k) => {
      const y = yOf(p), until = pts[k + 1]?.t ?? now;
      const last = stops[stops.length - 1];
      if (last && last.tier === p.tier) last.stay += until - p.t;
      else stops.push({ y, tier: p.tier, stay: until - p.t });
    });
    if (stops.length > MAX_STOPS) {
      // too many: keep evenly spread ones, always the last (where it is now)
      const keep = [];
      for (let i = 0; i < MAX_STOPS; i++) keep.push(stops[Math.round((i * (stops.length - 1)) / (MAX_STOPS - 1))]);
      stops = keep;
    }

    // the way through the stops: start at the bottom in the middle, then up or down to every stop,
    // each time swinging to the left or the right; a long stay curls around the stop
    const minX = left + STROKE / 2, maxX = left + W - STROKE / 2;
    const minY = top + STROKE * 0.3, maxY = top + BOX.h - STROKE * 0.3;
    const way = [[left + W / 2, maxY]];
    let x = left + W / 2, dir = rnd() < 0.5 ? -1 : 1;
    for (const s of stops) {
      if (rnd() < 0.25) dir = -dir; // now and then it keeps going the same way
      let nx = x + dir * (SWING_MIN + rnd() * (SWING_MAX - SWING_MIN)) * W;
      if (nx < minX || nx > maxX) {
        dir = -dir;
        nx = x + dir * (SWING_MIN + rnd() * (SWING_MAX - SWING_MIN)) * W;
      }
      x = Math.max(minX, Math.min(maxX, nx));
      way.push([x, s.y]);
      const curls = Math.min(LOOP_MAX, Math.floor(s.stay / LOOP_EVERY_MS));
      const turn = rnd() < 0.5 ? -1 : 1;
      for (let c = 0; c < curls; c++) {
        const r = LOOP_R * bandH * (0.7 + rnd() * 0.6);
        const a0 = rnd() * 6.283;
        for (let k = 1; k <= 6; k++) {
          const a = a0 + turn * (k / 6) * 6.283;
          way.push([x + r * Math.cos(a) - r * Math.cos(a0), s.y + r * Math.sin(a) - r * Math.sin(a0)]);
        }
      }
      dir = -dir;
    }

    // smooth it, then let it wobble
    const nx = wave(rnd), ny = wave(rnd);
    const line = spline(way, STEPS).map(([px, py], i, all) => {
      const u = i / all.length;
      return [Math.max(minX, Math.min(maxX, px + nx(u * 6) * bandH * NOISE)),
              Math.max(minY, Math.min(maxY, py + ny(u * 7) * bandH * NOISE))];
    });
    const f = (n) => n.toFixed(2);
    const tierNow = (data.current && data.current.tier) || pts[pts.length - 1].tier || "F";
    const path = `<polyline points="${line.map((p) => f(p[0]) + "," + f(p[1])).join(" ")}"/>`;

    // text, three lines in the middle: the place right now, the name, the tier right now
    const name = String((data.entry && data.entry.title) || "").toUpperCase();
    const cur = data.current;
    const width = (str, size) => str.length * size * (0.64 + TRACKING); // rough width of capitals in Helvetica
    const fit = (str) => Math.min(FONT_SIZE, (VW - 14) / Math.max(1, str.length * (0.64 + TRACKING)));
    let names = [name];
    if (width(name, FONT_SIZE) > VW - 14 && name.includes(" ")) {
      // too long for one line: break it where the two halves are most even
      const words = name.split(" ");
      const diff = (k) => Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length);
      let best = 1;
      for (let k = 2; k < words.length; k++) if (diff(k) < diff(best)) best = k;
      names = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
    }
    const all = [cur ? `#${cur.rank}` : "#–", ...names, cur ? `${cur.tier}-TIER` : "UNRANKED"];
    const fs = Math.min(...names.map(fit));
    const lh = fs * LEADING;
    const y1 = VH * TEXT_Y - ((all.length - 1) * lh) / 2 + fs * 0.36;
    const text = all.map((l, i) => `<text x="${f(VW / 2)}" y="${f(y1 + i * lh)}">${esc(l)}</text>`).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="100%" height="100%">
  <rect x="${FRAME / 2}" y="${FRAME / 2}" width="${VW - FRAME}" height="${VH - FRAME}" fill="#fff"${FRAME ? ` stroke="#181716" stroke-width="${FRAME}"` : ""}/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${OUTLINE ? `<g stroke="${OUTLINE_COLOR}" stroke-width="${STROKE + 2 * OUTLINE}">${path}</g>` : ""}
    <g stroke="${COLORS[tierNow] || INK}" stroke-width="${STROKE}">${path}</g>
  </g>
  <g fill="${INK}" font-family='${FONT}' font-size="${f(fs)}" text-anchor="middle" letter-spacing="${f(TRACKING * fs)}">${text}</g>
</svg>`;
  };
})();
