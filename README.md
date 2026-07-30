# GD_DTTT

**Grim Dawn Devotion Theory-craft and Tracker Tool** — working name.

Pick up to five keyword tags, or name a celestial power outright, and get an ordered
devotion path you can follow in game and tick off as you buy it.

> Unofficial. Not affiliated with, endorsed by, or supported by Crate Entertainment.
> Work in progress — the UI is still being polished and there is no hosted build yet.

---

## What it does

- **Tag what you want.** Up to five keywords (Cold Damage, Armor, pet Total Damage…),
  each weighted 1–3. Or name a celestial power — Targo's Hammer, Fetid Pool — and the
  build is guaranteed to reach it.
- **Get a path, in order.** Which constellation, which stars, in the sequence you click
  them, with Crossroads bought and refunded where the affinity requires it.
- **Tick it off as you play.** Progress is stored per star and survives re-solving.
- **See the trade you made.** A coverage panel shows what each tag actually got against
  the most it could ever get — including when two tags starve each other, which is a
  real answer rather than a failure.

## Running it

Requires Node 20+ for the tests. The page itself is plain ES modules and needs no build
step, but it fetches `ui-index.json`, so it has to be served rather than opened from
disk:

```bash
git clone <this repo>
cd gd-dttt
npm run serve                 # python3 -m http.server 8080
# open http://localhost:8080/src/ui-mockup.html
```

From WSL the repo lives on the Windows drive (`/mnt/d/...`) and `localhost` is
forwarded, so the URL works unchanged in a Windows browser.

```bash
npm test                      # ~100 tests, no dependencies
```

## Regenerating the data

The repo ships the derived index the app needs, so a clone runs immediately. You only
need this if you want to rebuild from a newer game version.

`devotions.raw.json` is **not** committed — it is a verbatim extract of Crate's game
records, and Crate distinguishes shipping core game databases copied out of an install
(not permitted) from your own derived records built with their toolset (permitted). See
`THIRD-PARTY.md`. Regenerate it from your own legally owned installation:

```bash
node scripts/extract.mjs      <folder containing records/ and text/>  # -> devotions.raw.json
node scripts/port-labels.mjs  <path to an iagd clone>                 # -> labels.json
node scripts/reconcile-labels.mjs                                     # -> label-review.json
npm run build:keywords                                                # -> keywords.json
npm run build:index                                                   # -> ui-index.json  (~14s)
npm run check:version                                                 # 14/14 = data is v1.3.0.0
```

`check-version.mjs` fingerprints the extracted numbers against the v1.3.0.0 devotion
changelog. Run it after any game patch — it is the cheapest way to find out whether the
committed data has gone stale.

## Layout

```
src/lib/          solver, scheduler, scoring — no dependencies, all tested
src/ui-mockup.html  the whole UI, one file
scripts/          the extraction and index-building pipeline
USER-GUIDE.md     written for players, not developers
FUTURE-PLANS.md   deferred ideas, with the reasoning kept
```

The interesting parts are `src/lib/schedule.mjs` (Crossroads bootstrapping and refunds,
which is where the game's real rules live) and `src/lib/power.mjs` (why celestial powers
are scored by tier rather than by proc frequency — with the measurements that forced it).

## Licence

MIT for the code — see `LICENSE`. Grim Dawn's data, names and text belong to Crate
Entertainment and are not covered by it. Third-party attributions in `THIRD-PARTY.md`.
