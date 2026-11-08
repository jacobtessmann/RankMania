// ════════════════════════════════════════════════════════════════
//  RANKMANIA — the central server
//
//  The show has two sequences:
//   1. SEPARATE  every category fills its own screen (students, inventions, konzerne)
//   2. MIX       all screens clear, then every image of all three categories is dealt
//                to one of the three screens at random, so each screen shows a mix
//  In both, each screen does one thing at a time: a new entry hovers in and lands, or one
//  ranked entry moves up or down. After every action there is a pause.
//
//  The mix starts by hand on /admin.html (or automatically if AUTO_MIX_AFTER_MS is set).
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
    title: "Ranking {n} Students of VisCom",
    source: "data sourced from visualcommunication.zhdk.ch and thispersondoesnotexist.com",
    headline: "{W} Is Now Ahead of {L} and the Whole Class Knows It",
  },
  {
    id: "inventions",
    label: "Historic Inventions",
    names: true,
    title: "Ranking {n} Historic Inventions",
    source: "",
    headline: "{W} Just Out-Invented {L} and History Will Never Recover",
  },
  {
    id: "konzerne",
    label: "Konzerne",
    names: true,
    title: "Ranking {n} Konzerne",
    source: "",
    headline: "{W} Overtook {L} and the Shareholders Are Screaming",
  },
];

// ── How many images each screen ranks per round. Each round picks them at random from the folder
//    (e.g. 20 out of ~45), so every round has a different line-up. 0 = all images.
//    In the mix, each screen gets this many, drawn evenly from all three folders.
const ENTRIES_PER_SCREEN = 20;

// ── Headlines on top of the screens. Edited live on /admin.html (one list per mode).
//    {n} becomes the number of entries on that screen (shown underlined).
//    Each screen picks one at the start of every sequence; in the mix the three screens get different ones.
const HEADLINES_FILE = path.join(__dirname, "headlines.json"); // saved here when edited on /admin.html
const DEFAULT_HEADLINES = {
  students: ["The Official Top {n} Students of VC ZHdK", "Ranking {n} Students of VisCom"],
  inventions: ["The All-Time Top {n} Things", "The {n} Greatest Inventions"],
  konzerne: ["The {n} Hottest Brands", "The {n} Best Corporations", "{n} Most Influential Businesses"],
  mix: ["The Index of Everything", "The Best of Everything", "Everything, Ranked"],
  rotateSec: 0, // 0 = one headline per sequence; otherwise switch to another one every N seconds
};

