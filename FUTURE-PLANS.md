# Future plans

Ideas deliberately deferred. Near-term work lives in `RESUME-HERE.md` under **Next**;
this is the further-out list, with enough reasoning recorded that a decision doesn't
have to be re-derived later.

---

## Saved state: profiles and shareable builds

Right now the tool keeps a single saved state in `localStorage` under
`gd-devotion-planner:v1`, so planning a second character overwrites the first.

Two ways forward, not mutually exclusive:

**Named profiles.** Key saves by a user-supplied name (`gd-devotion-planner:v1:<slug>`)
with a picker in the header. Solves the overwrite problem, stays offline, no URL
length limits. Doesn't help anyone share a build.

**URL-encoded builds.** Encode inputs — three chip ids, scoring mode, point cap — into
the hash, so a build is a link. Shareable, bookmarkable, survives a cleared browser,
and costs no storage. Progress ticks should stay in `localStorage` rather than the
URL: a link is *the plan*, not *how far you've got*, and nobody wants to re-share a
URL every time they buy a star.

The likely answer is both: URL carries the plan, `localStorage` carries progress,
keyed by the plan's hash so switching between two shared builds keeps each one's ticks.

**Why it's safe to defer:** the storage key is versioned and `load()` ignores any
payload whose `v` it doesn't recognise, so adding profiles later won't break saves
already in the wild. Verified against a future-version payload in testing.

---

## Levelling-aware planning ("split constellation building")

Take three stars of a constellation early for the passives, go elsewhere, come back
later to complete it for the affinity.

Worth being precise about what this does and doesn't buy:

- **Not needed to reach a final 55-point build.** Partial takes grant no affinity, so
  taking stars early unlocks nothing you couldn't unlock later — it only ties up
  points sooner. Same endpoint either way.
- **Genuinely valuable while levelling**, which is the actual use case. At level 30 you
  have ~20 points, and one strong star from a constellation you'll finish at 80 often
  beats committing six points now.

What blocks it isn't the scheduler — `schedulePath()` already handles partial takes and
the affinity-on-completion rule. It's that the objective has no notion of "value at 20
points versus at 55". Cleanest route: solve at successive budgets (15/30/45/55) and
merge. Each solve's set is usually a superset of the last; where it isn't, that's
exactly where a split belongs.

---

## Time-indexed MILP (modelling Crossroads refunds)

`milp.mjs` is a static set and can't represent a Crossroads bought to cross an affinity
threshold and refunded once the constellations behind it stand alone. It therefore
overpays by 1–3 points; `schedulePath()` recovers them afterwards.

Doing it properly means indexing variables by time step, which multiplies the model
size by the number of steps. Only worth it if the 1–3 point conservatism turns out to
matter — measure before building.

---

## Showing actual stat values — DONE (for stars)

`src/lib/effects.mjs` renders a star's stats into readable lines, composed at build time
into `ui-index.json` as `fx`. Hovering a star in Detail shows them.

**The blocker recorded here was overstated.** It said ~66 fields needed iagd's
damage-template composition reimplemented — but `damageKeyword()` in `fields.mjs`
already did that and had simply never been wired to a display path. Coverage is 100% of
stat occurrences on stars.

The real difficulty was that `labels.json` holds three different kinds of thing:

- **310 templates** — `"+{0} Defensive Ability"`, `"Increases Shield Block Chance by
  {0}%"`. These carry the wording, the sign and the number's position. Substitute into
  them; concatenating produces `20 +{0} Defensive Ability`.
- **plain names** — need a sign and a unit adding from the field's suffix.
- **no label at all** — the damage fields, resolved by `damageKeyword()`.

Min and Max must be grouped, not walked linearly: Tsunami's power star lists
`offensiveColdMax` *before* `offensiveColdMin`, which a linear pass renders as "37 Cold
Damage" followed by "26-37 Cold Damage".

Constellation totals are done too: a card title sums the stars you are taking, which is
why lines are stored as a template plus its number rather than as finished strings.

Index cost: 122 KB to 227 KB, in exchange for the page shipping neither `labels.json`
nor the template logic.

Still open:

