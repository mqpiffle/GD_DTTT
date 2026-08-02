# Deriving a character's resistances from their save — probe, 2 Aug 2026

Branch `derive-stats`. Two throwaway scripts, nothing wired to the app.

## The question

Controls need to know what a character lacks. The save stores no computed resistances,
and the standing assumption — written into the header of `controls.mjs` — was that
deriving them would mean reimplementing the game's RNG, because affix values are rolled
per item from a seed.

**That assumption was wrong.** An affix DBR does not store a range. It stores a single
value plus `lootRandomizerJitter`, a percentage:

```
offensiveChaosModifier,73.000000,
lootRandomizerJitter,10.000000,
```

So the stored value is the CENTRE of the roll. The RNG is needed to know what one
specific item rolled; it is not needed to know the expected value. Across all 2,686
prefixes and suffixes the mean jitter is ~19%, most commonly 15% or 18%, with a tail to
40%.

And because rolls are independent, a sum of many affixes is far tighter than any one of
them — errors add in quadrature. Five affixes at ±28% each land within about ±6% of the
total.

## Result: measured against a real character

Farker, level 28. All 39 equipped records resolved against the extract, none missing.
Fifteen carry resistances. Compared against the numbers off the character sheet:

| stat | derived | sheet | error | weight derived/true |
|---|---|---|---|---|
| Fire | 44 | 44 | 0 | 3 / 3 |
| Cold | 50 | 55 | −5 | 2 / 2 |
| Lightning | 38 | 39 | −1 | 3 / 3 |
| Poison/Acid | 73 | 75 | −2 | **1 / 0** |
| Pierce | 51 | 56 | −5 | 2 / 2 |
| Bleeding | 27 | 28 | −1 | 3 / 3 |
| Vitality | 25 | 23 | +2 | 3 / 3 |
| Aether | 34 | 32 | +2 | 3 / 3 |
| Chaos | 8 | 10 | −2 | 3 / 3 |
| Physical | 0 | 0 | 0 | 3 / 3 |

**Mean absolute error 2.0 points, maximum 5. Eight of ten fell inside the predicted
band.**

### The number that actually matters

Raw accuracy is the wrong measure. What a control does with a resistance is bucket it —
`resistWeight()` returns 3 below 45, 2 below 60, 1 below 75, 0 at or above. So the only
errors that count are the ones that cross a threshold.

**The advice differs on one resistance of ten**, and it is the mildest possible
disagreement: Poison at 73 derived versus 75 true, so the tool would say "worth one point
of attention" where the truth is "capped, ignore it". Every other bucket is identical,
including all four at the dire end.

## The unexplained residual

Vitality was computed as EXACT — both its sources (`compb_unholyinscription` at 10,
`q003_ring_slithring` at 15) are fixed, no jitter — and it is still off by 2. That is the
one result worth being uneasy about, because roll variance cannot explain it.

Ruled out by measurement:

- **Field mapping.** All ten checked against `labels.json`; `defensiveLife` is Vitality
  Resistance, `defensivePoison` is Acid, and so on.
- **Negative resistances on equipped items.** None.
- **Percentage modifiers** (`defensive*Modifier`). Only `defensiveBlockAmountModifier`
  and `defensiveProtectionModifier` appear, neither a resistance.
- **Elemental collapse.** The quest ring carries `defensiveElementalResistance,15`, which
  correctly raises fire, cold and lightning together — that part of the model is right.

Still unaccounted for, and any of them could be the cause: resistances granted by skills
or mastery bars, set bonuses, and the difficulty penalty (Veteran 0, Elite −25,
Ultimate −50). None of the three is modelled.

A 2-point unexplained term is small, but "small and unexplained" is different from
"small and understood". It should be chased before this is trusted.

## How items are currently found — NOT shippable

The equipped items live in the tail of block 3, which the reader skips whole. They are
currently located by **trying every byte offset in the tail as a string** and keeping
whatever decodes as a DBR path. That works because a Reader's entire state is `pos` plus
a 32-bit key, so it can be snapshotted and restored, which makes speculative reads
possible.

This is good enough to answer "is the approach sound" and not good enough to ship,
because it recovers a SET of records with no idea which item each belongs to. That is
fine for resistances, which are purely additive, and useless for anything needing
per-item context.

The real item layout is partly mapped. Confirmed by measurement:

```
baseName, prefixName, suffixName, modifierName, transmuteName, seed, relicName, ...
```

which matches iagd. But the record has **four more 4-byte fields than iagd's**, sitting
after the relic fields, and they are not identified. The tail also begins with one
leading byte before the first item, which is why an aligned read from offset 0 produces
pure noise.

## What this does and does not license

**Resistances are tractable.** Purely additive flat percentages, no conversions, no
weapon scaling, no modifier ordering. This probe is evidence they can be derived well
enough to drive a control.

**Damage is still not.** Nothing here changes the conversion problem: an item converting
physical to fire makes a skill's declared damage type wrong, and no amount of accuracy on
individual values fixes a wrong type. Do not read this result as licensing "all out
damage" from a save.

**OA / DA / armor are untested.** They are additive like resistances but carry flat and
percentage terms that apply in an order which has to be right. Plausible, unmeasured.
