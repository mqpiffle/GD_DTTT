# Deriving a character's resistances from their save — probe, 2 Aug 2026

Branch `derive-stats`. Two throwaway scripts, nothing wired to the app.

## The question

Controls need to know what a character lacks. The save stores no computed resistances,
and the standing assumption — written into the header of `controls.mjs` — was that
deriving them would mean reimplementing the game's RNG, because affix values are rolled
per item from a seed.

**That assumption was wrong.** A record does not store a range. It stores a single value,
and that value is the CENTRE of the roll:

```
offensiveChaosModifier,73.000000,
lootRandomizerJitter,10.000000,
```

The RNG is needed to know what one specific item rolled. It is not needed to know the
expected value. Across all 2,686 prefixes and suffixes the mean jitter is ~19%, most
commonly 15% or 18%, with a tail to 40%.

And because rolls are independent, a sum of many is far tighter than any one of them —
errors add in quadrature. Five affixes at ±28% each land within about ±6% of the total.

## Where a roll range actually comes from

Three different rules, and getting this wrong was the whole of the first pass's error:

| kind | range | how we know |
|---|---|---|
| Affixes (`lootaffixes/`) | `lootRandomizerJitter` | declared in the record |
| Base and quest items | **±20%**, declared nowhere | read off a tooltip |
| Components (`materia/`) | **fixed** | confirmed by arithmetic |

The first pass treated anything without `lootRandomizerJitter` as fixed. Farker's Slith
Primal Ring stores `defensiveLife,15` and the game displays
**"13% Vitality Resistance [12-18]"** — so it rolls, 15 is the centre, and the half-width
is 20%. The game shows these brackets in the detailed item view, which is the cheapest
possible source of truth for this.

Components being fixed is confirmed rather than assumed: the ring rolled 13 for vitality
and the sheet reads 23, so `compb_unholyinscription` contributed exactly its stored 10.

**The 20% is in no field of the record.** It is a game constant we have inferred, not
found, and that is a known gap.

## Result: measured against a real character

Farker, level 28, Veteran, so no difficulty penalty. All 39 equipped records resolved
against the extract, none missing. Fifteen carry resistances.

| stat | derived | band | sheet | in band | weight derived/true |
|---|---|---|---|---|---|
| Fire | 44 | 38–50 | 45 | yes | **3 / 2** |
| Cold | 50 | 43–57 | 55 | yes | 2 / 2 |
| Lightning | 38 | 33–43 | 39 | yes | 3 / 3 |
| Poison/Acid | 73 | 65–81 | 75 | yes | **1 / 0** |
| Pierce | 51 | 46–56 | 56 | yes | 2 / 2 |
| Bleeding | 27 | 24–30 | 28 | yes | 3 / 3 |
| Vitality | 25 | 22–28 | 23 | yes | 3 / 3 |
| Aether | 34 | 29–39 | 32 | yes | 3 / 3 |
| Chaos | 8 | 6–10 | 10 | yes | 3 / 3 |
| Physical | 0 | exact | 0 | yes | 3 / 3 |

**Ten of ten inside the band. Mean absolute error 2.1 points. The advice agrees on 8/10.**

The vitality residual that the first pass could not explain is now fully explained: the
ring rolled 13 rather than its stored 15. Nothing is left unaccounted for.

## The real limitation, and it is not accuracy

Both remaining disagreements are **boundary straddles**, not bad estimates:

- Fire 44 derived against 45 true. `resistWeight()` switches from 3 to 2 at exactly 45.
  One point of error, opposite sides of a line.
- Poison 73 against 75. The cap threshold is 75. Two points of error, opposite sides.

This is the finding that should shape the design. **The model's error (~2 points) is the
same size as the sharpness of the decisions being made with it.** More accuracy would not
fix this; the buckets are simply narrower than the uncertainty near their edges.

So a control should not convert a derived resistance into a hard weight and present it as
fact. Near a threshold it should say what it actually knows — "Poison is around 73 to 75,
call it capped" — and reserve confident advice for the cases that are not close, which
here is eight of ten and includes every genuinely dire resistance.

That is a better product anyway. A player who is told "your aether is 32 and that is the
problem" is being told something true and useful; a player told "your poison is exactly
73 so spend a point" is being told something the tool cannot know.

## How items are currently found — NOT shippable

The equipped items live in the tail of block 3, which the reader skips whole. They are
currently located by **trying every byte offset in the tail as a string** and keeping
whatever decodes as a DBR path. That works because a Reader's entire state is `pos` plus
a 32-bit key, so it can be snapshotted and restored, making speculative reads possible.

Good enough to answer "is the approach sound"; not good enough to ship, because it
recovers a SET of records with no idea which item each belongs to. Fine for resistances,
which are purely additive. Useless for anything needing per-item context.

The record layout is partly mapped. Confirmed by measurement:

```
baseName, prefixName, suffixName, modifierName, transmuteName, seed, relicName, ...
```

