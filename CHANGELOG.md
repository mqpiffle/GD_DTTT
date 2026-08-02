# Changelog

Versions start at 0.2.0, which is the state the tool had reached when numbering began
rather than a release. Patch numbers move with each commit; the minor number moves when
a piece of work is finished and agreed.

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
