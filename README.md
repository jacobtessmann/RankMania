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
public/images/things/       ← things (listchallenges.com, "Top 100 Greatest Things Ever")
public/images/corporations/     ← company logos/photos
```

- **All images are squares** (e.g. 600 × 600 px). Use the script below to square them all at once.
- **About 45 images per folder, 20 per round:** every round, each screen ranks 20 images picked at random from its folder, so each round has a different line-up. In the mix, there is one shared list of 20 drawn evenly from all three folders. Change the number with `ENTRIES_PER_SCREEN` in `server.js` (0 = all images).
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
python tools/square_images.py my_photos/corporations public/images/corporations --mode pad
```

- You can also give it one folder that contains `students/`, `things/` and `corporations/` subfolders, and they are recreated in the output folder.
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
| `/ranking.html?cat=things&kiosk=1` | Ranking screen, Things |
| `/ranking.html?cat=corporations&kiosk=1` | Ranking screen, Corporations |
| `/ranking.html` | All categories with the switch at the bottom |
| `/feed.html` | The personal snapshot feed for visitors' phones (make a QR code of this link) |
| `/admin.html` | Show control: switch between sequence 1 and 2, brain speed slider |
| `/brain.html` | The brain as a terminal |
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

> We gave away our personal taste to monopolising media outlets. Now we can give it to the perfect machine. Who gets to rank what, based on what?

Every start of the server begins with **empty tiers**.

**One thing at a time.** Each screen does exactly one action, then pauses (2.5–5 s), then the next: either a new entry leaves the "…" row, hovers up and down the dashed track on the right for 4–6 s and lands in its tier, or one ranked entry moves up or down. Colored outlines show what happened: **white** = just landed, **green** = moved up, **red** = moved down.

**Sequence 1 · Separate:** each category fills its own screen.

**Intermission** (45 s, right after sequence 1: everything falls and the intermission starts; the entries that moved most are still printed; `INTERMISSION_MS`): every tierlist screen shows a black page with a white-framed headline ("intermission / Analyzing Results …" left, "Mediating Rankings …" middle, "Preparing print …" right, `INTER_TEXT`), replays the terminal lines of its own round, and one big blue progress bar fills the area below the headline across all three screens, from left to right; the second headline line types itself again and again. The brain screen prints a big ASCII face into its log, white on black like the rest; every new frame is a new block of lines that fills the screen (same font size), so exactly one face is visible and the scrolling log is the animation (smiling, then laughing).

