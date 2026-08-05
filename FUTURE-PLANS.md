# Future plans

Ideas deliberately deferred. Near-term work lives in `RESUME-HERE.md` under **Next**;
this is the further-out list, with enough reasoning recorded that a decision doesn't
have to be re-derived later.

---

## Actual vs suggested: what import turns this into — AGREED 2 Aug, not built

Worked out in conversation after v0.4.0 shipped import and it became obvious that
importing a character left you looking at nothing. Recorded in full because the
reasoning matters more than the conclusions and none of it is in the code yet.

### The problem import exposed

Importing Sparkles gives 52 ticked stars, no tags, therefore no plan, therefore nothing
drawn. Measured, not guessed: `off-plan: 52 of 52`. Ticks were only ever rendered where
they overlapped the current plan, so a character with real devotions and no tags shows
an empty screen.

### What it becomes

**Two devotion paths: ACTUAL and SUGGESTED.** Actual is what you own. Suggested is what
the tool recommends. You can still push the suggestion around however you like — tags,
presets, drag to reorder.

**Actual is not import-only.** Someone who has never imported but ticks stars as they buy
them has exactly the same data, entered by hand. So actual is "what you own", sourced
from either a save or clicking, and import merely fills it in faster and more accurately.

**There is therefore no import mode, and no playground mode.** Import versus blank is a
FACT about a character, not a choice: an imported one knows its level, budget, devotions
and gear; a blank one knows none of that. The UI shows more where it knows more. This
matters because the project already rejected a two-stage mode design once, in favour of
the lock, on the grounds that stages need a transition trigger, a wipe policy, a "you are
now in tracking mode" affordance and a ruling on which stage owns every control.

**Track versus evaluate IS a real question**, because only the player can answer it, which
makes it a control rather than a state. "What do I buy next" and "is what I have any good"
pull in opposite directions: the first wants your devotions to constrain the solver, the
second wants them left alone so it can propose something better.

### The lock still holds, and gains a rule

The lock protects INTENT. Re-import updates FACTS. Locked, you cannot change what you are
aiming for — but you can re-import, because that is not changing your mind, it is telling
the tool the world moved. Same shape as the existing rule that locked ticking stays live
because ticking is the point of being locked.

Consequence: **re-import largely replaces manual ticking** for anyone who imports. The
game already knows which stars you bought. Ticking becomes the fallback for people who
do not import, not the primary record of progress.

### Identity: match on the character NAME, stored separately from the display name

- **The UID is useless.** The 16 bytes after the header that `skipUid()` skips read as
  all zeros on a real save. Checked, not assumed.
- **Names are unique by construction.** Grim Dawn names each character's save folder after
  the character, and a filesystem cannot hold two folders with the same name in one
  directory. This is a mechanical guarantee rather than a design rule, which is why it is
  worth trusting.
- **Our app allows renaming; the game does not.** So the imported name must be stored as
  its own field -- `source: 'Sparkles'` beside `name: 'Sparkles (cold build)'` -- and
  re-import must match on `source`, never on `name`. Otherwise the first rename orphans
  the character from its save and the next import silently creates a duplicate. Cheap now,
  awkward after there are stored characters in the old shape.

### Import all

`webkitdirectory` on a file input takes a FOLDER and returns everything under it, with
the folder name preserved in `webkitRelativePath`. Point it at `save/main/` and every
character arrives at once; filter to files named `player.gdc`, since those folders also
hold map and quest data.

With `source` as the key this is safe to re-run: new characters appear, existing ones
update, nothing duplicates.

**It makes the old-save-format failure unavoidable and it must be per character.**
Chphthzhmh throws `unsupported skill-block version 5` -- inventory v4, stash v6, skills v5
against the current 11/11/8. One file at a time that is a confusing error; a whole folder,
one stale character would kill the batch. Report it per character with the actual remedy:
load it once in Grim Dawn, save, try again.

Two smaller notes. The directory picker raises a browser confirmation naming a file count,
which reads as an upload prompt though nothing leaves the machine -- worth a line of text
beside the button. And `showDirectoryPicker()` would remember the folder so "refresh all"
needs no re-picking, but it is Chromium-only and belongs as an enhancement rather than the
foundation.

### Things to get right

- **`state.done` changes meaning.** Today it is progress against the current plan.
  Promoting it to "the actual build, independent of any plan" is a data-model change, and
  stored characters hold `done` sets written under the old meaning. A deliberate v2 -> v3
  migration, not an accident.