matching iagd. But the record has **four more 4-byte fields than iagd's**, sitting after
the relic fields, and they are not identified. The tail also begins with one leading byte
before the first item, which is why an aligned read from offset 0 produces pure noise.

## What this does and does not license

**Resistances are tractable.** Purely additive flat percentages, no conversions, no
weapon scaling, no modifier ordering. This is evidence they can be derived well enough to
drive a control, provided the control expresses uncertainty near thresholds.

**Damage is still not.** Nothing here touches the conversion problem: an item converting
physical to fire makes a skill's declared damage type wrong, and accuracy on individual
values cannot fix a wrong type. Do not read this as licensing "all out damage".

**OA / DA / armor are untested.** Additive like resistances, but with flat and percentage
terms applying in an order that has to be right. Plausible, unmeasured.

## Difficulty: read as a default, overridable by the player

Normal 0, Elite −25, Ultimate −50, applied flat to every resistance. Veteran is **not** a
penalty tier — it is normal difficulty with tougher enemies, same resistances.

**Both halves matter.** Reading it from the save matters because being wrong puts every
resistance out by 25 or 50, an order of magnitude past the ~2 point modelling error, and
does it silently — reporting a character as safe when it is not. Letting the player
change it matters because a character moves freely between difficulties once it has
unlocked them, so the stored value is only wherever they last stood, not a property of
the build. And the useful question is often about somewhere they have *not* been: "will
Elite kill me", asked from Veteran, is a question no save can answer.

So: default to the fact, let the player ask the counterfactual.

### Where it lives, and how we know

Block 1 (character info), four bytes in. It used to be skipped whole; now the front is
parsed and the tail still skipped by declared length, which preserves the original reason
for skipping — that layout has already changed once, from version 4 to 5.

```
version(int)  isInMainQuest  hasBeenInGame  difficulty  greatestDifficultyCompleted  money(int)
```

**Money is what proves the offsets.** Difficulty alone is a small number that could be
almost anything; money is checkable against the game. The save reads 161,842 where the
character panel showed 163,575 a short play session later — right field, right place.

The byte is a tier in the low nibble plus `0x10` for Veteran. Confirmed across four
characters covering all three tiers:

| character | level | byte | reads as | actual |
|---|---|---|---|---|
| Farker | 28 | `0x10` | normal + Veteran | Veteran ✓ |
| Sparkles | 80 | `0x01` | elite | Elite ✓ |
| Malodorous | 100 | `0x10` | normal + Veteran | **expected Ultimate** |
| Chphthzhmh | 100 | `0x02` | ultimate | Ultimate ✓ |

### What Malodorous taught, which is the useful part

Malodorous is level 100 with 55/55 devotions, 7.3M iron bits and
`greatestDifficultyCompleted` 2 — a finished character by every measure — and the byte
says normal+Veteran. That looked like a falsification, and was worth stopping on.

It is not. Chphthzhmh is *also* level 100 with 55/55 and reads ultimate correctly, so the
encoding is sound. Malodorous was simply last standing on Veteran.

**Which is precisely why the value is a default and not a fact.** The byte records where
a character last stood, not what they have beaten or where they belong. A level 100 who
has cleared Ultimate can be parked on Normal, and a tool that read that as "this
character plays Normal" and applied a 0 penalty would be confidently wrong about the only
number that matters here.

So the design was right before the evidence arrived: read it to save the player a click,
let them change it, and never treat it as more than an opening guess.

Note also that Veteran only ever appears on tier 0 in this sample, which fits — it is a
Normal-difficulty option rather than a mode that follows a character upward.

Farker projected to Ultimate, for illustration: fire −6, chaos −42, physical −50, nothing
above 23. That is the honest picture of a level 28 character looking at the top
difficulty, and no amount of devotion planning fixes it — which is itself worth the tool
being able to say.

## Two terms found by testing against Sparkles, and one still missing

Farker validated at 10/10 and that was misleading. Sparkles — level 80, Elite, 52
devotion points — broke it badly, and each break was a real omission.

### Devotions (found, fixed)

A devotion planner was not counting devotions. Sparkles has stars across Owl, Wraith,
Vulture, Rhowan's Crown, Quill and Ultos worth 25-58 points on five resistances. Farker
hid it entirely: nine points, mostly Crossroads, contributing near zero.

Devotion grants are the most tractable term in the model — fixed values, no jitter,
complete data, already keyed by the DBR path the extract uses.

### Skill rank: the save stores BASE, gear adds +N (found, not fixed)

Oak Skin's tooltip reads **"Current Level: 4 + 3"**. The save stores 4. Gear grants +3.
The game uses 7.

```
naturesblessing3   defensivePierce  r4=14  r7=25
                   defensiveAether  r4=12  r7=19
```

25 and 19 are exactly what the tooltip shows. So **any skill value read at its stored
rank is wrong wherever gear grants "+N to skills"**, which is most of an endgame build.
Computing effective ranks means modelling gear skill bonuses, which is not done.

