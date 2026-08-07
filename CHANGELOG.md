# Changelog

Versions start at 0.2.0, which is the state the tool had reached when numbering began
rather than a release. Patch numbers move with each commit; the minor number moves when
a piece of work is finished and agreed.

## 0.7.3 — 6 Aug 2026

**Adopting and locking are one action.** They were two buttons pressed one after the other
in every case that mattered, and the gap between them was pure hazard: adopting clears
your ticks and hands you a fresh path to walk, which *is* the locked workflow — so anyone
who adopted and didn't think to lock was one stray click from wrecking the build they had
just committed to. The checkmark now means *follow this*.

It also works while locked, which is exactly when you want it: you lock a build to follow
it, play, re-import — which the lock already allows, since that reports facts rather than
changing intent — and find the suggestion has moved. It used to refuse **silently**: a
live-looking button that took the click and did nothing.

**The lock moved to the left column**, over the things it freezes. It spent its life in the
Devotions header on the right, which was always the wrong side — what it makes read-only is
tags, weights, scoring and Reset, every one of them in the left pane, and the scrim it
draws when engaged falls over that column. The button sat apart from the only visible sign
of its own effect. It renders outside the pane it dims, because a control that fades along
with what it disabled is the one control that must not.

With both, no dialog is needed: the two buttons *are* the choice. The checkmark follows the
suggestion, the lock keeps your own build.

**Undo now reaches the adopt, and nothing else past the lock.** The general rule stands and
is right — undo restores a whole snapshot, so one keystroke can reach far past the frontier,
and stopping that is what the lock is for. But the adopt is what *engaged* the lock, and its
own tooltip promises Ctrl+Z reverses it; refusing made the promise false in the one case
anybody would test. A tick made while locked stays frozen even with an adopt underneath it
in the stack. Snapshots carry the lock with them, so undoing restores it as it was rather
than leaving it stuck either way.

## 0.7.2 — 6 Aug 2026

**The suggested column said 57 stars for a character whose maximum is 55.** The path buys
two Crossroads as stepping stones and refunds them once what they unlocked is paid for;
the total was summing what the path *spends* rather than what it ends up *holding*. Those
are different numbers and only one of them can be compared against a build. Refunds are
now applied, and anything netting to nothing is not a row at all — showing "Crossroads 0"
beside a build reports a decision nobody made.

The test guarding this contradicted its own name: it was called *refunded Crossroads are
NOT part of what you own* and asserted that they were. The name had it right.

That fix needed a matching one, because the two questions differ. The columns compare END
STATES. But *is there a decision here* has to be asked of the path AS WALKED — someone
part-way through, holding a Crossroads the plan will refund later, is following the plan,
and measuring them against the end state made them look like they were giving something
up. They'd have lost their tickable path to a diff saying so.

**The devotions header is icons only, and shows only what you can act on.** It used to mix
two word-buttons with two icons and render the dead ones greyed, making a five-button strip
out of what is usually two or three live controls — with every word competing with the
heading beside it. A disabled button is an offer you can't accept: same space, same
attention, to tell you no.

- Overview — aeroplane, for the whole path at a glance
- Detail — magnifying glass
- Compare — columns
- Adopt — checkmark, and the only one keeping an outline, because it is the one action
  that changes the build rather than the view
- Clear order and Clear progress appear only when there is something to clear

The lock is the exception and always shows: a mode you can enter but not leave is a trap.

## 0.7.1 — 6 Aug 2026

**The resistance thresholds were endgame thresholds applied to everybody.** 45/60/75
describe a level 100. Applied to a levelling character they call ordinary progress an
emergency — a level 35 sitting on 32 aether is fine, because gear turns over every few
levels and Normal hits nothing hard enough to care.

The whole scale now slides with level:

| level | dire below | fine at or above |
|---|---|---|
| 25 | 12 | 19 |
| 35 | 16 | 27 |
| 50 | 23 | 38 |
| 80 | 36 | 60 |
| 100 | 45 | 75 |

At level 35 that puts the line where a player would put it — single digits, or under
twenty at a push. Sparkles and Chphthzhmh are untouched; Farker stops being told about a
resistance that was never a problem.

