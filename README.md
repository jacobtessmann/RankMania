# Rankmania

One central server computes the rankings. Every screen and phone just shows what the server says, so they are always in sync.

```
                      ┌──────────────────────────┐
  public/images/ ───▶ │  server.js  (the brain)  │
                      │  computes all 3 rankings │
                      └────────────┬─────────────┘
                                   │  live stream (/events)
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
  ranking.html?cat=students   ranking.html?cat=…      feed.html (phones)
```

## 1. Where to put the images

```
public/images/students/     ← photos of the students
public/images/inventions/   ← historic inventions
public/images/konzerne/     ← company logos/photos
```

- **All images are squares** (e.g. 600 × 600 px). Use the script below to square them all at once.
- One image = one entry. Allowed: `.jpg .jpeg .png .webp .gif .avif .svg`
- **The file name becomes the displayed name** (on the tierlist pictures and in the feed headlines): `anna_mueller.jpg` → "Anna Mueller", `IBM.png` → "IBM", `Hans-Peter_Müller.jpg` → "Hans-Peter Müller" (underscore = space, hyphens stay)
- Keep images small (e.g. max 600 px, under 200 KB) so phones load fast.
- The server checks the folders every 15 seconds. New images join the ranking, deleted images disappear. No restart needed.

### Make all images square (tools/square_images.py)

Needs Python 3 and Pillow (`pip install pillow`). Your originals are never changed.

```bash
# photos: crop to a square, keeps faces (0.4 = cut a bit above the middle on tall photos)
python tools/square_images.py my_photos/students public/images/students

# logos/objects: keep the whole picture, fill the rest white
python tools/square_images.py my_photos/konzerne public/images/konzerne --mode pad
```

- You can also give it one folder that contains `students/`, `inventions/` and `konzerne/` subfolders, and they are recreated in the output folder.
- Output: 600 × 600 px JPG. File names are kept (only the ending becomes `.jpg`).
- **Names from a list:** put a `names.txt` into the folder with the photos (one name per line, UTF-8 or normal Windows text). Every photo gets a random name from the list as its file name, e.g. `Léna_Aebi.jpg`. Extra photos are left out; names without a photo are listed at the end. Add `--in-order` to give the names to the photos in alphabetical order instead.

  ```
  my_photos/students/
    names.txt            ← Léna Aebi
    face_001.jpg            Vivienne Anne Siegenthaler
    face_002.jpg            Hans-Peter Müller
    …                       …
  ```
- Options: `--size 800`, `--focus 0.3` (keep more of the top), `--bg black`, `--quality 90`. Run with `--help` for all.

## 2. Run it on your computer

Needs Node.js 18 or newer. No `npm install` needed.

```bash
node server.js
```

Then open http://localhost:3000. Phones in the same Wi‑Fi can open `http://<your-computer-ip>:3000/feed.html`.

## 3. Put it online for free (Render)

1. Push this folder (with your images) to a GitHub repository.
2. On https://render.com → **New → Web Service** → pick the repo.
3. Runtime: **Node**, Build command: *(leave empty)*, Start command: `node server.js`, Instance type: **Free**.
4. You get an address like `https://rank-brain.onrender.com`.

Pages:

| Page | Use |
|---|---|
| `/ranking.html?cat=students&kiosk=1` | Ranking screen, Students only, no switch buttons |
| `/ranking.html?cat=inventions&kiosk=1` | Ranking screen, Historic Inventions |
| `/ranking.html?cat=konzerne&kiosk=1` | Ranking screen, Konzerne |
| `/ranking.html` | All categories with the switch at the bottom |
| `/feed.html` | The live feed for visitors' phones (make a QR code of this link) |
| `/admin.html` | Show control: switch between sequence 1 and 2 |
| `/api/state` | The raw current ranking as JSON |

**Free tier notes:** Render's free service sleeps after ~15 minutes without visitors and needs ~30 s to wake up. Open the ranking screens before the event and keep them open; the open screens keep it awake. Every restart or redeploy starts the show from empty tiers again. Images added on your computer only appear online after you push them to GitHub (Render redeploys automatically).

## 4. Hosting a display somewhere else

The displays can live on any other site too (e.g. GitHub Pages). Copy `shared.js` next to the page and either set `RANK_SERVER` at the top of `shared.js`, or open the page with `?server=https://rank-brain.onrender.com`.

Any new display only needs:

```html
<script src="shared.js"></script>
<script>
connectDisplay({
  onSnapshot(snap) { /* snap.categories[].entries = full ranking in order */ },
  onCommit(ev)     { /* a new entry joined: ev.entry, ev.entries = new ranking of ev.category */ },
  onDrift(ev)      { /* live adjustment: ev.before, ev.after, ev.change, ev.entries */ },
  onRoster(ev)     { /* images added/removed */ },
  onStatus(s)      { /* "live", "reconnecting…" */ },
});
</script>
```

Each entry looks like `{ id, title, image, score, tier, rank }`.

## 5. How the show works (server.js)

Every start of the server begins with **empty tiers**.

**Sequence 1 · Separate:** each category fills its own screen. A new entry leaves the "…" row and **hovers** up and down the dashed track on the right for 2.5–4.5 s, wild at first, then calmer, then it locks in (blue outline) and drops into its tier. One entry hovers at a time; as soon as it lands, the next one starts (set `PARALLEL` higher for several at once). Ranked entries keep drifting up and down (▲/▼).

**Switch:** all pictures fall off every screen.

**Sequence 2 · Mix:** every image of all three categories is dealt to exactly one of the three screens at random (each screen gets about a third of every category), so all three screens fill up with a mix, the same way.

The switch happens automatically 30 s after all three lists are full, or by hand on **/admin.html** (buttons "Start sequence 2" and "Restart sequence 1"). The admin password is `rankbrain` unless you set another one: on Render go to your service → **Environment** → add `ADMIN_KEY` with your own password. Without this, anyone who finds the admin page can switch your show.

Settings at the top of `server.js`:

| Setting | What it does |
|---|---|
| `names` per category | write names on the tierlist pictures (only Students: `true`) |
| `MIX` | title of the mixed lists (the same on all three screens) |
| `PARALLEL` | how many entries hover on the right at once (1) |
| `NEXT_GAP_MS` | pause between one landing and the next one starting to hover |
| `HOVER_MIN_MS/MAX_MS` | how long an entry hovers before it lands |
| `DRIFT_MIN_MS/MAX_MS`, `DRIFT_MAX` | how often and how far ranked entries move at the start |
| `BIG_JUMP_CHANCE`, `BIG_JUMP_MAX` | how often an entry jumps 2–3 tiers at once, and how far |
| `WILDER_AFTER_MS`, `WILDER_FACTOR` | the drift gets this much wilder over this time (`1` = stays the same) |
| `CLEAR_MS` | how long the clearing between the sequences takes |
| `AUTO_MIX_AFTER_MS` | auto switch after all lists are full (`null` = only by hand) |
| `TIERS` | score borders of S A B C D F |

On the ranking screen (`ranking.html`), `STEP_MS`, `SWING` and `SETTLE` control how nervous the hovering looks. `TILE_SIZE` sets a fixed icon size in pixels (0 = automatic); the automatic size is chosen once per sequence so that one tier can hold `TIER_SHARE` (32%) of all entries.

## 6. The tierlist screen (ranking.html)

Looks like TierMaker: a title bar, the tiers S–F, an optional source line, and the "…" row with the images that are not ranked yet. Works on landscape and portrait screens. The title and source line are set per category in `CATEGORIES` in `server.js` (`title`, where `{n}` becomes the number of images in blue, and `source`, which you can leave `""`).

## 7. The feed headlines (feed.html)

Every post is one article: a headline, the two square pictures side by side (shown whole, never cropped, no names on them; the names are only in the headline), and a short caption. Headlines are templates at the top of the script in `feed.html`; the placeholders are filled with the names from the ranking each time:

| Placeholder | Meaning |
|---|---|
| `{W}` / `{L}` | the one that moved up / the one it passed |
| `{R}` / `{R2}` | their new places |
| `{N}` / `{O}` | a new entry / the entry right next to it |
| `{T}` | a tier |

Add or change templates freely in `HEADLINES` (general and per category), `NUMBER_ONE`, `PROMOTED`, `DEMOTED`, `NEW_ENTRY` and `CAPTIONS`. Each category's main headline is the `headline` in `CATEGORIES` in `server.js`.

To add a 4th category: add it to `CATEGORIES` in `server.js` and create the matching folder in `public/images/`. Screens and feed pick it up automatically.

To start the show from scratch: restart the server, or press "Restart sequence 1" on /admin.html.