- ~~**Per-RANK values.**~~ **DONE 1 Aug.** `effectLines()` takes `{ rank }`, and `fxp`
  ships a second pair of numbers on any proc line whose value differs at the power's
  own cap. `CP Max` now shows cap numbers; `Passives` and `Balanced` show rank 1,
  because the tool doesn't model spending devotion points into a power.

  **It was 236 of 413 proc lines**, not a handful — most proc numbers were wrong in
  that mode. Measured before choosing how to ship it: appending the pair only where it
  differs costs **1.3 KB raw / 0.5 KB gzipped** against a 227 KB / 24.5 KB index, which
  settled the "arrays vs precomputed" question immediately. Ranks are read as "last
  entry of *this* array" — they are ragged (10/15/16/19/20/25 all occur), and a fixed
  index is how `NaN` gets into the objective.
- ~~**Coverage bars still count stars, not magnitude**~~ **DONE 1 Aug, but not the way
  this line assumed.** The bar still counts stars, on purpose. A bar is a proportion and
  a proportion needs one unit — and **33 of the 81 tags carry both `+{v}%` and flat
  `{v}` lines** (Offensive Ability, Defensive Ability, Physique, Vitality Damage,
  Bleeding, Poison…), so there is no single magnitude to be a proportion of for 41% of
  the picker. Picking a "dominant" unit would silently discard part of a third of it.

  What the row gained instead is the magnitude stated beside the tag name in whatever
  units it actually uses — `+39%`, `104-148`, or both — which is what answers the real
  complaint that a star giving +2% counted the same as one giving +40%. Ranges keep both
  ends; summing low ends understates a build by about a third.

  Star ceilings kept. A magnitude ceiling would need a second solve per tag optimising
  for magnitude rather than star count, and would only be meaningful for the 48
  single-unit tags anyway.

---

## Tag count

Raised from 3 to 5 after measuring: coverage held (86% of requested tags served at 3
tags, 91% at 5) and runtime grew sub-linearly (123ms to 177ms). The real cost is
dilution — each tag gets ~7 stars of support at 3 tags, ~5.7 at 5 — which is
arithmetic, not a flaw. The Coverage readout exists so that tradeoff is visible
rather than hidden.

Going beyond 5 is a one-line change (`MAX` in the UI; nothing in the libraries assumes
a count). At 6 tags coverage was still 89%, so the ceiling is a judgement about how
thin a build should be spread, not a technical limit.

## Weighted target tags — DONE

Implemented with a 1-3 dot control on each target pill (default 2, click to cycle).
`src/lib/wanted.mjs` holds the shape and clamping; `score()`, `starValuer()` and the
MILP's `starValue()` all multiply hits by weight.

Both input shapes are accepted — `['id']` still works at the default weight — so the
MILP scripts and older saved states didn't have to change in lockstep.

Coverage is weight-aware: each row shows its dots, and a tag whose share of the stars
falls well below its share of the total weight is flagged amber. That surfaces the case
where a keyword simply can't be served proportionally — Contagion exists on two
constellations in the whole tree, so weighting it 3/3 still returns 2 stars, and the
amber says "swap the tag", not "the solver ignored you".

Still open: **the bars count stars, not magnitude.** A star granting +2% counts the same
as one granting +40%. Needs per-level stat values (see "Showing actual stat values");
the two compound — weights say what you care about, magnitudes say what you got.

## Celestial powers as target tags — DONE

Implemented. 62 chips in a `Celestial Powers` category under Character, named after the
power. See `RESUME-HERE.md` for how the two kinds of tag differ and why `min` matters.

Still open on this:

- **Powers have no ceiling row.** Coverage shows a tick rather than a bar, which is
  right, but there's no sense of *how much* of the budget a power ate. "Fetid Pool: 3
  points" would be more useful than "Affliction 3/7".
- **Weights on power tags only break ties.** They decide which power is given up when
  several can't fit, and nothing else. That's defensible but undocumented in the UI.
- **`blockedPowers()` is O(candidates x schedule).** Fine at 62 and deferred, but if
  pet powers or item skills are ever added it'll want a cheaper pre-filter — e.g. sum
  the minimum points of the chosen set and reject anything that cannot possibly fit.

## Why the weight scale stays at three stars

Asked whether to widen it to five, one per tag, so a build could express a strict
ranking. Measured first, and the answer was no — the mechanism can't carry that much
precision.

Ordering 5 tags with distinct weights 1–5, then checking whether a heavier tag actually
came out ahead (share of its own ceiling, so availability is normalised out):