**Sequence 2 · Mix** (only by hand): all pictures fall off every screen, then **one shared list of 20 images**, drawn evenly from all three folders, is ranked once. The three screens show that same list in three ways (`MIX_VIEW` in `ranking.html`): **left (capital screen)** the top 3 as big, overlapping, tilted and shaking pictures on green (#1 biggest); **middle (people screen)** the full tierlist with graphics and background inverted, pictures and yellow names unchanged; **right (things screen)** the bottom 3 the same way on red (last place biggest). In the mix the ranking runs twice as fast (`MIX_SPEEDUP` in server.js), the middle screen keeps white vignettes (green/red fade after a move as everywhere) and its title and tier letters stay black with white text, the top 3 always have green vignettes and the bottom 3 red ones. The left and right screen have a black title bar on top ("Top 3 of Everything", "Bottom 3 of Everything", `POD_TITLE`). Positions and sizes: `POD_LAYOUT`, colors: `--pod-top-bg`, `--pod-bottom-bg`. RankFeed writes a single "Everything" article, and C, P and T all lead to it.

**Show control** on **/admin.html**: the buttons "Start sequence 2" and "Restart sequence 1", a **speed slider** for the whole brain (0.25× to 3×, live on all screens), and **timers** for the length of each sequence with a live countdown. When sequence 1 runs out, the mix starts; when the mix runs out, sequence 1 starts again. 0 = no timer. The page has no password: anyone who knows the address can control the show, so don't share the link.

Settings at the top of `server.js`:

| Setting | What it does |
|---|---|
| `names` per category | write names on the tierlist pictures (only Students: `true`) |
| `MIX` | title and source of the one shared mixed list |
| `START_SPEED` | tempo when the server starts (1); the admin slider changes it live |
| `HOVER_MIN_MS/MAX_MS` | how long a new entry hovers before it lands |
| `PAUSE_MIN_MS/MAX_MS` | pause after every action |
| `MOVE_CHANCE_START`, `MOVE_CHANCE_STEP`, `MOVE_STEP_EVERY`, `MOVE_CHANCE_MAX` | while images are waiting: chance that the next action is a move instead of a new entry. Starts at 35 %, +10 % after every 6 placements, at most 90 % |
| `DRIFT_MAX` | size of a normal move (one tier = 20 points) |
| `BIG_JUMP_CHANCE`, `BIG_JUMP_MAX` | how often a move jumps 2–3 tiers, and how far |
| `WILDER_AFTER_MS`, `WILDER_FACTOR` | moves get this much bigger over this time (`1` = stays the same) |
| `CLEAR_MS` | how long the clearing between the sequences takes |
| `SEPARATE_MINUTES`, `MIX_MINUTES` | length of each sequence at server start (now 3 and 2 minutes, so the show loops by itself; 0 = by hand); the timers on /admin.html change them live |
| `AUTO_MIX_AFTER_MS` | `null` = mix only by hand; a time in ms = automatic after all lists are full |
| `TIERS` | score borders of S A B C D F |

## 6. The tierlist screen (ranking.html)

Black title block with the number underlined, black tier letters on a white background with a soft grey band slowly running down it, as if it were rendering, the "…" row with the images still waiting, the hover track on the right behind a white line, and a white side strip with three vertical texts: the website (`SITE_TEXT`), the source line (`source` in server.js) and the verdict dots from RankFeed (● green = good, ● red = bad; `DOT`, `MAX_DOTS`). The sequence countdown is on /admin.html and in the brain view. Every picture has a vignette and its name in yellow Helvetica. The vignette's color shows the state: white = ranked, no vignette = still undecided (hovering), green = just moved up, red = just moved down.

Look settings at the top of the `<style>` part: `--shade` and `--render-time` (the grey band that slowly runs down the white background), `--name` (name color), `--vig-undecided`, `--vig-up`, `--vig-down` (vignette colors), `--frame` (white frame), `--label-w` (width of the letter boxes), `--side-w` (side strip). The vignette strength is `--vig-blur` (.14) and `--vig-spread` (.1), both relative to the icon size.

**Brain view** (/brain.html) prints only a little so people can read along: 3 variables per evaluation, one result line, about a third of the small moves, 2 "LEARNED" lines per verdict. Tune at the top of `brain.html` (`VARS_SHOWN`, `DRIFT_SHOWN`, `REEVAL_CHANCE`, `LESSONS_SHOWN`).

**One design system on every screen and in every mode:** white frame (`--frame`), black title bar of the same size (`--title-h`), black letter column with white lines between the tiers (or the same white line under the title), white side strip with the source and the verdict dots. The mix's top 3 / bottom 3 sit inside that same frame instead of the tiers; the intermission keeps the frame and the line under its title. Verdict flashes only colour the main area, never the title, the letter column, the white lines or the side strip.

**After the mix** the screens fade slowly to black (`MIX_FADE_MS` = 3 s), then sequence 1 fades in a bit faster. The black title bar has the same size and font size in every mode on every screen, and category words in it (Students, Things, Brands, Everything …) are italic.

**Band direction:** the hidden panel (press S) has a Direction button: the grey band runs top → bottom or bottom → top (saved in that browser).

**Verdict flash:** when a RankFeed verdict reaches a screen, its whole background flashes green (good, fades in 0.9 s) or red (bad, fades in 2.5 s), like the brain screen (`BAND_FLASH` in `ranking.html`).

**Headlines** come from the lists on **/admin.html** (one list per mode: students, things, corporations, mix). Each screen picks one at the start of every sequence; in the mix the three screens always show different ones. Optional: switch to another headline every N seconds. `{n}` becomes the live number of entries (underlined). Headlines saved on the admin page last until the next redeploy; to keep them for good, put them into `DEFAULT_HEADLINES` in `server.js` (or a `headlines.json` file next to it). The title block always has room for two lines, so a longer or shorter headline never changes the icon size.

**Sound effects** are made in the browser (no files): a rising blip when an entry starts hovering, ticks while it is undecided (higher for a higher place), a thud when it lands, two notes up or down when an entry moves, and a whoosh when the screens clear. Browsers only play sound after someone clicks or presses a key on the page once, so click each screen once after opening it (a small note reminds you). **M** mutes and unmutes. Settings: `SOUND_ON`, `VOLUME` in `ranking.html`.

**One icon size, rows that grow.** All icons (in the tiers, on the hover track) have the same size, and it never changes during a sequence. Each tier row is exactly one icon tall; when a tier is full, its row gets another line, like on TierMaker. All the space that is left goes to the "…" row at the bottom. Icons in the same tier touch; a white line separates the tiers. The size is chosen once, as big as possible while the whole list is guaranteed to fit on the screen however the entries spread over the tiers.

**Hidden icon size slider:** press **S** on the keyboard (or double-click the title) on a screen. Drag to set the size, "Auto" to go back. It is saved in that browser, separately for each screen. The same panel has the background and vignette settings: shade color, band width, speed, vignette blur and spread (saved in that browser for all screens, "Reset background" goes back to the defaults). With a big manual size, very full tiers can run off the bottom of the screen.

Settings near the top of the script: `TILE_SIZE` (fixed size in px for all screens, 0 = automatic), `POOL_SCALE` (size of the "…" icons compared to the others), `STEP_MS`, `SWING`, `SETTLE` (how nervous the hovering looks), `MARK_MS` (how long the colored outline stays). Colors and fonts are at the top of the `<style>` part.

## 7. The phone feed (feed.html)

RankFeed is set entirely in **CMU Typewriter Text Light** (Donald Knuth's Computer Modern typewriter, `public/fonts/cmunbtl.woff`), no bold; the hierarchy is size alone. Each article has a plain headline that says what is ranked (`head` in `TEASERS`) and the clickbait as subheadline (`titles`, `subs`). The vote at the end is a full-width green/red block ("Help us train the machine.").

The sticky top bar shows "RANKINGS FROM 13:39" (when this edition was written) and three red buttons C, P, T that jump to capital, people and things (in the mix, all three open the one "Everything" article). The thumbnails are one red word in a red frame: CAPITAL, PEOPLE, THINGS, EVERYTHING.

Article headlines are the headlines the tierlist screens show right now (in the mix: the middle screen's). The vote is a bar fixed at the bottom of every article ("How is this ranking? Calibrate the machine.") and can be pressed again and again (`VOTE_COOLDOWN_MS` = 0.7 s only stops double taps); each press counts up on the button. The article ends with the link to its own source list (the mix: all three); the home page has none. In the mix the top bar shows a single E button.

RankFeed is a **personal snapshot**. The moment someone opens it, it loads the ranking once and writes three articles for that visitor only, one per category (during the mix: one "Everything" article). It never changes while you read it; a manual refresh writes a new edition from the ranking at that moment.

**Entries** are grouped by tier, each group under a big colored "A-TIER" block, with no numbers: the picture, the name, and one line of drama about its placement (`DRAMA` in `public/feed.html`, many lines per tier, none repeated in one article). For every corporation, an unexpected shocking fact with a political edge comes first in the same paragraph, with a small source link at the end (`EXPOSED`). All texts stay in character (a BuzzFeed writer taking the ranking very seriously): intro (`INTRO`), red subheadline (`TEASERS`), one line after the first tier (`MIDDLES`). Researched November 2026.

- The home page shows the three articles. Tapping one opens the full list, entries under each other with place, tier, picture, name and a short line.
- Tapping an entry opens it large with a **Print** button. Printing is not connected yet: put the real code into `printEntry(entry, article)` in `feed.html`.
- Headlines, intros and lines are templates at the top of the script (`HEADLINES`, `LEADS`, `LINES`). Placeholders: `{top}` `{second}` `{last}` `{mid}` `{n}` `{label}` in headlines and intros; `{N}` `{A}` (above) `{B}` (below) `{T}` (tier) in the lines. The reason for a ranking is never stated.

**Verdict:** at the end of each article, visitors rate the whole list "Good" or "Bad" (once per article). The vote really reaches the brain: it appears as a green or red ● at the bottom of that screen's side strip, as a FEEDBACK line in the brain terminal, and it nudges the brain a little: "bad" makes that screen more restless for a while (shorter pauses, more and bigger moves), "good" calms it. The effect adds up and fades out (half gone after 90 s). Settings in `server.js`: `VOTE_WEIGHT`, `MOOD_HALF_LIFE_MS`, `VOTE_COOLDOWN_MS`. Texts in `feed.html`: `VERDICT`. The dots reset at every new sequence.

**The brain really learns.** With every verdict the voter's list is sent along. "Good" gives everything that was high in that list a tiny plus and everything low a tiny minus (this order was right); "bad" does the opposite. The middle gets almost nothing. What an image learned stays with it across all rounds and both sequences: it shifts where the image lands when it is introduced, and its moves go its learned way more often. One verdict does almost nothing; many verdicts in the same direction slowly push an image up or down. Settings in `server.js`: `LEARN_RATE` (points per verdict, 1.5), `LEARN_MAX` (the cap, 15 points, less than one tier), `LEARN_TILT` (how much more often moves go the learned way at the cap). The brain terminal shows LEARNED lines, and /admin.html lists what was learned with a button to forget it. It is kept in memory only, so it starts from zero when the server restarts (redeploy, or Render sleeping).

## 8. The brain view (brain.html)

A plain black-and-white terminal that shows the brain working, live: every evaluation with its variables, the result, every recalculation, and the sequence changes. The variable names and values are invented (always the same values for the same entity); the scores, tiers and places are the real ones. About a third of the moves are shown as a full re-evaluation with old → new values. The bar at the top shows the sequence, the timer, speed and counts. On every verdict the whole screen flashes: red after "bad", fading back to black slowly, bright green after "good", fading faster. Settings: `REEVAL_CHANCE`, `VARS`, `FLASH` (colors and fade times).
