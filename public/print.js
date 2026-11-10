// ════════════════════════════════════════════════════════════════
//  print.js — draws the sticker of one entry: a round sticker, 85 mm across.
//
//  drawRankPrint(data, uid) → an SVG string (85 × 85 mm, the sticker is the circle). data comes from GET /api/track:
//    { entry: {title, image}, current: {rank, tier, of}, startedAt, now, tiers[], track[] }
//    track = [{ t, score, tier, rank, pos, of }]  (a point whenever its score or place changed)
//
//  The six tiers are six rings: F in the middle, S on the outside. The line starts in the middle and
//  goes out and in to every tier the entry was in, in order, turning left or right around the middle
//  on the way. How far out is the data; the turns, the wobble and the curls (more where it stayed
//  longer) are noise. One color: the tier the entry is in right now.
//  In the middle: the letter of the tier right now. Around the edge: place, name and tier, twice, spread evenly around.
// ════════════════════════════════════════════════════════════════
(function () {
  const SIZE = 850; // drawing units: 1 unit = 0.1 mm, so the sticker is 85 mm across
  const C = SIZE / 2; // the middle
  const FRAME = 3.3; // thin outline of the sticker (to cut along), 0 = none
  const TEXT_BAND = 78; // width of the ring with the text around the edge
  const INNER = 70; // the ring of F starts this far from the middle
  const STROKE = 105; // line width (about 10.5 mm)
  const OUTLINE = 3.2; // fine dark outline around the line (0 = none)
  const OUTLINE_COLOR = "#181716";
  // the tier colors of the tierlist (the same as the tier chips in feed.html)
  const COLORS = { S: "#ff7f7f", A: "#ffff7f", B: "#7fff7f", C: "#7fffff", D: "#ff7fff", F: "#9b30ff" };
  const INK = "#000";
  const FONT = 'Helvetica, "Helvetica Neue", Arial, sans-serif';
  const TRACKING = -0.02; // letter spacing relative to the font size (a bit tighter)
  const MIDDLE_SIZE = 380; // the tier letter in the middle (38 mm)
  const RING_SIZE = 66; // the text around the edge, at most (smaller if the name is long)
  const MAX_STOPS = 14; // at most this many places from the history (more would be one blob)
  const TURN_MIN = 50, TURN_MAX = 130; // how far the line turns around the middle per stop, in degrees
  const NOISE = 0.1; // how wobbly the line is, relative to one tier ring
  const LOOP_EVERY_MS = 20000; // one curl for every 20 s the entry stayed in one place …
  const LOOP_MAX = 2; // … but at most this many at one stop
  const LOOP_R = 0.9; // curl radius, relative to one tier ring
  const STEPS = 10; // points drawn between two points of the way

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
  const f = (n) => n.toFixed(2);

  // uid: makes the ids inside unique, when several stickers are on one page
  window.drawRankPrint = function (data, uid = "") {
    const tiers = data.tiers && data.tiers.length ? data.tiers : ["S", "A", "B", "C", "D", "F"].map((id, i) => ({ id, min: [90, 70, 50, 30, 10, 0][i] }));
    const rnd = seeded(data.entry && data.entry.image);
    const OUTER = C - TEXT_BAND - STROKE / 2; // the ring of S ends here, so the line never runs into the text ring
    const ringW = (OUTER - INNER) / tiers.length;

    // a point → distance from the middle: the ring of its tier (F inside, S outside), and inside the ring
    // its place in that tier's row (first = further out); while it was still hovering: by its score
    function radiusOf(p) {
      let i = tiers.findIndex((t) => (p.tier ? t.id === p.tier : p.score >= t.min));
      if (i < 0) i = tiers.length - 1;
      let fr; // 0 = best place in the tier, 1 = worst
      if (Number.isFinite(p.pos) && p.of) fr = (p.pos + 1) / (p.of + 1);
      else {
        const max = i === 0 ? 100 : tiers[i - 1].min;
        const min = Math.max(1, tiers[i].min);
        fr = (max - p.score) / Math.max(1, max - min);
      }
      const level = tiers.length - 1 - i + (1 - Math.max(0.12, Math.min(0.88, fr))); // 0 … 6, from the middle out
      return INNER + level * ringW;
    }

    // the stops: every tier it was in, in order (staying in the same tier counts once, with all its time;
    // the distance inside the ring is where it was when it arrived there)
    const pts = (data.track || []).filter((p) => p && Number.isFinite(p.score)).sort((a, b) => a.t - b.t);
    if (!pts.length) pts.push({ t: data.now || Date.now(), score: 50 });
    const now = Math.max(data.now || Date.now(), pts[pts.length - 1].t);
    let stops = [];
    pts.forEach((p, k) => {
      const until = pts[k + 1]?.t ?? now;
      const last = stops[stops.length - 1];
      if (last && last.tier === p.tier) last.stay += until - p.t;
      else stops.push({ r: radiusOf(p), tier: p.tier, stay: until - p.t });
    });
    if (stops.length > MAX_STOPS) {
      // too many: keep evenly spread ones, always the last (where it is now)
      const keep = [];
      for (let i = 0; i < MAX_STOPS; i++) keep.push(stops[Math.round((i * (stops.length - 1)) / (MAX_STOPS - 1))]);
      stops = keep;
    }

    // the way: start in the middle, then out or in to every stop, each time turning left or right around
    // the middle (in small steps, so the line follows the circle); a long stay curls around the stop
    const xy = (a, r) => [C + r * Math.cos(a), C + r * Math.sin(a)];
    let a = rnd() * 2 * Math.PI, r = 0;
    const way = [xy(a, 0)];
    for (const s of stops) {
      const turn = (rnd() < 0.5 ? -1 : 1) * (TURN_MIN + rnd() * (TURN_MAX - TURN_MIN)) * (Math.PI / 180);
      const parts = 4;
      for (let k = 1; k <= parts; k++) way.push(xy(a + (turn * k) / parts, r + ((s.r - r) * k) / parts));
      a += turn;
      r = s.r;
      const [x, y] = xy(a, r);
      const curls = Math.min(LOOP_MAX, Math.floor(s.stay / LOOP_EVERY_MS));
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let c = 0; c < curls; c++) {
        const lr = LOOP_R * ringW * (0.7 + rnd() * 0.6);
        const a0 = rnd() * 6.283;
        for (let k = 1; k <= 6; k++) {
          const b = a0 + dir * (k / 6) * 6.283;
          way.push([x + lr * Math.cos(b) - lr * Math.cos(a0), y + lr * Math.sin(b) - lr * Math.sin(a0)]);
        }
      }
    }

    // smooth it, then let it wobble; it stays inside the rings
    const nx = wave(rnd), ny = wave(rnd);
    const maxR = OUTER;
    const line = spline(way, STEPS).map(([px, py], i, all) => {
      const u = i / all.length;
      let x = px + nx(u * 6) * ringW * NOISE, y = py + ny(u * 7) * ringW * NOISE;
      const d = Math.hypot(x - C, y - C);
      if (d > maxR) [x, y] = [C + ((x - C) * maxR) / d, C + ((y - C) * maxR) / d];
      return [x, y];
    });
    const tierNow = (data.current && data.current.tier) || pts[pts.length - 1].tier || "F";
    const path = `<polyline points="${line.map((p) => f(p[0]) + "," + f(p[1])).join(" ")}"/>`;

    // the text around the edge: place, name, tier — twice, six pieces spread evenly around the circle
    const cur = data.current;
    const name = String((data.entry && data.entry.title) || "").toUpperCase();
    const pieces = [cur ? `#${cur.rank}` : "#–", name, cur ? `${cur.tier}-TIER` : "UNRANKED"];
    const textR = C - TEXT_BAND / 2 - RING_SIZE * 0.36; // baseline, so the capitals sit in the middle of the band
    const slot = (2 * Math.PI * textR) / 6; // the room for one piece
    const longest = Math.max(...pieces.map((t) => t.length));
    const ringSize = Math.min(RING_SIZE, (slot * 0.9) / (longest * (0.64 + TRACKING)));
    // six pieces clockwise, the name always at the top in the middle: # at -60°, name at 0°, tier at 60°, and again
    // opposite. The circle path starts at 150° (between two pieces), so no piece is cut where it begins.
    const START = 150;
    const pt = (deg) => [C + textR * Math.sin((deg * Math.PI) / 180), C - textR * Math.cos((deg * Math.PI) / 180)];
    const [sx, sy] = pt(START), [ox, oy] = pt(START + 180);
    const circle = `M ${f(sx)},${f(sy)} A ${f(textR)},${f(textR)} 0 1,1 ${f(ox)},${f(oy)} A ${f(textR)},${f(textR)} 0 1,1 ${f(sx)},${f(sy)}`;
    const ringText = [[-60, pieces[0]], [0, pieces[1]], [60, pieces[2]], [120, pieces[0]], [180, pieces[1]], [240, pieces[2]]]
      .map(([deg, t]) => `<textPath href="#ring${uid}" startOffset="${f(((((deg - START) % 360) + 360) % 360) / 3.6)}%">${esc(t)}</textPath>`).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" height="100%">
  <defs>
    <clipPath id="sticker${uid}"><circle cx="${C}" cy="${C}" r="${C}"/></clipPath>
    <path id="ring${uid}" d="${circle}"/>
  </defs>
  <circle cx="${C}" cy="${C}" r="${f(C - FRAME / 2)}" fill="#fff"${FRAME ? ` stroke="#181716" stroke-width="${FRAME}"` : ""}/>
  <g clip-path="url(#sticker${uid})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${OUTLINE ? `<g stroke="${OUTLINE_COLOR}" stroke-width="${STROKE + 2 * OUTLINE}">${path}</g>` : ""}
    <g stroke="${COLORS[tierNow] || INK}" stroke-width="${STROKE}">${path}</g>
  </g>
  <g fill="${INK}" font-family='${FONT}'>
    <text x="${C}" y="${f(C + MIDDLE_SIZE * 0.36)}" font-size="${MIDDLE_SIZE}" text-anchor="middle">${esc(cur ? cur.tier : "?")}</text>
    <text font-size="${f(ringSize)}" text-anchor="middle" letter-spacing="${f(TRACKING * ringSize)}">${ringText}</text>
  </g>
</svg>`;
  };
})();