| weight gap | heavier tag ahead |
|---|---|
| +1 | **53%** |
| +2 | 61% |
| +3 | 68% |
| +4 | 60% |

A coin flip is 50%. Adjacent steps are noise, and widening to five would make each step
*smaller* in relative terms — more false precision, not more control.

**Why.** The objective maximises a weighted sum, and constellations are lumpy: no
constellation carries both Cold Damage and Casting Speed, so weighting Casting Speed 5×
still buys less total value than one more cold constellation. Weight competes with
availability and availability wins.

**A concave objective was prototyped** — swap `w × n` for `w × √n` so the tenth star of a
served tag is worth less than the first of a starved one. It moved +1 from 53% to 56% and
cut tags-on-zero from 15 to 12. Real but small, and not worth the complexity on its own.

**The deeper reason it can't work.** The solver buys whole constellations of 4–7 stars,
affinity-gated. That decision granularity is far coarser than a 5-level preference, so no
amount of weight resolution survives it.

**If a tag genuinely must be prominent, that wants a different control — a floor, not a
weight.** Celestial power targeting already proves the pattern works: a named power is
always delivered or explicitly reported as unmet, because it's a hard constraint rather
than a term in a sum. The same shape would work for "this keyword must reach at least N
stars", and it would do what more weight levels cannot.

## Smaller open questions

- **Ticks returning with a constellation.** Progress is keyed constellation:star, so if
  a rebuild drops a constellation and a later one brings it back, its ticks return.
  Right if you genuinely bought those stars, wrong if you were only exploring. DONE:
  the Devotions header's button was Undo (click a star to undo it, so a whole separate
  button for that felt redundant); it's now `resetProgress()` -- a "clear progress"
  control separate from full Reset, exactly as sketched here. `undo()`, the history
  stack, and Ctrl+Z are untouched in the code, just no longer wired to a visible
  button, in case that trade turns out wrong.
- **Unspent points on sparse keywords.** "Requirement Reduction" only reaches 28/55
  because nothing else scores. Needs a secondary objective to spend the remainder on
  general stats once the chosen keywords are exhausted.
- **`POWER_PRESSURE = 7.7`** now lives in `power.mjs` (was duplicated at 12 in three
  files). Still a tuning knob, but no longer an arbitrary one: it was rescaled by the
  measured 1.56x change in average power weight so that switching to tier scoring
  altered the RATIO between tiers without altering how much powers matter overall.
- **Within-tier power ranking is flat.** Every tier-2 power scores the same. Ranking
  them against each other needs effect magnitudes per rank, which is the same blocker
  as "Showing actual stat values" above. Until then, chance and cooldown are
  deliberately ignored -- measured against tier they track it weakly or backwards.
- **The tier weights are a judgement.** 1 : 1.66 : 2.30 is the geometric mean of flat
  and cost-proportional; the reasoning is in `RESUME-HERE.md`. If real builds suggest
  deep powers are still under- or over-valued, this is the table to move.
- **Pet stats are quarantined** in `grants.petOwnStats` and ignored. Scoring an actual
  pet build would mean converting them into player-facing value — a different objective,
  not a bug.

---

## Importing a character from a save file

Idea: read a `.gdc` save and use the character to seed the planner. Not started; this
is the feasibility work so it doesn't get re-derived.

### Verdict: feasible, and less of it is new code than it sounds

**The parser already exists, MIT-licensed, in a repo this project already clones.**
`iagd/Parser/Character/CharacterReader.cs` reads a whole character:

- `GDCharBio` — `Level`, `DevotionPoints` (unspent), `TotalDevotion` (earned),
  `SkillPoints`, `TotalStrength/Agility/Intelligence`, `Health`, `Energy`.
- `GDCharSkill` — each skill's DBR path, `Level`, `DevotionLevel`, `Enabled`, plus
  `IsDevotion` / `IsMastery` / `IsMasterySkill` / `PlayerClass` classifiers.
- `GDInventory` — equipment as base/prefix/suffix record paths.

The encryption is a table-based XOR stream (`GDCryptoDataBuffer`): key `0x55555555`,
a 256-entry table built by rotate-right-one then multiply by `39916801`. That is about
forty lines of JavaScript with no dependencies. Porting C# out of that repo is a road
already travelled — `scripts/port-labels.mjs` does it for `EnglishLanguage.cs`.

