// ════════════════════════════════════════════════════════════════
//  RANK BRAIN — the central server
//
//  The show has two sequences:
//   1. SEPARATE  every category fills its own screen (students, inventions, konzerne)
//   2. MIX       all screens clear, then the inventions screen fills up with a mix of
//                all three categories; the other screens stay empty
//  In both, new entries hover up and down for a few seconds (up to 3 at once) before
//  they land in a tier, and ranked entries keep drifting up and down.
//
//  Switch sequences automatically (AUTO_MIX_AFTER_MS) or by hand on /admin.html.
//  Every screen and phone receives the same events, so they stay in sync.
//  No dependencies. Start with:  node server.js
// ════════════════════════════════════════════════════════════════

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "rankbrain"; // password for /admin.html — change it on Render!
const PUBLIC = path.join(__dirname, "public");
const IMAGES = path.join(PUBLIC, "images");

// ── Categories: the folder name in public/images/ is the id.
//    names    = write the names on the pictures of the tierlist
//    title    = heading of the tierlist screen, {n} = number of images
//    source   = small line under the tiers (leave "" for none)
//    headline = this category's main feed headline ({W} moved up, {L} moved down)
const CATEGORIES = [
  {
    id: "students",
    label: "Students",
    names: true,
    title: "Ranking {n} Students from VC ZHdK",
    source: "Information sourced from visualcommunication.zhdk.ch and thispersondoesnotexist.com",
    headline: "{W} Is Now Ahead of {L} and the Whole Class Knows It",
  },
  {
    id: "inventions",
    label: "Historic Inventions",
    names: false,
    title: "Ranking {n} Historic Inventions",
    source: "",
    headline: "{W} Just Out-Invented {L} and History Will Never Recover",
  },
  {
    id: "konzerne",
    label: "Konzerne",
    names: false,
    title: "Ranking {n} Konzerne",
    source: "",
    headline: "{W} Overtook {L} and the Shareholders Are Screaming",
  },
];

// ── Sequence 2: everything mixed, shown on the screen of `screen`
const MIX = {
  id: "mix",
  label: "Everything",
  screen: "inventions",
  title: "Ranking {n} Students, Inventions and Konzerne",
  source: "",
  headline: "{W} Just Beat {L}. Yes, We Are Comparing These Now.",
};

// ── Score borders of the tiers ──
const TIERS = [
  { id: "S", min: 90 },
  { id: "A", min: 70 },
  { id: "B", min: 50 },
  { id: "C", min: 30 },
  { id: "D", min: 10 },
  { id: "F", min: -Infinity },
];

// ── Speed ──
const PARALLEL = 1; // how many new entries hover on the right at the same time (1 = one after another)
const NEXT_GAP_MS = 400; // when one lands, the next one starts hovering this soon after
const STAGGER_MS = 1200; // only with PARALLEL > 1: time between the starts of the parallel ones
const HOVER_MIN_MS = 2500; // how long an entry hovers before it lands
const HOVER_MAX_MS = 4500;
// Ranked entries keep moving ("drift"). One tier = 20 score points.
const DRIFT_MAX = 15; // normal step at the start: up to 15 points (mostly within a tier or into the next)
const DRIFT_MIN_MS = 900; // at the start a ranked entry moves every 0.9–1.8 s per list
const DRIFT_MAX_MS = 1800;
const BIG_JUMP_CHANCE = 0.08; // chance that a move is a big jump …
const BIG_JUMP_MAX = 55; // … of up to this many points (= up to 2–3 tiers at once)
const WILDER_AFTER_MS = 120000; // over the first 2 minutes of a sequence the drift gets wilder, up to …
const WILDER_FACTOR = 2.5; // … 2.5× as frequent, 2.5× bigger steps and 2.5× more big jumps (1 = always the same)
const CLEAR_MS = 2500; // how long the screens take to clear between the sequences
const AUTO_MIX_AFTER_MS = 30000; // start the mix this long after all 3 lists are full (null = only by hand)
const RESCAN_MS = 15000; // how often the image folders are checked
const HISTORY = 60; // how many past events a newly opened feed gets

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

// ════════════════ STATE ════════════════
let phase = "separate"; // separate | clearing | mix
let seq = 0;
let autoMixTimer = null;
let autoMixAt = null;
const history = [];
const clients = new Set(); // { res, lite }
const files = {}; // category → [file names]
const lists = {};
for (const c of CATEGORIES) lists[c.id] = newList(c);
lists.mix = newList({ ...MIX, virtual: true });
const allLists = () => Object.values(lists);

