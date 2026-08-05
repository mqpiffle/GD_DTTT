# Changelog

Versions start at 0.2.0, which is the state the tool had reached when numbering began
rather than a release. Patch numbers move with each commit; the minor number moves when
a piece of work is finished and agreed.

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