Linear, and deliberately not a curve fitted to anything. There is no measurement behind a
particular shape — what there is, is the judgement that the targets are endgame targets,
and linear says "proportionally less of a concern earlier" without inventing precision.
Level scales the bar, difficulty scales the value; a level 80 in Elite gets both, which is
right, because both are true of her.

Caught while writing the tests: a non-positive level collapsed every threshold to zero, so
`value >= 0` held and a character with **no resistance at all** read as comfortable. The
most dangerous possible input scoring as the safest is precisely the failure this scale
exists to prevent. A level that isn't a level now means no scaling.

## 0.7.0 — 6 Aug 2026

**Resistances are derived.** The last unbuilt piece of the analysis pipeline. Import now
reads all nine sheet resistances and proposes the weak ones, weighted against the
difficulty you're planning for. This is what the resistance equaliser used to ask nine
questions to learn.

Sparkles, level 80 in Elite, reads:

```
fire 170  cold 170  lightning 170  chaos 148  bleeding 69
aether 63  vitality 33  acid 32  pierce 30  physical 6
```

and gets **Pierce Resistance — "Pierce at 30, which is 5 on elite"** and **Acid Resistance
— "32, which is 7 on elite"** alongside her Lightning build. Chphthzhmh at level 100 in
Ultimate is overcapped everywhere but chaos, and gets exactly one resistance tag for it.

**The third source cost nothing.** Gear and skills were the obvious two; what your devotion
stars already grant was recorded for weeks as "needs new index data". It needed none —
devotion stars *are* skills, they sit in the save's own skill list, and the skill index
picked up all 52 of Sparkles' without being asked.

**Enemy debuffs were being subtracted from the player**, which is the bug that made this
worth doing carefully. Grim Dawn writes a debuff exactly like a buff — same fields, same
per-rank arrays — and distinguishes them only by class. Bone Chilling Cry carries
`defensivePierce: -4`, meaning four pierce resistance stripped from *enemies*; folding it
into the caster took four off their own. Veil of Shadows did the same with −3 to −35. Each
record now carries who its numbers land on: the character, one skill, or the enemy.

**Skill-scoped bonuses count for strengths but not for resistances**, and the two rules
disagree on purpose. "+15% pierce resistance while this skill is active" is not armour on
the sheet. But points spent on a modifier adding cold damage to your main attack say "cold
build" as loudly as anything character-wide — nobody invests in a modifier by accident.

Known approximation: fire, cold and lightning are read from the single elemental field.
Single-element resistance exists on items but is rare — 11 of 1218 base items against 284
carrying elemental — and belongs to chips the picker can't offer, so the index doesn't
carry it. The effect is to understate an individually topped-up element, which errs
towards proposing elemental resistance slightly too eagerly. The cost is a tag you can
remove rather than a hole you were never told about.

## 0.6.2 — 6 Aug 2026

**Retaliation is a damage type**, and leaving it out meant misreading an entire archetype.
The pattern was `^offensive…Modifier$` — every kind of damage a character deals on attack,
and nothing about damage dealt on being hit. Total Retaliation Damage spans **29 stars** in
this tree, with Physical, Acid and Fire Retaliation beside it. It is not a fringe pick.

Found by measuring three characters instead of one. A level 100 carries **1540%
retaliation across 20 sources** — more than double his next stat — and was being proposed
Internal Trauma, Physical, Lightning, Electrocute and Total Damage, with no retaliation tag
anywhere. He now reads *Total Retaliation Damage, Internal Trauma, Physical*: a coherent
retaliation build, and three tags rather than five, because a real lead at 1540 correctly
cuts what was noise beside it.

Checked rather than assumed: the scale test that justifies the whole restriction passes.
Median rolls are `retaliationTotalDamageModifier` 40 against cold 50, physical 42,
elemental 40.

Two other things three characters showed that one could not:

- **Casting speed scores below average on all three** under base-rate correction — 0.8x,
  0.7x, 0.3x. That metric is dead, confirmed.
- **Run speed scores high on all three** — 6.8x, 4.7x, 6.6x — for characters with nothing
  in common. Everyone wears boots and 73.9% of boots carry it, so dividing by a *global*
  1.9% prevalence makes every character look focused on it. That's direct evidence for the
  per-slot hypothesis recorded in 0.6.1, and against the global one.