- **The valuable output is the DIFF, not two columns.** Keep / buy / lose — what you have
  that the suggestion also wants, what you would need to buy, what you would throw away.
  That is the respec cost, and it is the evaluator half. Two paths side by side invite
  eyeballing; a diff answers the question.
- **A save records no purchase order.** Actual is exact as a STATE — these constellations,
  these stars, this affinity — but any path through it is reconstructed by our scheduler.
  Worth not implying otherwise, particularly since Crossroads refunds mean the real order
  may not even be reproducible.
- **`controls` becomes `presets`.** A module name, four CSS classes, two data attributes,
  a test file and the visible label.

**The UI is going to change** to accommodate this. Nothing above is built.

### What happens the moment a character is imported

Agreed 5 Aug. The app should immediately:

1. **Analyse what it can and auto-populate the target tags** with what the character is
   for, not with a guess at what they meant.
2. **Default to Balanced power scoring.** Note this is currently BROKEN and unrelated to
   import: `state.mode` initialises to 1 (Balanced) but `blankChar()` sets `mode: 0`, so
   every character actually starts on Passives. The initial state value only applies
   before a character loads.
3. **Show both paths** — actual and suggested.

Auto-populating tags looks like a reversal of "tags are deliberately not imported", and
is not. That rule was about INTENT, which a save cannot know. This proposes what the
character is BUILT FOR, which the gear states plainly — and it proposes, as presets
already do, landing in the picker where it can be argued with.

### Where the tag proposal comes from: gear, and it is unambiguous

**Equipped gear's % damage modifiers are the signal.** Measured on three characters:

```
Farker (34)        Cold +184%  Frostburn +104%  Elemental +55% | cliff | Pierce +30%
Sparkles (80)      Lightning +1072%  Electrocute +844% | cliff | Cold +104%
Chphthzhmh (100)   Lightning +255%  Electrocute +255%  Physical +232%  Trauma +232%
```

Every field maps to an existing browsable chip by stripping `Modifier` and prefixing
`character:` — `offensiveLightningModifier` -> `character:offensiveLightning` ->
"Lightning Damage". No new machinery.

**This kills the conversion objection that sank "all out damage".** The worry was that a
skill declaring cold damage might be converted to fire by gear, making the tag wrong. But
nobody stacks +110% Lightning Damage unless lightning is what they deal. Gearing choices
are made AFTER conversions, so the gear already reflects post-conversion reality. The
signal that looked blocked was never affected. (`conversionPercentage` is also readable
on items, for when it is genuinely needed.)

Also found in the same scan: `augmentSkillLevel1/2/3` is the **+N to skills** mechanism,
which is where Oak Skin's "4 + 3" comes from. Effective skill ranks are computable.

**Take a THRESHOLD, not a fixed five.** A count fills empty slots with noise — Sparkles'
Cold at 104% is a stray affix on a piece worn for something else, and the solver would
dutifully spend points chasing it. Something like "take strengths until the next falls
below a fraction of the leader" gives Farker three and Sparkles two. Same principle as the
equaliser already ignoring a resistance at or above 75.

The threshold only earns its keep on lopsided builds. Chphthzhmh's distribution is flat
(255/255/232/232/190, no cliff) so all five slots go to damage types — which is arguably
correct, since every one of his resistances is overcapped and he has nothing to fix.

**Weak resistances fill whatever slots the strengths do not earn**, weighted inversely as
`resistWeight()` already does. That is what stops the padding. Farker comes out as Cold,
Frostburn, Elemental, Vitality Resistance, Chaos Resistance — a fair brief for a
mid-level cold caster.

**Damage types come in pairs and each pair eats two slots.** Lightning and Electrocute are
one build concept, a type and its damage-over-time counterpart; so are Physical and
Internal Trauma. Chphthzhmh's five tags are really three ideas. Worth collapsing, or at
least not proposing both at equal weight.

### The active weapon set is ONE BYTE — the item parse is not a prerequisite

The offset scan cannot tell an equipped item from the alternate weapon set, and weapons
carry the largest damage numbers, so this looked like it blocked the whole tag proposal.
Demonstrated on Sparkles: her "Bleeding Damage +100%" was entirely phantom, coming from
`d101_gun2h` — a weapon she was not holding.

**Measured by experiment rather than parsed.** The equipment tail begins with one byte
before the first item. Farker was switched between weapon sets in game with nothing else
changed, and it moved in both directions:

```
tail[0] == 0   ->  weapon set 1 in hand   (axe + scepter)
tail[0] == 1   ->  weapon set 2 in hand   (gun + focus)
```

Weapons are identifiable by their `gearweapons/` path and arrive in slot order, so the
active pair is the first two or the last two. That is enough to drop the inactive set
without identifying the item record's unknown fields.

