// ════════════════════════════════════════════════════════════════
//  print.js — draws the print of one entry: its path through the tiers this round.
//
//  drawRankPrint(data) → an SVG string (69.5 × 90.16 mm, upright). data comes from GET /api/track:
//    { entry: {title, image}, current: {rank, tier, of}, startedAt, now, tiers[], track[] }
//    track = [{ t, score, tier, rank }]  (a point whenever its score or place changed)
//
//  The six tiers are six bands from S (top) to F (bottom), like the ranking screen.
//  Time runs from left (when the entry came in) to right (the moment of printing).
//  The line is noisy on purpose; the longer it stayed somewhere, the more it curls there.
// ════════════════════════════════════════════════════════════════
(function () {
  // the format of the reference (print_referenz_2.svg): units of the drawing, 197.01 × 255.58 = 69.5 × 90.16 mm
  const VW = 197.01, VH = 255.58;
  const BOX = { x: 9.72, y: 11.15, w: 175.48, h: 233.28 }; // the six tier bands (each 38.88 high)
  const FRAME = 0.94; // thin outline of the card (to cut along), 0 = none
  const STROKE = 17; // line width
  const COLORS = { S: "#ff3b3b", A: "#ffc400", B: "#22d34a", C: "#14c4e8", D: "#ff4fd8", F: "#8c3cff" };
  const INK = "#000";
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const FONT_SIZE = 23.2; // as in the reference (capitals 16.7 high)
  const LEADING = 0.87; // line distance relative to the font size (tight)
  const TRACKING = -0.02; // letter spacing relative to the font size (a bit tighter)
  const TEXT_Y = 0.485; // middle of the text block, relative to the height
  const SAMPLES = 1400; // points along the line
  const NOISE = 0.09; // how wobbly the line is, relative to one tier band
  const MOVE_MS = 0.03; // a move takes this part of the whole width
  const LOOP_EVERY_MS = 20000; // one curl for every 20 s the entry stayed in one place
  const LOOP_R = 0.17; // curl radius, relative to one tier band

  // a small seeded random, so the same entry gets the same wobble on every print
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
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
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

    const pts = (data.track || []).filter((p) => p && Number.isFinite(p.score)).sort((a, b) => a.t - b.t);
    if (!pts.length) pts.push({ t: data.now || Date.now(), score: 50 });
    const t0 = pts[0].t;
    const t1 = Math.max(data.now || Date.now(), pts[pts.length - 1].t + 1);
    const span = t1 - t0;
    const X = (t) => left + ((t - t0) / span) * W;

    // the changes: each one eases from the old height to the new one around its moment
    const changes = [];
    for (let k = 1; k < pts.length; k++) {
      const d = yOf(pts[k]) - yOf(pts[k - 1]);
      if (Math.abs(d) > 0.01) changes.push({ t: pts[k].t, d });
    }
    changes.forEach((c, k) => {
      const gap = Math.min(c.t - (changes[k - 1]?.t ?? t0), (changes[k + 1]?.t ?? t1) - c.t);
      c.len = Math.max(span * 0.004, Math.min(span * MOVE_MS, gap));
    });
    const y0 = yOf(pts[0]);
    const baseY = (t) => changes.reduce((y, c) => y + c.d * smooth((t - c.t) / c.len + 0.5), y0);

    // the curls: in every stretch without a move, one curl per LOOP_EVERY_MS
    const R = LOOP_R * bandH;
    const loopW = 2 * Math.PI * R * 0.62; // narrower than the curl, so it really turns back
    const loops = [];
    const stops = [t0, ...changes.map((c) => c.t), t1];
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k] + (changes[k - 1]?.len || 0), b = stops[k + 1] - (changes[k]?.len || 0);
      const px = X(b) - X(a);
      const n = Math.min(Math.floor((b - a) / LOOP_EVERY_MS), Math.floor(px / (loopW * 1.5)));
      for (let j = 0; j < n; j++) {
        const at = a + ((j + 0.5 + (rnd() - 0.5) * 0.4) / n) * (b - a);
        loops.push({ x: X(at), dir: rnd() < 0.5 ? -1 : 1, r: R * (0.75 + rnd() * 0.5) });
      }
    }

    const nx = wave(rnd), ny = wave(rnd);
    const line = [];
    for (let s = 0; s <= SAMPLES; s++) {
      const u = s / SAMPLES;
      const t = t0 + u * span;
      let x = left + u * W + nx(u * 3) * bandH * NOISE * 0.5;
      let y = baseY(t) + ny(u * 4) * bandH * NOISE;
      for (const L of loops) {
        const v = (left + u * W - L.x) / loopW + 0.5;
        if (v <= 0 || v >= 1) continue;
        x -= L.r * Math.sin(2 * Math.PI * v);
        y += L.dir * L.r * (1 - Math.cos(2 * Math.PI * v));
      }
      line.push([Math.max(left, Math.min(left + W, x)), Math.max(top, Math.min(top + BOX.h, y))]);
    }

    // one color per tier: split the line where it crosses into another band
    const bandOf = (y) => tiers[Math.max(0, Math.min(tiers.length - 1, Math.floor((y - top) / bandH)))].id;
    const runs = [];
    for (const p of line) {
      const id = bandOf(p[1]);
      const last = runs[runs.length - 1];
      if (last && last.id === id) last.pts.push(p);
      else {
        if (last) last.pts.push(p); // overlap one point so the pieces connect
        runs.push({ id, pts: [p] });
      }
    }
    const f = (n) => n.toFixed(2);
    const paths = runs.map((r) =>
      `<polyline points="${r.pts.map((p) => f(p[0]) + "," + f(p[1])).join(" ")}" stroke="${COLORS[r.id] || INK}"/>`).join("");

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
  <g fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
  <g fill="${INK}" font-family='${FONT}' font-size="${f(fs)}" text-anchor="middle" letter-spacing="${f(TRACKING * fs)}">${text}</g>
</svg>`;
  };
})();