**The devotion mapping is a string join, not a matching problem.** `devotions.raw.json`
keeps `star.ref` as `records/skills/devotion/tier1_01a.dbr` — the exact string the save
stores in a skill's name, and exactly what iagd's `PATTERN_DEVOTION` matches. Worth
confirming against a real save, since some refs carry a `_skill` suffix, but there is
no fuzzy matching involved.

**It runs client-side.** `<input type="file">` plus `FileReader`, no upload, no
backend. Fits the static-site stack and makes the privacy story trivial.

### The reframe that makes it tractable

"Analyse the save and find the ideal path" sounds like a research project. It isn't,
because **the solver already does the optimising**. What a save can supply is the two
inputs: your point budget, and a starting set of tags. That decomposes cleanly, in
descending order of value per unit of work:

1. **Budget and current devotions — no inference at all.** Solve at *your* 23 points
   rather than a hypothetical 55, with what you have already bought pre-ticked. This
   is also the cheapest route into *Levelling-aware planning* above: that entry wants
   "solve at successive budgets", and a save hands you the real one.
2. **Masteries and skill investment → suggested tags.** Real inference, but the skill
   damage types live in DBRs the same pipeline already reads.
3. **Gear, conversions, actual damage numbers.** Where "ideal" overreaches — a 100%
   fire-to-chaos conversion inverts the answer, and that needs the damage-template
   composition work that is still outstanding.

### Two things that would bite

**Current stats describe what you HAVE, not what you want.** At level 30 a character's
damage is mostly gear they will replace within the hour, so weighting tags by current
output chases the gear rather than the build. Skill points invested in mastery skills
is the more defensible signal, because that is a deliberate long-term choice.

**It fights a stated value of this project.** The tool is a playground, not a
checklist. An import that *derives* your tags takes the decision away; an import that
*proposes* tags into the picker, which you then argue with, does not. Prefer the
second even where the first is technically available.

### Prerequisite, now known

Mastery inference needs `records/skills/playerclass10` — Berserker. The extract did
not have it until the `gdx3` gap was found on 1 Aug (see RESUME's *Game version*
section). Without it, a Berserker character would be **silently** mis-read rather than
loudly rejected, which is the worst failure mode available.

---

## Design tokens: pull CSS into `:root` custom properties

**Half done.** Font sizes (`--fs-*`, five steps) and colours (six families:
`surface` / `ink` / `line` / `accent` / `tint` / `af`) were tokenised on 1 Aug and are
committed; `COLOR-TOKENS.md` documents the palette. **Radii and border widths are
still literals at every rule**, which is what's left of this item.

The original case for doing it, kept because it applies just as well to the remainder:
the whole stylesheet is one `<style>` block, so "change the font sizes" meant finding
and hand-editing ~15 separate declarations rather than one variable. The colour pass
was mechanical — grep every literal, replace with the matching variable — a rename
rather than a redesign, and the page came out pixel-identical.

**Do the radius/border pass in one unsupervised stretch, not interleaved with other
requests.** It touches nearly every rule in the file, so it wants a single clean pass
with the tests run at the end, rather than mixed in with unrelated edits where a
mistake is harder to isolate.

**Read the trap in `COLOR-TOKENS.md` first.** A blind find-and-replace of a bare value
rewrites the token's *own* `:root` definition into `--x:var(--x)`, because the
definition line contains the same literal as the usage sites and nothing distinguishes
them. That bit nine of the colour tokens. Radius and border-width values (`6px`,
`1px`) are far more common strings than an `rgba()` and appear in `padding`, `gap`,
`width` and shorthand `border` declarations, so this pass is **more** exposed to it,
not less. Match on the property name, and re-read the whole `:root` block before
calling it done.

---

## Repo hygiene, before anything goes public

- ~~`labels.json` derives from iagd's `StatTranslator/EnglishLanguage.cs`, which is MIT.
  MIT requires carrying its copyright notice — add it.~~ **DONE, and it was already
  done when this line was written.** `THIRD-PARTY.md` reproduces iagd's notice in
  full; checked against `iagd/LICENSE` on 1 Aug and it matches verbatim. The entry
  survived because nobody re-read the file it was asking for.
- `devotions.raw.json` and `ui-index.json` are extracted from Crate's game files.
  Consider gitignoring them and having people generate from their own install.