**A warning about the diff that found it.** Decrypting the tail with byte-at-a-time reads
produces the TRUE plaintext only at offset 0. The game wrote the tail as mixed ints,
strings and bytes; an int is one 32-bit XOR against a single key value, so reading its
four bytes individually XORs each against an advancing key and yields nonsense — and
since every save has a different seed, the nonsense differs between saves. That is why
868 bytes appeared to change when only a flag had moved. Everything before the tail is
read with correct types, which is what makes offset 0 trustworthy and nothing after it.

### 2H weapons duplicate their SOCKETABLES in the save — dedupe within an item

Sparkles' guns listed their components and augments twice; Farker's 1H weapons showed
nothing of the sort. Tested directly: a 2H sword was equipped on Farker with a single
Searing Ember socketed, and the save stores it **twice**:

```
15. gearweapons/melee2h/c102_sword2h.dbr
     + materia/compa_searingember.dbr
     + materia/compa_searingember.dbr
```

The BASE record appears once; only socketables repeat. Presumably a two-hander occupies
both weapon slots and the game writes the component into both records, with only the
main-hand one carrying a base name.

**It applies once, so it must be counted once.** Confirmed twice over: the game's own
tooltip lists Searing Ember's effects a single time, and the community position is
explicit that a 2H weapon has one component slot and one augment slot with no doubling —
the trade-off being higher base weapon damage instead of a second slot.

**Fix: deduplicate record paths within a single item's span.** Safe because an item has
one component slot and one augment slot, so a repeat inside one item is always this
artifact. Legitimate duplicates survive, since they sit on DIFFERENT items — Sparkles has
`compa_resilientchestplate` on both her torso and her shoulders, and both are real.

Impact is smaller than it first looked: a weapon's own numbers sit on the base record and
were never inflated. Only socketable stats doubled. Sparkles' `hellbaneammo` at +25%
Lightning was counted four times rather than once, against a 1072% total, so her ranking
would not have moved — but a build leaning on components would have been skewed.

### What gear reading needs, in full

With the three findings above, none of the item record's unknown fields are required:

1. `tail[0]` selects the active weapon set
2. Weapons are identified by `gearweapons/` path and arrive in slot order, so the active
   pair is the first two or the last two
3. Record paths are deduplicated within each item's span

### Physical resistance is EXCLUDED from automatic weighting — measured

It came back "DIRE" on all three characters, including Farker at 0, which is entirely
normal at level 34. The reason is not that the thresholds are miscalibrated. It is that
**physical is not a stat devotions can move**:

| | stars granting it | total available in the tree | median per star |
|---|---|---|---|
| **Physical** | 16 | **58%** | **4** |
| Vitality | 18 | 254% | 15 |
| Elemental | 17 | 223% | 15 |
| Acid | 10 | 147% | 15 |

Plenty of stars grant it, in useless amounts — four against fifteen, and 58% total across
the whole tree where the others offer 150-250%. A real build might scrape 8-12% out of
devotions. So flagging it as dire proposes a fix that does not exist.

`resistWeight()` should therefore never weight it, and the equaliser should stop asking
for it (a control that silently ignores one of its ten inputs is worse than one that does
not ask). It remains available as a tag anyone can pick by hand.

Where physical actually belongs is with armor and defensive ability in the **turtle**
preset — a defensive stat you nudge rather than a hole you plug — and its real source is
gear, shields especially.

### Old saves fix themselves; the error message is the whole feature

**Confirmed by experiment.** Chphthzhmh would not parse — inventory v4, stash v6, skills
v5 against the current 11/11/8. Loading him once in Fangs of Asterkarn and saving rewrote
all three to current, the file grew 58,551 -> 67,291 bytes, and he now imports cleanly
with 55 devotions and 151 skills.

So supporting historical block layouts would be work with no user at the end of it. What
is needed is to detect the failure and say the remedy: *this character has not been
played since a game update — load it once in Grim Dawn, save, and try again.*

### Layout: the controls column goes

The leftmost column was always provisional ("for now let's just make a new column").
**Presets move into the tag picker**, which is the right home since presets exist to
produce tags and the picker is where tags come from — and it gives back the width that
made three columns cramped.

