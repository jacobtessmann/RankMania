// ════════════════════════════════════════════════════════════════
//  print.js — draws the sticker of one entry: a round sticker, printed 60 mm across.
//
//  drawRankPrint(data, uid) → an SVG string (square, the sticker is the circle; the page sets the size). data comes from GET /api/track:
//    { entry: {title, image}, current: {rank, tier, of}, startedAt, now, tiers[], track[] }
//    track = [{ t, score, tier, rank, pos, of }]  (a point whenever its score or place changed)
//
//  The six tiers are six rings: F in the middle, S on the outside. The line starts in the middle and
//  goes out and in to every tier the entry was in, in order, turning left or right around the middle
//  on the way. How far out is the data; the turns, the wobble and the curls (more where it stayed
//  longer) are noise. One color: the tier the entry is in right now.
//  In the middle: the letter of the tier right now. Around the edge, upright towards the middle: the name at the
//  top and the bottom, the tier ("S-TIER") left and right. The black circle is the edge of the sticker (60 mm), in the middle
//  of a color band that runs as far over the edge as inside it, so a sticker cut off-centre still has color to the edge.
// ════════════════════════════════════════════════════════════════
(function () {
  // load the font of the middle letter once; window.rankPrintFont resolves when it is there (wait for it before printing)
  const fontUrl = new URL("fonts/porkys.ttf", document.currentScript.src).href;
  const face = new FontFace("Rank Letter", `url("${fontUrl}")`);
  document.fonts.add(face);
  window.rankPrintFont = face.load().catch(() => {});

  const SIZE = 850; // drawing units across the sticker (printed at 60 mm: 1 unit ≈ 0.07 mm; all sizes below scale with it)
  const C = SIZE / 2; // the middle
  const FRAME = 10; // the black circle on the edge of the sticker (exactly 60 mm across, the line is centred on it)
  const BLEED = 34; // the color band on the edge: this wide outside and inside the black circle (about 2.4 mm; the labels are 7 mm apart on the sheet)
  const INNER = 50; // the ring of F starts this far from the middle
  const STROKE = 52; // line width (about 3.7 mm on the 60 mm sticker)
  const OUTLINE = 5; // dark outline around the line (0 = none)
  const OUTLINE_COLOR = "#181716";
  // the tier colors of the tierlist (the same as the tier chips in feed.html)
  const COLORS = { S: "#ff7f7f", A: "#ffff7f", B: "#7fff7f", C: "#7fffff", D: "#ff7fff", F: "#9b30ff" };
  const INK = "#000";
  const FONT = 'Helvetica, "Helvetica Neue", Arial, sans-serif';
  const TRACKING = 0.01; // letter spacing relative to the font size (a bit wider)
  // the tier letter in the middle is in Porky's (fonts/porkys.ttf, next to this script)
  const LETTER_FONT = '"Rank Letter", Helvetica, Arial, sans-serif';
  const MIDDLE_SIZE = 440; // the tier letter in the middle (about half the sticker)
  const LETTER_LINE = 12; // black outline of the letter
  const LETTER_HALO = 10; // white edge around that outline
  const SHADOW = [9, 7], SHADOW_LINE = 7; // a line in the tier color, shifted right and down, behind the letter
  const RING_SIZE = 64; // the text around the edge, always this size
  const TEXT_INSET = BLEED + 18; // its baseline is this far inside the edge, clear of the color band (the letters stand towards the middle)
  const RING_GAP = 14; // at least this much room between name and tier, in degrees
  const LINE_GAP = 16; // room between the line and the text
  const STOP_JUMP = 5; // a jump of this many score points inside one tier is a stop of its own (one tier = 20)
  const MAX_STOPS = 18; // at most this many places from the history (more would be one blob)
  const TURN_MIN = 70, TURN_MAX = 170; // how far the line turns around the middle per stop, in degrees
  const KICK_CHANCE = 0.4, KICK_MIN = 20, KICK_MAX = 45; // now and then the line breaks out to the left or right, in degrees …
  const KICK_OUT = 1.2; // … and up to this far in or out, relative to one tier ring
  const NOISE = 0.6; // how wobbly the line is, relative to one tier ring
  const LOOP_EVERY_MS = 12000; // one curl for every 12 s the entry stayed in one place …
  const LOOP_MAX = 3; // … but at most this many at one stop
  const LOOP_R = 1.5; // curl radius, relative to one tier ring
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
  // the size of a piece of text in drawing units (measured in the browser)
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (t, size, font) => { ctx.font = `${size}px ${font}`; return ctx.measureText(t); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f = (n) => n.toFixed(2);

  // uid: makes the ids inside unique, when several stickers are on one page
  window.drawRankPrint = function (data, uid = "") {
    const tiers = data.tiers && data.tiers.length ? data.tiers : ["S", "A", "B", "C", "D", "F"].map((id, i) => ({ id, min: [90, 70, 50, 30, 10, 0][i] }));
    const rnd = seeded(data.entry && data.entry.image);
    const OUTER = C - TEXT_INSET - RING_SIZE * 0.72 - LINE_GAP - STROKE / 2 - OUTLINE; // the ring of S ends here, so the line never runs into the text
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

    // the stops: every tier it was in and every bigger jump inside a tier, in order (small changes count as
    // one stop, with all their time; the distance inside the ring is where it was when it arrived there)
    const pts = (data.track || []).filter((p) => p && Number.isFinite(p.score)).sort((a, b) => a.t - b.t);
    if (!pts.length) pts.push({ t: data.now || Date.now(), score: 50 });
    const now = Math.max(data.now || Date.now(), pts[pts.length - 1].t);
    let stops = [];
    pts.forEach((p, k) => {
      const until = pts[k + 1]?.t ?? now;
      const last = stops[stops.length - 1];
      if (last && last.tier === p.tier && Math.abs(p.score - last.score) < STOP_JUMP) last.stay += until - p.t;
      else stops.push({ r: radiusOf(p), tier: p.tier, score: p.score, stay: until - p.t });
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
      for (let k = 1; k <= parts; k++) {
        const along = [a + (turn * k) / parts, r + ((s.r - r) * k) / parts];
        if (k < parts && rnd() < KICK_CHANCE) { // a breakout
          along[0] += (rnd() < 0.5 ? -1 : 1) * (KICK_MIN + rnd() * (KICK_MAX - KICK_MIN)) * (Math.PI / 180);
          along[1] += (rnd() * 2 - 1) * KICK_OUT * ringW;
        }
        way.push(xy(along[0], Math.max(0, along[1])));
      }
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

    // the text around the edge, always the same size: the name at the top and the bottom, the tier left and right.
    // The path runs counterclockwise, so the letters stand towards the middle (the name at the top is upside down).
    // A name too long for its half is cut short with "…".
    const cur = data.current;
    const textR = C - TEXT_INSET; // baseline
    const deg = (t) => (360 * (measure(t, RING_SIZE, FONT).width + TRACKING * RING_SIZE * t.length)) / (2 * Math.PI * textR);
    const tier = cur ? `${cur.tier}-TIER` : "UNRANKED";
    const room = 180 - deg(tier) - 2 * RING_GAP;
    let name = String((data.entry && data.entry.title) || "").toUpperCase().trim();
    if (deg(name) > room) {
      while (name && deg(name + "…") > room) name = name.slice(0, -1);
      name = name.trimEnd() + "…";
    }
    // angles clockwise from the top; the path starts in the gap between the name at the top and the tier on the right
    const START = (deg(name) / 2 + 90 - deg(tier) / 2) / 2;
    const pt = (d) => [C + textR * Math.sin((d * Math.PI) / 180), C - textR * Math.cos((d * Math.PI) / 180)];
    const [sx, sy] = pt(START), [ox, oy] = pt(START + 180);
    const circle = `M ${f(sx)},${f(sy)} A ${f(textR)},${f(textR)} 0 1,0 ${f(ox)},${f(oy)} A ${f(textR)},${f(textR)} 0 1,0 ${f(sx)},${f(sy)}`;
    const ringText = [[0, name], [90, tier], [180, name], [270, tier]]
      .map(([d, t]) => `<textPath href="#ring${uid}" startOffset="${f(((((START - d) % 360) + 360) % 360) / 3.6)}%">${esc(t)}</textPath>`).join("");

    // the letter in the middle, centred on its own shape
    const letter = esc(cur ? cur.tier : "?");
    const box = measure(cur ? cur.tier : "?", MIDDLE_SIZE, LETTER_FONT);
    const lx = C - (box.actualBoundingBoxRight - box.actualBoundingBoxLeft) / 2;
    const ly = C + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
    const glyph = (attrs) => `<text x="${f(lx)}" y="${f(ly)}" font-size="${MIDDLE_SIZE}" font-family='${LETTER_FONT}' stroke-linejoin="round" ${attrs}>${letter}</text>`;
    const color = COLORS[tierNow] || INK;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" height="100%" overflow="visible">
  <defs>
    <clipPath id="sticker${uid}"><circle cx="${C}" cy="${C}" r="${C}"/></clipPath>
    <path id="ring${uid}" d="${circle}"/>
  </defs>
  <circle cx="${C}" cy="${C}" r="${C + BLEED}" fill="${color}"/>
  <circle cx="${C}" cy="${C}" r="${C - BLEED}" fill="#fff"/>
  <g clip-path="url(#sticker${uid})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${OUTLINE ? `<g stroke="${OUTLINE_COLOR}" stroke-width="${STROKE + 2 * OUTLINE}">${path}</g>` : ""}
    <g stroke="${color}" stroke-width="${STROKE}">${path}</g>
  </g>
  <g transform="translate(${SHADOW[0]},${SHADOW[1]})">${glyph(`fill="none" stroke="${color}" stroke-width="${SHADOW_LINE}"`)}</g>
  ${glyph(`fill="#fff" stroke="#fff" stroke-width="${LETTER_LINE + 2 * LETTER_HALO}"`)}
  ${glyph(`fill="#fff" stroke="${OUTLINE_COLOR}" stroke-width="${LETTER_LINE}"`)}
  <text fill="${INK}" font-family='${FONT}' font-size="${RING_SIZE}" text-anchor="middle" letter-spacing="${f(TRACKING * RING_SIZE)}">${ringText}</text>
  <circle cx="${C}" cy="${C}" r="${C}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${FRAME}"/>
</svg>`;
  };
})();