Two naming traps sit on top of this. The record is `naturesblessing3`; the skill is
**Oak Skin**, under Mogdrogen's Pact. Searching the owned skills for "Mogdrogen" or "oak"
finds nothing and produces a confident, wrong "the character doesn't have it" — the same
internal-vs-display mismatch `AUDIT-2026-07-28.md` found on 27 constellations. Resolve
names through `skillDisplayName` → `text_en`, never by matching the record path.

### The difficulty penalty IS applied to the character sheet

Settled by pierce, which now closes exactly:

```
2 x resilientchestplate  30
Oak Skin at rank 7      +25
                        ---
                         55  less the Elite 25  =  30   sheet: 30
```

An earlier reading of this file argued the opposite, on the strength of three
resistances that matched with no penalty. Those three were short by 25 for a different
reason — see below — and agreeing with a wrong model is not evidence.

### The difficulty penalty applies to the sheet's TOP ROW only

This is what all the thrashing was about, and the answer is neither of the two things
being argued. The penalty is not global and it is not absent -- it is per row.

Grim Dawn lays resistances out in two rows of five. On Elite:

| row | stats | penalty |
|---|---|---|
| top | Fire, Cold, Lightning, Acid, Pierce | **-25** |
| bottom | Bleeding, Vitality, Aether, Chaos, Physical | **0** |

Sparkles, level 80, Elite, with every term computed in one pass:

```
  stat        gear  devo  skill  =  raw   pen   final   sheet   diff
  Fire         144    26      0  =  170   -25    145      80   capped ok
  Cold         144    26      0  =  170   -25    145      80   capped ok
  Lightning    144    26      0  =  170   -25    145      80   capped ok
  Acid          32     0      0  =   32   -25      7       4   +3
  Pierce        30     0     25  =   55   -25     30      30   0
  Bleeding      54    15      0  =   69     0     69      71   -2
  Vitality      18    15      0  =   33     0     33      33   0
  Aether        47    16     19  =   82     0     82      80   capped ok
  Chaos        117    31      0  =  148     0    148      80   capped ok
  Physical       3     3      0  =    6     0      6       6   0
```

**All ten fit.** Four exact (acid, pierce, vitality, physical), one inside the jitter
band (bleeding), four capped at the 80 the panel clamps to.

Acid became exact once the medal was inspected in game. The item shows **29% Poison &
Acid [28-36]** where the record stores 32 — so the +3 residual was the roll, not the
model. It is the only acid source on the character: 29 - 25 = 4, the sheet exactly.

That same tooltip corroborates three separate parts of this document at once:

- **The jitter model.** 32 with 15% jitter predicts 27.2-36.8; the game displays [28-36].
- **The item scan was right here.** The prefix really is on the medal, so the acid was
  never phantom.
- **"+N to skills" is visible on items** — the medal reads "+3 to Thermite Mine, +3 to
  Rune of Kalastor". That is the same mechanism that puts Oak Skin at rank 7, and it
  means effective ranks are derivable from gear rather than needing to be guessed.

**Why this took so long, and the lesson.** A global penalty fits acid and pierce and
breaks bleeding, vitality and aether. No penalty fits those three and breaks acid and
pierce. Testing one global switch against ten numbers meant every model explained half
the data, and reporting from memory between runs meant the half being quoted kept
changing. Compute the whole table in one pass and print every term; do not narrate
partial results.

**Scope of the evidence.** One character, one difficulty. Five of the ten are uncapped
and therefore actually test the rule -- acid and pierce demanding the penalty, bleeding,
vitality and physical refusing it. Farker cannot corroborate it: he is on Veteran, where
the penalty is zero either way.

**Untested: whether Ultimate penalises the bottom row too.** The phrase "cumulative
penalties" in the community sources hints it might. Chphthzhmh is level 100 on Ultimate
and would settle it -- but that save is in an older block format the reader refuses.

## Open gaps

- The ±20% default is inferred from one tooltip, not found in the data. Worth confirming
  against a second item before relying on it.
- **The inactive alternate weapon set is currently counted.** The offset scan takes every
  record in the equipment tail, including the weapon swap that is not in hand. Farker's
  alt weapons carry no resistances, so this did not show up — luck, not correctness. It
  needs the item layout pinned down to fix properly.
- Set bonuses are not modelled. Farker has none, so this probe says nothing about them.
- Skill and mastery resistance grants are not modelled. Farker appears to have none.

## Partial progress on the item layout

Measured from the gaps between known base-name offsets: an item is `baseName` followed by
**17 fields and one trailing byte**, where fields 1-4 are strings (prefix, suffix,
modifier, transmute), 5 is the seed, 6 is `relicName` and 7 is `relicBonus`. That matches
iagd for the first seven and gives **four more than iagd has** in the remainder.

Confirmed on the torso (no affixes, 111 bytes) and the quest ring (no affixes, 126
bytes), both landing exactly. **The relic does not fit this pattern** — its crafting
affix appears two slots after the base name rather than at slot 6 — so there is
variability not yet understood. Do not treat the layout as solved.