## 0.6.1 — 6 Aug 2026

**A claim repeated three times in this codebase was false.** The justification for ranking
only damage types said, in a code comment, a test and two changelog entries, that
count-based metrics fail because *armour rolls movement speed by default*.

Measured against the index that was sitting in this repository the whole time: movement
speed is on **1.9%** of the 14,008 items. It is a boots stat — 73.9% of `gearfeet`, 19.5%
of legs, 0.3% of torso, 0.3% of weapons. Nothing rolls it by default.

The character it supposedly led on "wrongly" had 29% across four sources, and decomposing
them settles it better than either of the stories told about it so far:

| source | % | how avoidable |
|---|---|---|
| boots | 12 | 73.9% of boots grant run speed — near-forced |
| Mark of the Traveler | 8 | 2 of 9 boots components available at his level |
| Chains of Oleron | 6 | **1 of 20** chest components |
| a suffix affix | 3 | random roll, not chosen |

So about half was chosen — Chains of Oleron unambiguously, being the only chest component
of twenty that grants it — and about half came with the slot. "He stacked it deliberately"
was too strong; so was "the metric was reporting noise".

**The sharper claim, which is the one that should have been made all along, is per-slot.**
Not "armour rolls movement speed by default" but "some slots overwhelmingly carry certain
stats, so the slot forces the stat": run speed is 73.9% of boots and 0.3% of torso. The
global base rate of 1.9% averages that distinction away, which may be exactly why the
base-rate metric failed. Worth measuring properly rather than asserting — again.

Commonness doesn't separate the stats in question anyway: casting speed is on 10.2% of
items, cold damage 11.2%, Offensive Ability 19.7%, Damage Absorption 20.4%.

**What survives is the scale argument, alone, and it is measured.** Median rolls are cold
50%, physical 42%, elemental 40% against casting speed 8% and attack speed 8%. Damage
types agree with each other within a factor of 1.25 and disagree with speeds by more than
6×. Restricting the ranking to damage types is sound for that reason and no other — it is
a limit of what a sum can compare, not a claim that speed stats are noise.

The base-rate failure is real and still holds: re-measured on values rather than counts, a
deliberate casting-speed build scores **0.8x** — below average — because caster gear rolls
casting speed, so the base rate already contains the intent.

There is now a test asserting the prevalence figures directly, so the reasoning can't drift
back into fiction.

## 0.6.0 — 6 Aug 2026

**Skills count.** A new `skills-index.json` carries what every skill grants at every rank
— 7,097 records, 856 KB, 125 KB gzipped — joined against the ranks already read from the
save. Gear says what a character is *equipped* for; skill points say what they were
*spent* on, and gear is chosen from what dropped while skill points are not.

The difference is not decorative. On a real character:

| damage type | gear | + skills | combined |
|---|---|---|---|
| Cold | 192 | +109 | 301 |
| Frostburn | 104 | +91 | 195 |
| **Pierce** | 30 | **+70** | **100** |
| Bleeding | 49 | +27 | 76 |
| Elemental | 55 | — | 55 |

Pierce was invisible — 30% on gear, under the threshold — and is a clear third once skills
count. Elemental drops out. Ranking on gear alone was ranking half the character.

**Toggled buffs keep their stats somewhere else**, and missing that would have made the
index quietly wrong exactly where it matters. Amatok's Pact and Veil of Shadows declare
nothing themselves; they are `Skill_BuffRadiusToggled` with a pointer to a `_buff` record
holding every number. Auras are where a build keeps its passive damage, its resistances
and its casting speed. The build script follows the pointer and folds the buff into its
parent, because a save names the skill and never the buff.

Ranks are clamped rather than interpolated: a level past the end of a skill's value list
takes the last one. That happens for real — gear grants +N to skills — and it means the
reading UNDERCOUNTS a well-geared character. That's the honest direction for the error,
and modelling effective rank is the obvious next step now the per-rank data is here.

Not counted, both deliberately: shapeshift skills, whose stats apply only while
transformed, and skill modifiers, which alter another skill rather than the character.