**The picker needs reorganising** as its own piece of design. It currently has
character/pet tabs and expandable categories, and presets are neither a chip nor a
category, so wedging them above the tabs is not the answer.

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
- **Within-tier power ranking stays flat, and that is now a decision rather than a
  blocker.** Every tier-2 power scores the same. This was recorded as waiting on effect
  magnitudes; those arrived on 1 Aug, so it was measured, and the answer is **don't**.

  The metric tried: score each of a power's effect lines against the largest value ANY
  power shows for that same template, then sum. Unit-free by construction -- it never
  adds a percentage to a flat value, it compares like with like. Spread within tier is
  enormous, which at first looks like exactly the signal wanted: 5.8x in tier 1, 14.8x
  in tier 2, **109.8x** in tier 3.

  It is measuring the wrong thing. The score tracks **how many stat lines a power's DBR
  happens to expose**, not how good the power is, and three counter-examples make that
  undeniable:

  - **Time Dilation** scores 0.27 of a possible 10.25 — last but one in tier 3. Its
    entire fxp payload is `{v} Seconds Skill Recharge`, which is *its own cooldown*.
    Reducing all your skill cooldowns, the thing it is famous for, appears nowhere in
    its record: the six fields it carries are camera shake, refresh time, its cooldown,
    the XP curve, and two level caps.
  - **Elemental Seeker** scores **0.09**, dead last of 21. It is a summon, its
    `grants` is `kind=pet` with **zero** stat fields, and `fxp` excludes pet grants —
    so the index knows literally nothing about what it summons.
  - **Living Shadow**, also a summon, scores 0.70 for the same reason.

  Meanwhile **Hungering Void** tops tier 3 at 10.25 with 11 lines, which is honest — it
  is a stat-dense buff with 15 fields — but it is winning on line count.

  So ranking on this would systematically demote summon powers and utility powers, and
  the solver would then avoid them. **A confidently wrong ranking is worse than a flat
  one**: flat says "we don't know", and the tier weights already carry the part we do
  know. Chance and cooldown stay ignored for the reason recorded before — measured
  against tier they track it weakly or backwards.

  **What would have to change first**, if this is ever revisited: extract the summoned
  creature records so a summon's value is representable at all, and find where a
  cooldown-reduction power like Time Dilation actually expresses itself, because it is
  not in the star's stats. Until both exist, there is nothing to rank.
- **The tier weights are a judgement.** 1 : 1.66 : 2.30 is the geometric mean of flat
  and cost-proportional; the reasoning is in `RESUME-HERE.md`. If real builds suggest
  deep powers are still under- or over-valued, this is the table to move.
- **Pet stats are quarantined** in `grants.petOwnStats` and ignored. Scoring an actual
  pet build would mean converting them into player-facing value — a different objective,
  not a bug.

---

## Coverage becomes an info and stats panel

Coverage answers one question well: how much of each tag you got, against the most you
could have got. Everything else the build knows about itself has ended up scattered, or
has nowhere to live at all.

**What prompted it.** The build summary spent a day being moved around because it had no
home. It was in the Target tags header, which was about your inputs rather than your
result; then briefly in the Devotions header, where it wrapped onto three lines; now
folded into each view's totals line at the foot of the list. That last is defensible and
the split is gone, but it also pushed "solving" to the bottom of a scrollable list where
it can be out of view while a solve runs. The Coverage panel dims itself throughout,
which is the only feedback that stays put — a hint that the panel is already doing this
job informally.

**What a stats panel could carry**, roughly in order of how obviously it belongs:

- The build summary itself: constellations, points, celestial powers, first tagged pick,
  final affinity, and whether it is proven optimal. Currently duplicated across the two
  views' totals lines with slightly different wording each.
- **Solve state**, in a fixed place. The reason this is worth doing at all.
- **What the build gives you, totalled** — the magnitudes now shown per tag, but for
  stats you never asked for. A build has plenty of incidental Health and resistances,
  and nothing shows them.
- **Affinity held versus required**, which currently only appears as orbs in a ledger
  between cards, and in the totals line as text.
- **Points spent per tag**, which is the honest answer to "is this tag worth keeping"
  and is not derivable from the star count alone.
- **What it cost you**: how many points went on affinity plumbing rather than on
  anything you asked for. Overview's run of `○` marks says this obliquely.

**What to be careful of.** Coverage earns its space because it answers one question and
answers it in one glance, and several of its rules exist to keep it that way: colour
means exactly one thing, everything right of the tag name is fixed width, and the weight
was deliberately removed once because it was already stated elsewhere. A panel that
accretes six readouts loses that. If this happens it wants sections with their own
headings rather than more rows of the same shape, and probably a decision about which
parts are always visible against which are behind a disclosure.

**Not urgent.** The information is all reachable today; it is just spread across a
totals line, a ledger, orbs, and tooltips. This is consolidation, not capability.

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