// ── Sequence 2: everything mixed. Every image goes to exactly one of the three screens;
//    each screen gets a random third of every category. Same settings for all three screens.
const MIX = {
  label: "Everything",
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

// ── Tempo ──
// Each screen does ONE thing at a time: either a new entry hovers in and lands, or one ranked
// entry moves. After every action there is a pause. Nothing ever happens at the same time.
const HOVER_MIN_MS = 4000; // how long a new entry hovers before it lands (4–6 s)
const HOVER_MAX_MS = 6000;
const PAUSE_MIN_MS = 2500; // pause after every action before the next one (2.5–5 s)
const PAUSE_MAX_MS = 5000;
const START_SPEED = 1; // tempo of the whole brain: 2 = twice as fast, 0.5 = half (also a slider on /admin.html)
// While images are still waiting, each action is either a new entry or a rearrangement (a move).
// The chance of a move grows as the list fills: +10 % after every 6 placements.
const MOVE_CHANCE_START = 0.35; // chance of a move at the start (35 %)
const MOVE_CHANCE_STEP = 0.1; // … plus this much (10 %) …
const MOVE_STEP_EVERY = 6; // … after every 6 placed entries
const MOVE_CHANCE_MAX = 0.9; // never more than 90 %, so new entries keep coming
// (once every image is placed, every action is a move)
// Moves of ranked entries. One tier = 20 score points.
const DRIFT_MAX = 15; // normal move: up to 15 points (mostly within a tier or into the next)
const BIG_JUMP_CHANCE = 0.08; // chance that a move is a big jump …
const BIG_JUMP_MAX = 55; // … of up to this many points (= up to 2–3 tiers at once)
const WILDER_AFTER_MS = 180000; // over the first 3 minutes of a sequence the moves get bigger, up to …
const WILDER_FACTOR = 1.5; // … 1.5× bigger moves and 1.5× more big jumps (1 = always the same)
const CLEAR_MS = 2500; // how long the screens take to clear between the sequences
// Length of each sequence in minutes (also set live on /admin.html). 0 = until you switch by hand.
// When sequence 1 ends, the mix starts; when the mix ends, sequence 1 starts again.
const SEPARATE_MINUTES = 0;
const MIX_MINUTES = 0;
const AUTO_MIX_AFTER_MS = null; // null = the mix starts only by hand on /admin.html (or a time in ms after all lists are full)
const RESCAN_MS = 15000; // how often the image folders are checked
const HISTORY = 60; // how many past events a newly opened feed gets

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

// ════════════════ STATE ════════════════
let phase = "separate"; // separate | clearing | mix
let speed = START_SPEED; // changed live by the slider on /admin.html
const lengths = { separate: SEPARATE_MINUTES * 60000, mix: MIX_MINUTES * 60000 }; // changed live on /admin.html
let phaseStartedAt = Date.now();
let headlines = loadHeadlines();
let titles = {}; // screen → the headline it shows right now
let rotateTimer = null;
let phaseEndsAt = null;
let phaseTimer = null;
let seq = 0;
let autoMixTimer = null;
let autoMixAt = null;
const history = [];
const clients = new Set(); // { res, lite }
const files = {}; // category → [file names]
const lists = {};
for (const c of CATEGORIES) lists[c.id] = newList(c);
// one mixed list per screen: "mix-students", "mix-inventions", "mix-konzerne"
for (const c of CATEGORIES) lists[`mix-${c.id}`] = newList({ ...MIX, id: `mix-${c.id}`, screen: c.id, virtual: true });
const mixLists = () => CATEGORIES.map((c) => lists[`mix-${c.id}`]);
const mixAssign = new Map(); // image id → screen, for the mix
const allLists = () => Object.values(lists);

function newList(c) {
  return { ...c, items: new Map(), queue: [], hovering: new Map(), active: false, timers: new Set() };
}

const clamp = (v) => Math.max(1, Math.min(100, Math.round(v)));
const rand = (a, b) => a + Math.random() * (b - a);
const tierOf = (score) => TIERS.find((t) => score >= t.min).id;
// a move past the top or bottom bounces back, so S and F don't fill up over time
const bounce = (v) => clamp(v > 100 ? 200 - v : v < 1 ? 2 - v : v);
const rollScore = () => clamp(Math.random() * 105); // a random landing spot: any tier is possible

// "anna_mueller.jpg" → "Anna Mueller", "IBM.png" stays "IBM", "Hans-Peter_Müller.jpg" → "Hans-Peter Müller"
function titleFromFile(file) {
  let t = file.normalize("NFC").replace(IMG_EXT, "")
    .replace(/[-_ .]?(jpe?g|png|webp)$/i, "") // "ak-47jpg.jpg" → "ak-47"
    .replace(/_+/g, " ").replace(/\s+/g, " ").trim();
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
    parallel: 1,
    titles,
    tiers: TIERS.map((t) => ({ id: t.id, min: Number.isFinite(t.min) ? t.min : 0 })),
    categories: allLists().map((l) => ({
      name: l.id,
      label: l.label,
      title: l.title,
      source: l.source,
      headline: l.headline,
      virtual: !!l.virtual,
      screen: l.screen || l.id,
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
  const items = cats.flatMap((c) =>
    (files[c.id] || []).map((f) => ({
      id: list.virtual ? `${c.id}/${f}` : f,
      title: titleFromFile(f),
      image: `/images/${c.id}/${encodeURIComponent(f)}`,
      named: !!c.names,
    }))
  );
  // a single category: only the images picked for this round
  if (!list.virtual) return list.selection ? items.filter((it) => list.selection.has(it.id)) : items;
  // the mix: only the images dealt to this screen
  return items.filter((it) => mixAssign.get(it.id) === list.screen);
}

// pick this round's images for one category screen
function pickSelection(list) {
  const all = shuffle([...(files[list.id] || [])]);
  list.selection = new Set(ENTRIES_PER_SCREEN ? all.slice(0, ENTRIES_PER_SCREEN) : all);
}

// the mix: every screen gets ENTRIES_PER_SCREEN images, taken in turn from the three folders
function dealMix() {
  mixAssign.clear();
  const screens = CATEGORIES.map((c) => c.id);
  const piles = CATEGORIES.map((c) => shuffle([...(files[c.id] || [])]).map((f) => `${c.id}/${f}`));
  const total = piles.reduce((n, p) => n + p.length, 0);
  const per = ENTRIES_PER_SCREEN || Math.ceil(total / screens.length);
  screens.forEach((scr, si) => {
    for (let j = 0, got = 0; got < per && piles.some((p) => p.length); j++) {
      const pile = piles[(j + si) % piles.length]; // each screen starts with a different folder
      if (!pile.length) continue;
      mixAssign.set(pile.shift(), scr);
      got++;
    }
  });
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
  }
}

function rescan() {
  if (readFolders()) allLists().filter((l) => l.active).forEach(sync);
}

// ════════════════ THE RANKING ENGINE ════════════════
// empty tiers, every image waiting
function reset(list) {
  stop(list);
  if (!list.virtual) pickSelection(list);
  list.items = new Map(wantedItems(list).map((w) => [w.id, { ...w, score: 0, ranked: false }]));
  list.hovering = new Map();
  list.queue = shuffle([...list.items.keys()]);
}

function start(list) {
  list.active = true;
  list.startedAt = Date.now();
  later(list, () => act(list), 1000);
}

const pause = () => rand(PAUSE_MIN_MS, PAUSE_MAX_MS) / speed;

// the one action loop of a list: a new entry OR a move, then a pause, then the next
function moveChance(list) {
  const placed = ranking(list).length;
  return Math.min(MOVE_CHANCE_MAX, MOVE_CHANCE_START + MOVE_CHANCE_STEP * Math.floor(placed / MOVE_STEP_EVERY));
}

function act(list) {
  const canIntro = list.queue.length > 0;
  const canMove = ranking(list).length > 1;
  if (canIntro && (!canMove || Math.random() >= moveChance(list))) {
    if (hover(list)) return; // land() continues the loop after the entry has landed
  } else if (canMove) {
    drift(list);
  }
  later(list, () => act(list), pause());
}

// 1. a new entry hovers up and down for a few seconds …
function hover(list) {
  const id = list.queue.shift();
  const e = list.items.get(id);
  if (!e) return false;
  e.score = rollScore();
  const used = new Set([...list.hovering.values()].map((h) => h.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const now = Date.now();
  const h = { id, slot, startedAt: now, landAt: Math.round(now + rand(HOVER_MIN_MS, HOVER_MAX_MS) / speed) };
  list.hovering.set(id, h);
  broadcast({ type: "hover", now, category: list.id, ...hoverPublic(list, h), waiting: list.queue.length });
  later(list, () => land(list, id), h.landAt - now);
  return true;
}

// … and then lands in its tier
function land(list, id) {
  const e = list.items.get(id);
  later(list, () => act(list), pause());
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
  checkAutoMix();
}

// 2. one ranked entry moves (bigger moves the longer the sequence runs)
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
    e.score = bounce(e.score + delta);
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

// the timer of the running sequence: when it runs out, the other sequence starts
function armPhaseTimer() {
  clearTimeout(phaseTimer);
  phaseTimer = null;
  phaseEndsAt = null;
  const len = lengths[phase];
  if (!len) return;
  phaseEndsAt = Math.max(Date.now() + 5000, phaseStartedAt + len);
  phaseTimer = setTimeout(() => switchTo(phase === "separate" ? "mix" : "separate"), phaseEndsAt - Date.now());
}

// clear everything fast, then start the next sequence
function switchTo(next) {
  if (phase === "clearing") return false;
  clearTimeout(phaseTimer);
  phaseTimer = phaseEndsAt = null;
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
    phaseStartedAt = Date.now();
    pickTitles(next, false);
    armPhaseTimer();
    if (next === "mix") dealMix();
    allLists().forEach(reset);
    const run = next === "mix" ? mixLists() : CATEGORIES.map((c) => lists[c.id]);
    run.forEach(start);
    broadcast(snapshot());

    // the feed announces the new round, in the mix with a student next to something else
    let sample;
    if (next === "mix") {
      const items = shuffle(mixLists().flatMap((l) => [...l.items.values()]).map(brief));
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

// ════════════════ HEADLINES ════════════════
function loadHeadlines() {
  try {
    return { ...DEFAULT_HEADLINES, ...JSON.parse(fs.readFileSync(HEADLINES_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_HEADLINES };
  }
}

// choose a headline for every screen: from its own list, or in the mix three different ones
function pickTitles(forPhase = phase, send = true) {
  const screens = CATEGORIES.map((c) => c.id);
  const t = {};
  if (forPhase === "mix") {
    const pool = shuffle([...(headlines.mix || [])]);
    screens.forEach((scr, i) => (t[scr] = pool.length ? pool[i % pool.length] : null));
  } else {
    for (const scr of screens) {
      const all = headlines[scr] || [];
      const fresh = all.filter((x) => x !== titles[scr]); // not the same one twice in a row
      const from = fresh.length ? fresh : all;
      t[scr] = from.length ? from[Math.floor(Math.random() * from.length)] : null;
    }
  }
  titles = t;
  if (send) broadcast({ type: "titles", titles });
}

function armRotate() {
  clearInterval(rotateTimer);
  rotateTimer = null;
  if (headlines.rotateSec > 0) {
    rotateTimer = setInterval(() => phase !== "clearing" && pickTitles(), headlines.rotateSec * 1000);
  }
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
  if (msg.type === "hover" || msg.type === "roster" || msg.type === "titles") return null;
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
    speed,
    titles,
    headlines,
    now: Date.now(),
    phaseStartedAt,
    phaseEndsAt,
    minutes: { separate: lengths.separate / 60000, mix: lengths.mix / 60000 },
    autoMixAt,
    lists: allLists().map((l) => ({
      name: l.id,
      label: l.virtual ? `Mix on the ${lists[l.screen].label} screen` : l.label,
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
      if (msg.action === "headlines") {
        const clean = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 100);
        const next = { rotateSec: Math.max(0, Math.min(3600, Number(msg.rotateSec) || 0)) };
        for (const k of ["students", "inventions", "konzerne", "mix"]) next[k] = clean(msg.lists && msg.lists[k]);
        headlines = next;
        fs.writeFile(HEADLINES_FILE, JSON.stringify(headlines, null, 2), () => {});
        pickTitles(phase === "clearing" ? "separate" : phase, true);
        armRotate();
        console.log("Headlines updated");
        return json(res, 200, { ok: true, ...status() });
      }
      if (msg.action === "timer") {
        const m = Number(msg.minutes);
        if (!["separate", "mix"].includes(msg.phase) || !(m >= 0 && m <= 600)) {
          return json(res, 400, { ok: false, error: "minutes must be between 0 and 600" });
        }
        lengths[msg.phase] = Math.round(m * 60000);
        if (phase === msg.phase) armPhaseTimer();
        console.log(`Timer ${msg.phase} → ${m} min`);
        return json(res, 200, { ok: true, ...status() });
      }
      if (msg.action === "speed") {
        const v = Number(msg.value);
        if (!(v >= 0.1 && v <= 5)) return json(res, 400, { ok: false, error: "speed must be between 0.1 and 5" });
        speed = v;
        console.log(`Speed → ${speed}×`);
        return json(res, 200, { ok: true, ...status() });
      }
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
armPhaseTimer();
pickTitles("separate", false);
armRotate();
setInterval(rescan, RESCAN_MS);

server.listen(PORT, () => {
  console.log(`Rankmania running on http://localhost:${PORT}`);
  for (const c of CATEGORIES) {
    console.log(`  ${c.label.padEnd(20)} ${String(files[c.id].length).padStart(3)} images  ← public/images/${c.id}/`);
  }
  console.log(`Admin page: http://localhost:${PORT}/admin.html`);
});