function newList(c) {
  return { ...c, items: new Map(), queue: [], hovering: new Map(), active: false, timers: new Set(), starting: 0 };
}

const clamp = (v) => Math.max(1, Math.min(100, Math.round(v)));
const rand = (a, b) => a + Math.random() * (b - a);
const tierOf = (score) => TIERS.find((t) => score >= t.min).id;
const rollScore = () => clamp(Math.random() * 105); // a random landing spot: any tier is possible

// "anna_mueller.jpg" → "Anna Mueller", "IBM.png" stays "IBM", "Hans-Peter_Müller.jpg" → "Hans-Peter Müller"
function titleFromFile(file) {
  let t = file.normalize("NFC").replace(IMG_EXT, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (t === t.toLowerCase()) t = t.replace(/(^|\s)\S/g, (s) => s.toUpperCase());
  return t;
}

// timers that belong to a list, so stopping the list stops everything it does
function later(list, fn, ms) {
  const t = setTimeout(() => {
    list.timers.delete(t);
    if (list.active) fn();
  }, ms);
  list.timers.add(t);
}
function stop(list) {
  list.active = false;
  list.starting = 0;
  list.timers.forEach(clearTimeout);
  list.timers.clear();
}

// ════════════════ PUBLIC VIEWS ════════════════
const brief = (e) => ({ id: e.id, title: e.title, image: e.image, named: e.named });

function ranking(list) {
  return [...list.items.values()]
    .filter((e) => e.ranked)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
function entriesOf(list) {
  return ranking(list).map((e, i) => ({ ...brief(e), score: e.score, tier: tierOf(e.score), rank: i + 1 }));
}
// not ranked and not hovering yet (shown in the "…" row), alphabetical
function poolOf(list) {
  return list.queue
    .map((id) => list.items.get(id))
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(brief);
}
function hoverPublic(list, h) {
  const e = list.items.get(h.id);
  return { entry: brief(e), score: e.score, tier: tierOf(e.score), slot: h.slot, startedAt: h.startedAt, landAt: h.landAt };
}
function neighbours(entries, id) {
  const i = entries.findIndex((x) => x.id === id);
  return { above: entries[i - 1] || null, below: entries[i + 1] || null };
}

function snapshot() {
  return {
    type: "snapshot",
    now: Date.now(),
    seq,
    phase,
    mixScreen: MIX.screen,
    parallel: PARALLEL,
    tiers: TIERS.map((t) => ({ id: t.id, min: Number.isFinite(t.min) ? t.min : 0 })),
    categories: allLists().map((l) => ({
      name: l.id,
      label: l.label,
      title: l.title,
      source: l.source,
      headline: l.headline,
      virtual: !!l.virtual,
      entries: entriesOf(l),
      pool: poolOf(l),
      hovering: [...l.hovering.values()].map((h) => hoverPublic(l, h)),
      waiting: l.queue.length,
    })),
    history,
  };
}

// ════════════════ IMAGE FOLDERS ════════════════
function wantedItems(list) {
  const cats = list.virtual ? CATEGORIES : CATEGORIES.filter((c) => c.id === list.id);
  return cats.flatMap((c) =>
    (files[c.id] || []).map((f) => ({
      id: list.virtual ? `${c.id}/${f}` : f,
      title: titleFromFile(f),
      image: `/images/${c.id}/${encodeURIComponent(f)}`,
      named: !!c.names,
    }))
  );
}

function readFolders() {
  let changed = false;
  for (const c of CATEGORIES) {
    const dir = path.join(IMAGES, c.id);
    let found = [];
    try {
      found = fs.readdirSync(dir).filter((f) => IMG_EXT.test(f) && !f.startsWith(".")).sort();
    } catch {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (found.join("\n") !== (files[c.id] || []).join("\n")) changed = true;
    files[c.id] = found;
  }
  return changed;
}

// images added or removed while a list is running
function sync(list) {
  const want = wantedItems(list);
  const ids = new Set(want.map((w) => w.id));
  let changed = false;
  for (const id of [...list.items.keys()]) {
    if (ids.has(id)) continue;
    list.items.delete(id);
    list.hovering.delete(id);
    changed = true;
  }
  list.queue = list.queue.filter((id) => list.items.has(id));
  for (const w of want) {
    if (list.items.has(w.id)) continue;
    list.items.set(w.id, { ...w, score: 0, ranked: false });
    list.queue.splice(Math.floor(Math.random() * (list.queue.length + 1)), 0, w.id);
    changed = true;
  }
  if (changed) {
    broadcast({ type: "roster", category: list.id, waiting: list.queue.length, entries: entriesOf(list), pool: poolOf(list) });
    if (list.active) fill(list);
  }
}

function rescan() {
  if (readFolders()) allLists().filter((l) => l.active).forEach(sync);
}

// ════════════════ THE RANKING ENGINE ════════════════
// empty tiers, every image waiting
function reset(list) {
  stop(list);
  list.items = new Map(wantedItems(list).map((w) => [w.id, { ...w, score: 0, ranked: false }]));
  list.hovering = new Map();
  list.queue = shuffle([...list.items.keys()]);
}

function start(list) {
  list.active = true;
  list.startedAt = Date.now();
  fill(list, 600);
  later(list, () => drift(list), 1500);
}

// keep the hover track busy: start new entries for every free place on it
function fill(list, first = NEXT_GAP_MS) {
  const free = Math.min(PARALLEL - list.hovering.size - list.starting, list.queue.length - list.starting);
  for (let k = 0; k < free; k++) {
    list.starting++;
    later(list, () => {
      list.starting--;
      if (list.hovering.size < PARALLEL && list.queue.length) hover(list);
    }, first + k * STAGGER_MS);
  }
}

// 1. a new entry hovers up and down for a few seconds …
function hover(list) {
  const id = list.queue.shift();
  const e = list.items.get(id);
  if (!e) return;
  e.score = rollScore();
  const used = new Set([...list.hovering.values()].map((h) => h.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const now = Date.now();
  const h = { id, slot, startedAt: now, landAt: Math.round(now + rand(HOVER_MIN_MS, HOVER_MAX_MS)) };
  list.hovering.set(id, h);
  broadcast({ type: "hover", now, category: list.id, ...hoverPublic(list, h), waiting: list.queue.length });
  later(list, () => land(list, id), h.landAt - now);
}

// … and then lands in its tier
function land(list, id) {
  const e = list.items.get(id);
  if (!list.hovering.delete(id) || !e) return;
  e.ranked = true;
  const entries = entriesOf(list);
  record({
    type: "commit",
    category: list.id,
    label: list.label,
    entry: entries.find((x) => x.id === id),
    ...neighbours(entries, id),
    waiting: list.queue.length,
    entries,
  });
  fill(list);
  checkAutoMix();
}

// 2. ranked entries keep moving, wilder the longer the sequence runs
function wildness(list) {
  return 1 + (WILDER_FACTOR - 1) * Math.min(1, (Date.now() - list.startedAt) / WILDER_AFTER_MS);
}

function drift(list) {
  const w = wildness(list);
  const before = entriesOf(list);
  if (before.length) {
    const was = before[Math.floor(Math.random() * before.length)];
    const e = list.items.get(was.id);
    const big = Math.random() < BIG_JUMP_CHANCE * w;
    const size = big ? 25 + Math.random() * (BIG_JUMP_MAX - 25) : 1 + Math.random() * DRIFT_MAX * w;
    const delta = Math.round(size) * (Math.random() < 0.5 ? -1 : 1);
    e.score = clamp(e.score + delta);
    const after = entriesOf(list);
    const now = after.find((x) => x.id === e.id);
    if (now.score !== was.score) {
      record({
        type: "drift",
        category: list.id,
        label: list.label,
        id: e.id,
        before: was,
        after: now,
        change: now.score - was.score,
        ...neighbours(after, e.id),
        entries: after,
      });
    }
  }
  later(list, () => drift(list), rand(DRIFT_MIN_MS, DRIFT_MAX_MS) / w);
}

// ════════════════ THE TWO SEQUENCES ════════════════
function checkAutoMix() {
  if (phase !== "separate" || autoMixTimer || AUTO_MIX_AFTER_MS == null) return;
  const cats = CATEGORIES.map((c) => lists[c.id]);
  const full = cats.every((l) => !l.queue.length && !l.hovering.size) && cats.some((l) => l.items.size);
  if (!full) return;
  autoMixAt = Date.now() + AUTO_MIX_AFTER_MS;
  autoMixTimer = setTimeout(() => switchTo("mix"), AUTO_MIX_AFTER_MS);
  console.log(`All lists full. Mix starts in ${AUTO_MIX_AFTER_MS / 1000} s.`);
}

const pickTwo = (arr) => shuffle([...arr]).slice(0, 2);

// clear everything fast, then start the next sequence
function switchTo(next) {
  if (phase === "clearing") return false;
  clearTimeout(autoMixTimer);
  autoMixTimer = autoMixAt = null;

  // the feed shows two of the current number 1s as they disappear
  const tops = allLists().filter((l) => l.active).map((l) => ranking(l)[0]).filter(Boolean).map(brief);
  allLists().forEach(stop);
  phase = "clearing";
  record({ type: "phase", phase: "clearing", next, sample: pickTwo(tops) });
  console.log(`Clearing → ${next}`);

  setTimeout(() => {
    phase = next;
    allLists().forEach(reset);
    const run = next === "mix" ? [lists.mix] : CATEGORIES.map((c) => lists[c.id]);
    run.forEach(start);
    broadcast(snapshot());

    // the feed announces the new round, in the mix with a student next to something else
    let sample;
    if (next === "mix") {
      const items = shuffle([...lists.mix.items.values()].map(brief));
      const a = items.find((e) => e.named);
      const b = items.find((e) => !e.named);
      sample = a && b ? [a, b] : items.slice(0, 2);
    } else {
      sample = pickTwo(CATEGORIES.flatMap((c) => [...lists[c.id].items.values()].map(brief)));
    }
    record({ type: "phase", phase: next, sample });
  }, CLEAR_MS);
  return true;
}

// ════════════════ LIVE STREAM (SSE) ════════════════
function record(ev) {
  ev.seq = ++seq;
  ev.t = Date.now();
  const { entries, pool, ...light } = ev; // history stays small: no full lists
  history.push(light);
  while (history.length > HISTORY) history.shift();
  broadcast(ev);
}

// phones ("lite") only get what the feed needs: no full lists, no hover/roster events
function liteVersion(msg) {
  if (msg.type === "hover" || msg.type === "roster") return null;
  if (msg.type === "snapshot") {
    return {
      ...msg,
      categories: msg.categories.map(({ name, label, headline, virtual }) => ({ name, label, headline, virtual })),
    };
  }
  const { entries, pool, ...light } = msg;
  return light;
}

const frame = (msg) => (msg ? `data: ${JSON.stringify(msg)}\n\n` : null);

function broadcast(msg) {
  const full = frame(msg);
  let lite;
  for (const c of clients) {
    if (!c.lite) c.res.write(full);
    else {
      if (lite === undefined) lite = frame(liteVersion(msg));
      if (lite) c.res.write(lite);
    }
  }
}
setInterval(() => broadcast({ type: "ping", now: Date.now() }), 15000);

// ════════════════ HTTP ════════════════
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function status() {
  return {
    phase,
    now: Date.now(),
    autoMixAt,
    lists: allLists().map((l) => ({
      name: l.id,
      label: l.label,
      active: l.active,
      ranked: ranking(l).length,
      hovering: l.hovering.size,
      waiting: l.queue.length,
    })),
  };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // displays may live on other domains
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client = { res, lite: url.searchParams.has("lite") };
    res.write("retry: 2000\n\n");
    const snap = snapshot();
    res.write(frame(client.lite ? liteVersion(snap) : snap));
    clients.add(client);
    req.on("close", () => clients.delete(client));
    return;
  }

  if (url.pathname === "/api/state") return json(res, 200, snapshot());
  if (url.pathname === "/api/status") return json(res, 200, status());

  // admin: POST /api/control  {"key": "...", "action": "mix" | "separate"}
  if (url.pathname === "/api/control" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => {
      body += d;
      if (body.length > 1e4) req.destroy();
    });
    req.on("end", () => {
      let msg = {};
      try {
        msg = JSON.parse(body || "{}");
      } catch {}
      if (msg.key !== ADMIN_KEY) return json(res, 403, { ok: false, error: "wrong password" });
      if (!["mix", "separate"].includes(msg.action)) return json(res, 400, { ok: false, error: "unknown action" });
      if (!switchTo(msg.action)) return json(res, 409, { ok: false, error: "still clearing, try again in a moment" });
      json(res, 200, { ok: true, ...status() });
    });
    return;
  }

  // static files from public/
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": file.startsWith(IMAGES) ? "public, max-age=3600" : "no-cache",
    });
    res.end(data);
  });
});

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ════════════════ START: sequence 1 with empty tiers ════════════════
readFolders();
allLists().forEach(reset);
CATEGORIES.forEach((c) => start(lists[c.id]));
setInterval(rescan, RESCAN_MS);

server.listen(PORT, () => {
  console.log(`Rank brain running on http://localhost:${PORT}`);
  for (const c of CATEGORIES) {
    console.log(`  ${c.label.padEnd(20)} ${String(files[c.id].length).padStart(3)} images  ← public/images/${c.id}/`);
  }
  console.log(`Admin page: http://localhost:${PORT}/admin.html`);
});