## 0.5.4 — 6 Aug 2026

**Occurrences qualify, percentages rank.** A stat must appear on at least two equipped
items to be taken seriously; the summed percentage then orders what's left. The two
numbers answer different questions — a sum says how much, a count says how deliberate —
and one huge roll looks identical to a stat the whole kit is built around until you count
the slots.

Ranking by count outright was measured and is worse: with twelve slots the counts run 1–3,
so a one-item stat sits at 0.33x of a three-item leader and the 0.25 threshold cuts
nothing. On the earlier save it kept **all nine** damage types. The percentages have the
dynamic range; the counts have the meaning.

The note in the code claiming count-based ranking had already been rejected was answering
a different question: that measurement was over *all* modifiers, where movement speed
dominated. Within damage types it had never been run. (The *reason* given for movement
speed dominating was also wrong — see 0.6.1.)

Reasons now carry both numbers — "192% across 8 equipped items" — because the count is the
test the stat had to pass, and reporting only the sum hides it.

**The comparison no longer flickers.** An imported build always has one. Deciding purely
from the diff meant the whole view appeared and disappeared as the scoring mode changed:
measured on the save, mode 0 produces a plan that is a superset of the character's build
while modes 1 and 2 drop two constellations. A build that came out of the game is worth
comparing even when the answer is "everything you have is endorsed" — keeping 3 and buying
12 is the useful reading of that. **Adopt** now ends the comparison, since adopting is the
decision it was asking for.

## 0.5.3 — 6 Aug 2026

**Attribute points now speak first.** They are the only pure statement of intent in a
save: every other signal is contaminated by what dropped. A helmet worn for its
resistances brings its damage modifiers along whether or not they were wanted, so reading
gear is always partly a report on the loot table. Nothing drops attribute points. Farker's
gear grants 23% casting speed against 15% attack speed — near-noise either way — while his
allocation is 0 Physique, 0 Cunning, 26 Spirit. Unanimous, and previously ignored.

So a committed attribute takes the first slot ahead of every damage type, and Farker now
imports as Spirit first. It only speaks when **lopsided** — 70% of the points or more,
and at least ten of them. An even 12/10/11 is someone meeting a gear requirement, not a
build statement, and proposing devotion points chase attributes off the back of that
would be inventing intent. A level 6 with everything in one attribute is a sample size,
not a decision.

Read from the bio's BASE values, not the character sheet: the sheet's numbers already
have mastery, gear and devotion added on, which would put the contamination straight back
into the one signal that has none. Verified — spent plus unspent comes to exactly
level − 1.

**The comparison was vanishing on import**, and for the characters it exists to serve.
Whether there is one to show was tested at whole-constellation level only, so once tags
are derived from your own gear — and the suggestion therefore lands on the constellations
you already picked — the test came back false. What is left to decide in that case is
depth, and depth is where the points are. It now counts a constellation the plan takes
less far than you already have.

## 0.5.2 — 6 Aug 2026

**Import now fills the picker.** It reads your equipped gear, ranks what the build is
actually for, and puts that in the target tags — Farker arrives with Physical, Internal
Trauma, Pierce, Elemental and Cold rather than an empty picker. This was the missing half
of import, and its absence looked like two separate bugs: with no tags there is no plan,
so there was nothing to compare a build against. The diff visible for a moment after
importing was the *previous* character's plan still on screen, and the first re-solve
took it away with no way back.

**Every proposed tag says what put it there** — an info icon on the pill reading "92% on
your gear". A proposal you cannot interrogate is one you have to take on trust, and
"Internal Trauma Damage" arriving unbidden reads as a bug until you learn it is 80% of
what your gear grants.

**Re-import never overwrites tags you chose.** It proposes only into an empty picker.
Re-import exists to update what the game says — ticks, level, points earned — not to
overrule what you decided.

Resistances are still not derived, so the proposal is the strengths half only and no
resistance tag is offered. `resists: null` says *unknown*, which is the truth; passing
zero would read every resistance as dire and fill all five slots with holes the tool
cannot actually see. Below level 25 the analysis declines and says why.

