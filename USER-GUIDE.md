# GD_DTTT — user guide

*Grim Dawn Devotion Theory-craft and Tracker Tool*

Pick a few things you want your character to be good at. Get a devotion path you can
follow in game, in the order you click it, with your progress ticked off as you go.

Nothing is sent anywhere and nothing needs an account. Your tags and your progress are
saved in the browser, so you can close the tab and come back to the same build.

---

## Starting a build

The tag list only shows stats a **character** can actually scale. Some stats in the
devotion tree belong to the celestial powers rather than to you — "Skill Duration" is how
long a proc lasts, "Weapon Damage" is a proc hitting with your weapon, "Summon Limit" is
how many of that one summon the proc gives you. None of those get better because you
wanted them more, so they aren't offered as targets. If you want the thing itself, pick
the power (see below).

Watch the names, though: **Burn Duration** *is* yours — Owl gives +50% duration to every
damage-over-time effect you inflict. That's a different thing from Skill Duration despite
the similar wording. The cold one is called **Frostburn**, as in game.

**Pick your tags.** Up to five, from the list on the left. They're grouped — Offense,
Defense, Utility, Resistances and so on — and split into **Character** and **Pet**,
because pet bonuses are a separate set of stats that happen to share names with yours.
"Total Damage" under Character is your damage; under Pet it's your pets'.

There's no build button. The path re-solves as soon as you change anything, and a small
line under the tags tells you when it's working.

**Or name a celestial power outright.** Under Character there's a **Celestial Powers**
category with all 62 of them, listed by the name you actually use — Targo's Hammer, Twin
Fangs, Fetid Pool. Pick one and the build is guaranteed to reach it.

These behave differently from stat tags. A stat tag is something to maximise; a power is
a target you either get or don't. Two things follow:

- **You usually don't need the whole constellation.** 40 of the 62 powers sit short of
  the end — Fetid Pool is 3 of Affliction's 7 stars. The planner takes the cheapest way
  in and spends what's left on your other tags. Hover a power to see its cost.
- **Enough powers eventually stop fitting.** Nothing conflicts until you've chosen four;
  past that, powers that can't share the points get struck through and greyed out in the
  list rather than letting you pick one and quietly dropping it. If several still can't
  fit, the one you picked first wins.
- **Powers have no priority dots**, because priority doesn't apply. Dots settle a
  competition between stats over the same stars; a power isn't in that competition —
  you get it, or it's reported as not fitting. The pill shows a target marker instead.

A power works in every scoring mode, including **Passives only**. Those two settings
don't fight: "Passives only" means *don't chase procs you didn't ask for*, and naming one
is asking. Ask for Targo's Hammer on a passives build and you get exactly that — the
hammer, and otherwise raw stats.

**Set what matters most.** Each chosen tag has three dots — click to cycle 1, 2, 3.
This is *relative* weight, so 1/1/1 and 3/3/3 give the same build; what counts is one
tag being heavier than another. Two dots is the default.

Fewer tags means a more focused build. Five tags spread across a 55-point budget give
each one roughly five stars of support; three give each about seven. Neither is wrong,
but the tool can't invent points, and the Coverage panel will show you the trade.

---

## Reading the result

### Coverage

Per tag: its weight dots, a bar, and a number like `7/12`.

The second number is the **ceiling** — the most stars of that keyword you could
physically obtain if it were your only goal and you spent all 55 points on it. It is
not 55, and it usually isn't large.

This matters more than it sounds. **66 of the 90 keywords — nearly three in four —
can never be maxed within 55 points.** Skill Radius, for example, appears once each in
fifteen different constellations costing 98 points between them, so six stars is
genuinely everything you can reach. When a bar stops well short, that's usually the
game, not the planner giving up.

- **Green, "max"** — you have everything available. Nothing more exists to get.
A **celestial power** row looks different, because a power is binary — there's no
"70% of a proc". It shows the power's name, which constellation it came from and how many
of that constellation's stars were needed, then a green tick if you got it:

```
● ● ●   Targo's Hammer  CP     Anvil 5/5        ✓ got
● ● ○   Fetid Pool      CP     Affliction 3/7   ✓ got
● ○ ○   Armor                  ▓▓▓▓▓▓▓▓░  24/27
```

- **Amber** — this tag got noticeably less than its weight asked for. Sometimes that
  means raising its dots will help. Sometimes it means the keyword is rare and no
  weighting will change it.

### When a tag gets nothing

Occasionally a tag comes back **0/10** and a note appears saying it was crowded out.
That is a real answer, not a malfunction, and it's one of the more useful things the
tool tells you.

The number on the right is the point: `0/10` means that tag was reachable — ten stars of
it, had you asked for nothing else — and your other tags spent the points first. It never
means the devotion tree lacks the stat.

That matters because it's easy to chase something that quietly wrecks the rest of a
build. Ask for Cold Damage, Pierce Damage, Frostburn Damage, Frostburn Duration and
Casting Speed together and the cold cluster eats the budget: three tags come back strong,
Pierce limps in at 2/22, and Casting Speed gets nothing at all. Nothing has gone wrong —
those five things simply don't live near each other in the tree.

What to do about it, in rough order of usefulness:

- **Drop the starved tag.** If four tags are well served and one isn't, you probably have
  the build you wanted plus a wish.
