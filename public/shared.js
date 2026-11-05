// ════════════════════════════════════════════════════════════════
//  shared.js — every display (ranking screen, phone feed, …) loads this.
//  It connects to the Rankmania server and hands the live events to the page.
//
//  Where is the server?
//   · Pages served BY the server need nothing (same address).
//   · Pages hosted somewhere else: set RANK_SERVER below,
//     or open the page with  ?server=https://your-app.onrender.com
// ════════════════════════════════════════════════════════════════
(function () {
  const RANK_SERVER = ""; // e.g. "https://rank-brain.onrender.com"

  const qs = new URLSearchParams(location.search);
  const BASE = (qs.get("server") || window.RANK_SERVER || RANK_SERVER).replace(/\/+$/, "");
  window.RANK_BASE = BASE;

  let offset = 0; // server clock − this device's clock

  window.pick = (a) => a[Math.floor(Math.random() * a.length)];
  window.serverNow = () => Date.now() + offset;
  window.toLocalTime = (t) => t - offset; // server timestamp → this device's clock

  const abs = (u) => (!u || /^(https?:|data:|blob:)/.test(u) ? u : BASE + u);
  function fix(m) {
    if (!m || typeof m !== "object") return m;
    if (typeof m.image === "string") m.image = abs(m.image);
    for (const k of ["entry", "before", "after", "above", "below"]) fix(m[k]);
    for (const k of ["entries", "pool", "hovering", "sample", "categories", "history"]) (m[k] || []).forEach(fix);
    return m;
  }

  /**
   * connectDisplay({ lite, onSnapshot, onHover, onCommit, onDrift, onRoster, onPhase, onStatus })
   *  lite: true        phones: smaller stream without full lists and hover events
   *  onSnapshot(snap)  full state: snap.phase, snap.categories[] (mixed lists: virtual, screen) =
   *                    {name,label,title,source,headline,virtual,entries[],pool[],hovering[],waiting}
   *                    (also sent again after every sequence change)
   *  onHover(ev)       a new entry starts hovering: ev.entry, ev.score, ev.tier, ev.slot, ev.startedAt, ev.landAt
   *  onCommit(ev)      it landed: ev.entry {id,title,image,named,score,tier,rank}, ev.above/ev.below, ev.entries
   *  onDrift(ev)       live adjustment: ev.id, ev.before, ev.after, ev.change, ev.above/ev.below, ev.entries
   *  onRoster(ev)      images added/removed: ev.entries, ev.pool
   *  onPhase(ev)       ev.phase = "clearing" (with ev.next) | "mix" | "separate"; ev.sample = 2 entries
   *  onStatus(text)    connection status
   *  Past events are replayed once with ev.replay = true (without entries/pool).
   */
  window.connectDisplay = function (h) {
    const status = (s) => h.onStatus && h.onStatus(s);
    const HANDLER = { hover: "onHover", commit: "onCommit", drift: "onDrift", roster: "onRoster", phase: "onPhase" };
    const call = (m) => h[HANDLER[m.type]] && h[HANDLER[m.type]](m);
    let es = null;
    let lastSeq = 0;
    let lastMsg = Date.now();

    function open() {
      if (es) es.close();
      status("connecting…");
      es = new EventSource(BASE + "/events" + (h.lite ? "?lite=1" : ""));
      es.onopen = () => status("live");
      es.onerror = () => status("reconnecting…");
      es.onmessage = (raw) => {
        lastMsg = Date.now();
        const m = fix(JSON.parse(raw.data));
        if (m.now) offset = m.now - Date.now();
        if (m.type === "snapshot") {
          h.onSnapshot && h.onSnapshot(m);
          for (const ev of m.history) {
            if (ev.seq > lastSeq) call({ ...ev, replay: true });
          }
          lastSeq = Math.max(lastSeq, m.seq);
          status("live");
          return;
        }
        if (m.seq) {
          if (m.seq <= lastSeq) return;
          lastSeq = m.seq;
        }
        call(m);
      };
    }

    // phones kill connections when the screen locks: reconnect when we come back or go quiet
    setInterval(() => {
      if (Date.now() - lastMsg > 40000) open();
    }, 10000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && (!es || es.readyState === 2 || Date.now() - lastMsg > 20000)) open();
    });

    open();
  };
})();