Two smaller things behind these. The test suite's `fetch` stub ignored the URL and handed
back `ui-index.json` whatever was asked for — harmless while only `classes.json` was
affected, but it would have quietly disabled the gear analysis and left the tests passing.
And `keywords.json` and `items-index.json` are now loaded at startup; both are optional,
and a missing one degrades to "no automatic tags" rather than a broken app.

## 0.5.1 — 6 Aug 2026

**Your build beside the suggestion.** Two columns — what you actually own on the left,
what the tags propose on the right — with every row marked as one you keep, one you would
buy, or one you would give up. A kept constellation taken to a different depth says so on
the row, because a whole-constellation view would call that free. Above them a summary
line states the price in points, and separates what switching costs from what you can
spend right now. **Adopt** turns the suggestion into the plan; it clears your ticks,
because they recorded progress against the build being replaced, and Ctrl+Z puts them
back.

**Compare is a view, not a mode**, and the distinction was bought the hard way. The first
version let the comparison REPLACE the path whenever your build and the plan disagreed,
which silently took away the stars you tick as you buy them — change one tag mid-
playthrough and the thing you used every session was simply gone. It now sits beside
Overview and Detail: it opens on its own when there is something to decide, one click
puts the path back, and leaving it is an answer that sticks. Switching character asks
again, since it was an answer about that build against that plan.

The button only appears when there is a disagreement to look at. A Compare button that
showed you two identical columns would be a button that lies about having something to
say. Following a plan you made here is not a decision to be shown a diff about; owning a
build the plan does not contain is.

## 0.5.0 — 5 Aug 2026

**Back to two columns.** Everything you set and everything you read about your inputs is
on the left; the devotion path is on the right. The separate controls column added in
v0.3.1 is gone — presets belong in the tag picker, because a preset exists to produce tags
and the picker is where tags come from, and folding them back returns the width that made
three columns cramped.

**Presets are a third tab beside Character and Pet**, one at a time. That is a UI
simplification rather than a limit: `applyControls()` still combines any number and merges
on the higher weight, because stacking "shore up my resistances" with "push what I already
have" was the common case, and undoing this is a one-line change.

**The resistance equaliser is gone.** It asked nine questions to tell you something it
could work out. A hand-built character just picks the resistance tags directly. What it
taught survives and is still the single source of what counts as a dire resistance.

**Collapse-all** on the Tag library title, folding every open category. It disappears when
nothing is open, since a control that does nothing is worse than one that is absent.

**The top bar carries the character.** Level and class where a save told us, and the
difficulty you are planning for — which belongs beside the character because it changes the
advice rather than the display. Both are per character.

## 0.4.8 — 5 Aug 2026

**Progress now means the build you actually have.** It used to mean progress against the
current plan, and was only ever drawn where the plan happened to contain that star — so a
character whose real devotions differed from their tags appeared to have lost them. That
is what makes an actual-versus-suggested comparison possible at all.

Stored characters migrate from v2 to v3. The shape does not change, and every tick was a
star really bought, so the set carries across unchanged — what changes is what the app is
entitled to conclude from it. The v2 key is left in place as a free undo, for the same
reason v1 was.

**Re-importing a save updates that character instead of creating another.** Matched on the
game's own name, which is unique because Grim Dawn names the save folder after the
character and a filesystem cannot hold two folders alike. Never on the display name, which
this app lets you edit and the game does not — matching on that would mean the first rename
orphans a character from its save and the next import silently duplicates it.

That is what makes re-import the tracking action: play, re-import, and your progress is
whatever the game says it is.

## 0.4.7 — 5 Aug 2026

**The cost of switching builds can be computed.** `diffPaths()` reduces two devotion
paths to what you keep, what you would buy, what you would give up, and the points it
takes. Not rendered yet — the UI that shows it is specified in FUTURE-PLANS and not
built.

Compared by constellation rather than by star, because that is the unit of a devotion
decision: the real question is whether you are in Owl at all, not whether you keep four of
its five stars. Where both paths take one to different depths, the difference is carried
on the row and costed.

Two things it is careful about. A Crossroads bought as a stepping stone and later refunded
is not something you own, so refund steps are dropped — counting them would inflate both
sides and make every number wrong while looking entirely reasonable. And the headline is
the **net**: "spend 24, get 6 back" makes you do arithmetic that "18" does not.