- **Lower the dots on a greedy tag** rather than raising them on the starved one. The
  crowding is caused by what's winning, not by what's losing.
- **Take the trade knowingly.** Sometimes the answer really is "I want the cold build and
  I'll find casting speed on gear."

### Power scoring

Celestial powers are the big active procs — Targo's Hammer, Twin Fangs. The three tabs
change how much the planner cares about reaching them:

| Tab | Use it when |
|---|---|
| **Passives only** | You want raw stats. Powers are taken only when they're on the way to affinity you needed anyway. |
| **Rank 1** | Balanced. Powers count for what they are at the rank you buy them. |
| **Max rank** | You intend to invest in a power and want the build to chase it. |

Switching tabs re-solves. Your ticked progress survives it.

---

## The two views

**Detail** is one card per step, with the individual stars to tick off. Use it while
you're playing.

**Overview** is the whole path in one column. Use it to judge a build before committing:

```
 #  ✓   CONSTELLATION                TAGS  PTS  RUN
 01 [✓] ○  Crossroads (primordial)          +1    1
 02 [–] ●  Tsunami  CP                  3   +5    6
 03 [ ] ○  Crossroads (ascendant)            +1    7
 04 [ ] ●  Harpy                        2   +4   11
```

- **●** — this step gives you something you asked for, and **TAGS** says how many stars'
  worth. **○** means it gives you nothing you asked for.
- **PTS** is what the step costs. **RUN** is your running total out of 55.
- **CP** marks a constellation with a celestial power.
- Rows with **↩** are Crossroads refunds — see below.

A run of **○** down the top is worth noticing. It means you're paying for affinity
before the build gives you anything you came for. That's often unavoidable, but if it
goes on for six or seven steps, a different tag mix may get you playing sooner.

---

## Following the path in game

Buy things top to bottom. The **highlighted card** is the step you're on, and the
**highlighted star** inside it is the next single star to click.

Tick stars as you buy them. A bought star dims and gets a green check; a finished
constellation collapses. In Overview, the box on each row does the same for a whole
constellation at once — empty, an amber dash for part-bought, a green check when it's
all yours.

**Undo** is next to the view toggle, or Ctrl+Z. Sixty steps of history.

### Two things the planner does for you

**It won't let you record something the game can't do.**

You can't buy a star without buying its parent first, so clicking a star deep in a
constellation also ticks the ones leading to it. Un-tick a star and anything hanging
off it goes too. Note this follows the actual tree, not the row above: constellations
branch, so clicking star 7 of Amatok gives you 1, 2, 6 and 7 — stars 3, 4 and 5 hang
off a different branch and stay unbought. The tree lines on the left of each star show
which hangs off which.

The same applies between constellations. You can't buy into a constellation until you
hold the affinity it requires, so ticking one completes whatever it depends on — and
only what it depends on. Rushing a constellation that needs primordial and eldritch
will complete the constellations that supply those, and leave alone the ones that
grant something else.

**Crossroads get bought and refunded.**

A Crossroads is a one-point filler used to cross an affinity threshold. Once the
constellations behind it stand on their own, the point comes back. The path shows both
the purchase and the refund, and the running total accounts for it — that's why the
number sometimes goes *down*.

---

## Going off-plan

Sometimes you want a specific celestial power early and you don't care about the
suggested order. That's fine, and it's supported — tick what you're actually buying.

When your ticks sit ahead of the listed order, the devotions list is covered by a
red-outlined box asking what you meant. It interrupts on purpose: until it's answered,
the step numbers and running totals below are describing a different playthrough from
yours. Tick a late constellation and its row may claim 48 points when the path to it
really costs 20.

Two answers, and only you know which:

- **Re-order & restart** — "I want to rush this." Your picks move to the front and the
  ticks clear, so you can follow the new order from step one. A **Custom** tab appears
  next to the scoring modes holding that order; the other tabs stay as they were, so you
  can compare.
- **Keep my ticks** — "I've already bought these." Nothing changes and the box goes
  away. It won't nag: it only asks again if you tick something *else* out of order, or
  change the scoring mode, since either is a different question.

Picked wrong? **Undo** restores the ticks and keeps the new order — which is usually
what you wanted anyway.

The Custom order is dropped if you change your tags — it's a re-ordering of one
particular set of constellations, and different tags mean a different set.

Since the game lets you respec, none of this is one-way. Un-tick, re-tag, re-order.

---

## Things worth knowing

- **The planner suggests one good order, not the only one.** Any order that respects
  the affinity requirements works in game.
- **The build is a strong answer, not a proven-optimal one.** It searches rather than
  proving, so a slightly better arrangement may exist. It is always a *legal* build
  inside 55 points.
- **Reset all** clears your tags, the path and your progress. Undo won't bring it back.
- **Your progress is keyed to individual stars**, so it survives changing the scoring
  mode or re-solving. Change your tags enough and progress on constellations that leave
  the build simply stops being shown.

---

## Quick reference

| | |
|---|---|
| Up to **5** tags | each weighted 1–3 |
| **55** devotion points | the game's cap |
| **●** / **○** | this step serves a tag / it doesn't |
| **CP** | constellation with a celestial power |
| **↩** | a Crossroads point coming back |
| `7/12` in Coverage | stars you got / the most obtainable |
| **max** | nothing more of that keyword exists |
| amber bar | served well below its weight |
| Ctrl+Z | undo, 60 steps |