**Switching and completing are told apart.** A finished character adopting a suggestion is
doing a respec, decided now. A levelling character has most of the path still ahead, and
the same number is the rest of the game rather than a cost. Measured on a real level 34:
45 "points to switch" against the 1 point he actually had spare.

## 0.4.6 — 5 Aug 2026

**Resistances are weighted against the difficulty you are planning for**, not the one your
numbers came from. Walking into Elite or Ultimate on resistances that were adequate a tier
below is the most common way a working build stops working, and the tool now says so
before it happens.

The mechanism is the game's own penalty rather than a second scale invented for it. Acid
at 58 reads 33 on Elite and 8 on Ultimate, so weighting the penalised number makes the
thresholds harshen by themselves. The penalty is staggered, not flat — acid and pierce
take theirs at Elite, while vitality, aether, chaos and bleeding wait until Ultimate — so
the advice changes shape between tiers rather than just getting louder.

A consequence worth knowing: **80 across the board is comfortable on Veteran and in real
trouble on Ultimate**, where it reads 30 on the top row. That is not the tool
over-reacting; it is why endgame builds overcap past 130.

**A character below level 25 is not analysed unless asked.** Nothing technical stops it —
the answer just is not useful yet. Gear turns over every few levels, resistances are
whatever dropped, and there are too few devotion points to fix any of it. It declines with
its reason rather than silently doing nothing, and runs anyway if you ask.

Difficulty parsing has also moved onto the main line, so a save's own difficulty can serve
as the default.

## 0.4.5 — 5 Aug 2026

**An imported character can be turned into a starting set of tags.** `proposeTags()`
composes what the character is built for with what it is missing. Still not wired to the
UI.

The rule is that **strengths take the slots they earn and weak resistances fill the
rest** — neither side gets a fixed allocation, because a fixed one is wrong for most
characters. A mid-level cold caster comes out as Cold, Frostburn, Elemental, then
Vitality and Chaos Resistance for the two holes that would actually kill him. An endgame
character with every resistance overcapped gets all five slots for damage, which is the
honest answer rather than a failure to find anything defensive.

Weakest resistances go first when slots are scarce, so points land where it hurts most.
Anything at or above target is not proposed at all, which is what stops a well-defended
character being handed busywork. Fire, cold and lightning collapse to one tag driven by
the weakest of the three, since they share the only chip the tree offers.

Every tag carries a reason — "184% on your gear", "Vitality at 36" — because a proposal
you cannot interrogate is one you have to take on trust. And anything crowded out is
named rather than quietly dropped.

## 0.4.4 — 5 Aug 2026

**Strengths are read from damage types only**, and the reason took four measured attempts
against real characters.

Summing every percentage modifier put Movement Speed +35% in the same ranking as Physical
Damage +92% — not the same kind of number, since +35% movement speed is enormous and +35%
damage is modest. Counting how many items carry a stat instead rewarded whatever is
*common* on gear. Dividing that count by how often the stat appears across all 14,000
indexed items measured *unusual* rather than *intentional* — a player deliberately stacking
casting speed scored exactly average.

> **Corrected in 0.6.1.** This entry originally said movement speed led "because armour
> rolls it by default". That is false — it is on 1.9% of items — and the character it led
> on had genuinely stacked it.

Percentages were never the problem; mixing kinds of stat was. Within damage types the
numbers are commensurable, and a mid-level cold caster reads as Cold, Frostburn and
Elemental with a clean cut.

**Casting speed joins the meta offense preset**, where it belongs alongside offensive
ability, attack speed and crit damage. That is the honest home for it: a stat can be both
common on gear and deliberately pursued, and no automatic measure separates those. Intent
is the thing only the player can supply.

## 0.4.3 — 5 Aug 2026

**What a character is built for can now be read off their gear.** `strengths.mjs` tallies
every stat on the equipped items and ranks what the build is actually about. Not wired to
the UI yet.

Gear rather than skills, and the reason is the interesting part. An item converting
physical damage to fire makes a skill's declared damage type false, which is what sank an
earlier attempt at this. Gear does not have that problem: conversions happen upstream of
gearing choices, so nobody stacks +110% Lightning Damage unless lightning is what they
end up dealing. The percentages already describe the post-conversion reality.

A **threshold rather than a fixed count** — a strength has to be worth a quarter of the
biggest one. "Take the top five" fills empty slots with noise, and the solver would spend
real points chasing a stray affix on a piece worn for something else. Farker comes out as
Cold, Frostburn and Elemental; a character with a flat spread gets five, which is the
honest answer when there is nothing to distinguish.

Only percentage modifiers count. A flat +8 cold on a weapon is a rounding error; a +110%
modifier is a deliberate choice.

## 0.4.2 — 5 Aug 2026

**A save's equipped items can be read.** `readEquipment()` returns the twelve worn slots
and both weapon sets, and `equippedRecords()` flattens that to just what the game is
actually applying. Nothing uses it yet; it is the foundation for reading a character's
strengths off their gear.

The item layout was derived rather than ported. The reference implementation this reader
came from has eight strings and six ints per item; a current save has four more ints. It
was found by span arithmetic — across every item on a real character, string count plus
four-byte-field count came to eighteen every time — and confirmed by the walk landing
exactly on the inventory block's declared end. A stream cipher gives no second chances,
so landing on the marker is not something a wrong layout can fake.

Two things fall out of a real parse that a scan could not tell you. Only the weapon set
**in hand** is counted, so a spare weapon no longer injects a damage type the character
does not use. And a two-hander occupies both weapon slots, the second carrying an empty
base name and a copy of the same component — that shadow slot now contributes nothing,
where counting it would have doubled every socketed stat on any two-handed build.

## 0.4.1 — 5 Aug 2026

Three fixes, all found by testing the tool against real characters rather than by
reading the code.

**Every character was starting on Passives.** The initial state said Balanced and
`blankChar()` said Passives, and since a character's own value is applied on load, the
character always won. Powers were being ignored entirely for anyone who never touched
the scoring tabs. A deliberately chosen Passives still survives a reload.

**Physical resistance is no longer proposed by the resistance equaliser.** It came back
"dire" on every character tested, including one at 0, which is normal. The reason is not
that the thresholds were wrong for it: the devotion tree offers 58% of physical in total
at a median of 4 per star, against 150-250% at a median of 15 for every other
resistance. It is not a stat devotions can move, so flagging it proposed a fix that does
not exist. It stays pickable by hand.

**An older save now says what to do about it.** A character not played since a game
update carries older block versions and is refused rather than misread — but
"unsupported skill-block version 5" helps nobody. It now says to load the character once
in Grim Dawn and save. Confirmed: doing that rewrites the save to the current format and
it imports cleanly.

## 0.4.0 — 2 Aug 2026

**Import a character from a Grim Dawn save.** Pick your `player.gdc` and the tool builds
a character with the game's own name and class, and the devotion stars you have already
bought ticked off. The tracker half now fills itself in.

The join is by DBR record path, not by name: a save names each bought star as
`records/skills/devotion/tier1_01a.dbr`, and `ui-index.json` now carries the same stems.
So it is a lookup, with nothing to drift as display names change. Verified against four
real characters.

Import always creates a NEW character rather than overwriting the one you are on. It is
the only action that brings in information from outside, so it is the one where "that
wasn't what I meant" is most likely, and the character you were on may hold hours of
planning.

What does not come across is your tags. Nothing in a save says what you were aiming for,
and a guess would be putting words in your mouth.

If some of the stars you own are not in the current plan, it says so. They are stored and
reappear when the plan includes them, but a character that looks like it lost progress is
the first thing anyone would report as a bug.

## 0.3.1 — 2 Aug 2026

**Controls.** A new column on the left holds four ways of saying what you want, which
then fill the tag picker for you: meta offense, turtle mode, attributes first, and a
resistance equaliser. They stack, in the order you switch them on, and a tag two
controls both want keeps the higher of the two weights rather than counting twice.

The equaliser asks for the ten numbers off your character sheet rather than deriving
them from a save. Item affix values are rolled per item from a seed, so deriving them
would mean reimplementing the game's RNG, and the sheet's numbers are better anyway:
they already include conversions, set bonuses, augments and skill buffs. Fire, cold and
lightning share one entry, because ELEMENTAL RESISTANCE is the only chip the tree
offers — the weakest of the three drives the weight. A resistance at 75 or above is
ignored.

Controls propose; they never overrule you. What they place lands in the picker where
you can edit it, and switching the last one off leaves your tags where they are.

## 0.3.0 — 2 Aug 2026

**A Grim Dawn save can be read.** `readCharacter()` returns the character's name, class,
level, devotion budget and the devotion stars they have actually bought. Verified
against the game: the stars bought match the points the bio reports as spent, and the
affinity they reconstruct to matches the devotion screen exactly.

Not wired to the UI yet. That is the next piece.

## 0.2.7 — 2 Aug 2026

Documentation only. Records why a block containing nested blocks cannot be skipped byte
by byte, which is the rule that blocks the route to a character's devotions.

## 0.2.6 — 2 Aug 2026

The save reader is now verified against the game rather than only against itself. Name,
level, unspent attribute and skill points, money and both devotion numbers all match a
real character's sheet.

## 0.2.5 — 2 Aug 2026

The save reader now reads a real Fangs of Asterkarn save, which the previous version
did not. Three version numbers had moved since the parser it was ported from, and the
character-info block is now skipped by its declared length rather than parsed, so a
future change to it cannot break anything.

## 0.2.4 — 2 Aug 2026

The first half of reading a Grim Dawn save: the cipher, and everything up to the bio.
That yields the character's name, class, level and — the reason for doing it — how many
devotion points they have earned and how many are still unspent. Not wired to anything
yet, and not yet checked against a real save file.

## 0.2.3 — 2 Aug 2026

**A global bar, and many characters.** The bar sits above both panes, because a
character is the scope they sit inside: switch character and both the tags you asked
for and the path you got change together. New, duplicate, rename and delete live there.
Duplicate copies everything including your ticks, so a variation you want to compare
starts from where you actually are. Deleting asks first, and the last character cannot
be deleted.

The lock does not freeze any of it. It protects a build's contents, and a locked
character you could not leave would be a trap rather than a safety rail.

**Celestial power badges** now distinguish a power the build reaches from one it stops
short of, in both views. 40 of the 62 powers sit below the end of their constellation,
so a partial take can leave the power unbought; the badge dims rather than implying you
get it, and its tooltip says "Not scheduled to pick".

## 0.2.1 — 2 Aug 2026

Storage now holds many characters instead of one build. No UI yet; the switcher is next.

A character owns its tags, weights, scoring mode, drag order, progress and lock. Which
library tab is open, which categories are expanded, cards or column, and "stop telling
me about the lock" belong to you and are shared by every character.

An existing v1 save migrates into a single character, and the v1 key is left in place
as a free undo.

Overview's CP badge now distinguishes a power the build reaches from one it stops short
of. 40 of the 62 powers sit below the end of their constellation, so a partial take can
leave the power unbought; the badge dims in that case rather than implying you get it.
Both states keep the tooltip, since what the power does is what decides whether the
extra points are worth it.

## 0.2.0 — 1 Aug 2026

The first numbered state. Everything before this was unnumbered development.

**Planning.** Up to five keyword tags weighted 1-3, or a celestial power named outright
as a hard target. Three power-scoring modes. Coverage shows what each tag got against
the most it could get, and what that is worth in real units.

**The path.** A legal purchase order with Crossroads bought and refunded, either as
cards to follow one step at a time or as a single scannable column. Progress ticks
survive a re-solve and a reload.

**Drag to reorder.** Any step can be dragged in Overview; the insertion bar shows where
the row will actually land rather than where the cursor is, and refuses positions that
cannot be built inside 55 points.

**The lock.** Optional, off by default. Locked, the build is read-only and only the two
ends of your progress are clickable, which removes the destructive un-tick rather than
offering to undo it.

**Proven builds.** With glpk.js installed, a background worker proves the build optimal
and swaps it in, marking the totals line `optimal`. Local search measured 3.8-34.2%
below optimal and does not improve with more time, so this is a real difference rather
than a formality.

**Data.** Fangs of Asterkarn, v1.3.0.0, extracted from base plus gdx1, gdx2 and gdx3.
