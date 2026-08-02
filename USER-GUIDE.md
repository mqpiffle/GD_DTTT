# GD_DTTT — user guide

*Grim Dawn Devotion Theory-craft and Tracker Tool*

Pick a few things you want your character to be good at. Get a devotion path you can
follow in game, in the order you click it, with your progress ticked off as you go.

Nothing is sent anywhere and nothing needs an account. Your tags and your progress are
saved in the browser, so you can close the tab and come back to the same build.

---

## Starting a build

The tag list only shows stats a **character** can actually scale. Some stats in the
devotion tree belong to the celestial powers rather than to you. "Skill Duration" is how
long a proc lasts, "Weapon Damage" is a proc hitting with your weapon, "Summon Limit" is
how many of that one summon the proc gives you. None of those get better because you
wanted them more, so they aren't offered as targets. If you want the thing itself, pick
the power (see below).

Watch the names, though. **Burn Duration** *is* yours: Owl gives +50% duration to every
damage-over-time effect you inflict. That's a different thing from Skill Duration despite
the similar wording. The cold one is called **Frostburn**, as in game.

**Pick your tags.** Up to five, from the list on the left. They're grouped by role
(Offense, Defense, Utility, Resistances and so on) and split into **Character** and
**Pet**, because pet bonuses are a separate set of stats that happen to share names with
yours.
"Total Damage" under Character is your damage; under Pet it's your pets'.

There's no build button. The path re-solves as soon as you change anything, and a small
line under the tags tells you when it's working.

**Or name a celestial power outright.** Under Character there's a **Celestial Powers**
category with all 62 of them, listed by the name you actually use: Targo's Hammer, Twin
Fangs, Fetid Pool. Pick one and the build is guaranteed to reach it.

These behave differently from stat tags. A stat tag is something to maximise; a power is
a target you either get or don't. Two things follow:

- **You usually don't need the whole constellation.** 40 of the 62 powers sit short of
  the end. Fetid Pool is 3 of Affliction's 7 stars. The planner takes the cheapest way
  in and spends what's left on your other tags. Hover a power to see its cost.
- **Enough powers eventually stop fitting.** Nothing conflicts until you've chosen four;
  past that, powers that can't share the points get struck through and greyed out in the
  list rather than letting you pick one and quietly dropping it. If several still can't
  fit, the one you picked first wins.
- **Powers have no priority stars**, because priority doesn't apply. Weight settles a
  competition between stats over the same stars, and a power isn't in that competition.
  You get it, or it's reported as not fitting. The pill shows a target marker instead.

A power works in every scoring mode, including **Passives**. Those two settings
don't fight. "Passives" means *don't chase procs you didn't ask for*, and naming one
is asking. Ask for Targo's Hammer on a passives build and you get exactly that: the
hammer, and otherwise raw stats.

**Set what matters most.** Each chosen tag has three stars. **Click the star you mean**:
Click the first for low, the third for high; there's no cycling through.

The colour tells you the level at a glance: **red** low, **amber** medium, **green** high.

This is *relative* weight, so ★★★ / ★★★ / ★★★ gives the same build as ★☆☆ / ★☆☆ / ★☆☆.
What counts is one tag being heavier than another. Two stars is the default.

Treat it as emphasis rather than a ranking. Three levels is all the resolution there is,
because the planner buys whole constellations of four to seven stars at a time and can't
finely trade one tag against another the way a slider would suggest. Nudging a tag up
often helps; expecting a strict pecking order will disappoint.

Fewer tags means a more focused build. Five tags spread across a 55-point budget give
each one roughly five stars of support; three give each about seven. Neither is wrong,
but the tool can't invent points, and the Coverage panel will show you the trade.

---

## Reading the result

### Coverage

Per tag: its name, what the build grants for it, a bar, and a number like `7/12 [19]`.

**The figure next to the name is what you actually get**: `+39%`, or `104-148`, or both
where a tag has each. The bar counts *stars*, and a star carrying +2% counts the same as
one carrying +40%, so this is the number that tells you whether a long bar is worth
anything. Tags that mix percentages with flat values show both rather than adding them
together, because those don't add up to anything meaningful.

The tag's weight isn't repeated here. You set it a few inches up the panel, and hovering
a row tells you what it is. Colour in Coverage means one thing only: what you got.

The second number is the **ceiling**, the most stars of that keyword you could physically
obtain if it were your only goal and you spent all 55 points on it. It is not 55, and it
usually isn't large.

This matters more than it sounds. **66 of the 90 keywords, nearly three in four, can
never be maxed within 55 points.** Physical Damage sits on 37 stars, but they're spread
over seventeen constellations costing 95 points between them, so twenty-three really is
everything you can reach. When a bar stops well short, that's usually the game rather
than the planner giving up.

The **bracketed number**, where it appears, is how many stars the whole tree has carrying
that tag, shown only when it's more than 55 points can reach. It's context, not a target:
`24/27 [37]` means the tree has 37, a build like yours can reach 27, and you have 24.
Green at 27 is still full marks.

- **Green, "max"**: you have everything available. Nothing more exists to get.
- **Amber**: this tag got noticeably less than its weight asked for. Sometimes raising
  its weight will help. Sometimes the keyword is rare and no weighting will change it.

A **celestial power** row looks different, because a power is binary. There's no "70% of
a proc". It shows the power's name, which constellation it came from and how many of that
constellation's stars were needed, then a green tick if you got it:

```
Targo's Hammer  CP     Anvil 5/5           got  ✓
Fetid Pool      CP     Affliction 3/7      got  ✓
Armor                  ▓▓▓▓▓▓▓▓░  24/27 [37]
```

### When a tag gets nothing

Occasionally a tag comes back **0/10**, marked with a red warning triangle. Hover the row
and it will tell you the tag was crowded out. That is a real answer rather than a
malfunction, and it's one of the more useful things the tool tells you.

The number on the right is the point. `0/10` means that tag was reachable, ten stars of
it had you asked for nothing else, and your other tags spent the points first. It never
means the devotion tree lacks the stat.

That matters because it's easy to chase something that quietly wrecks the rest of a
build. Ask for Cold Damage, Pierce Damage, Frostburn Damage, Frostburn Duration and
Casting Speed together and the cold cluster eats the budget: three tags come back strong,
Pierce limps in at 2/22, and Casting Speed gets nothing at all. Nothing has gone wrong.
Those five things just don't live near each other in the tree.

What to do about it, in rough order of usefulness:

- **Drop the starved tag.** If four tags are well served and one isn't, you probably have
  the build you wanted plus a wish.
- **Lower the weight on a greedy tag** rather than raising it on the starved one. The
  crowding is caused by what's winning, not by what's losing.
- **Take the trade knowingly.** Sometimes the answer really is "I want the cold build and
  I'll find casting speed on gear."

### Power scoring

Celestial powers are the big active procs, like Targo's Hammer and Twin Fangs. The three
settings change how much the planner cares about reaching them:

| Setting | Use it when |
|---|---|
| **Passives** | You want raw stats. Powers are taken only when they're on the way to affinity you needed anyway. |
| **Balanced** | Powers count for what they are at the rank you actually buy them, which is rank 1 for most of a levelling build. |
| **CP Max** | You intend to invest in a power and want the build to chase it. Favours going deep on a few powers over spreading across many. |

Changing it re-solves. Your ticked progress survives it.

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

**Hover any star to see what it actually gives you.** The pills tell you *which* of your
tags a star serves; the tooltip tells you by how much:

```
TSUNAMI
· 26-37 Cold Damage
· 6-28 Lightning Damage
· 25 Frostburn Damage over 2 seconds
· 3% Chance of Enemy Fumbling attacks
· +20% Weapon Damage
```

Power stars are headed with the power's name, since that name *is* the power. Ordinary
stars just list their bonuses.

- **●** means this step gives you something you asked for, and **TAGS** says how many
  stars' worth. **○** means it gives you nothing you asked for.
- **PTS** is what the step costs. **RUN** is your running total out of 55.
- **CP** marks a constellation with a celestial power.
- Rows with **↩** are Crossroads refunds. See below.

A run of **○** down the top is worth noticing. It means you're paying for affinity
before the build gives you anything you came for. That's often unavoidable, but if it
goes on for six or seven steps, a different tag mix may get you playing sooner.

---

## Following the path in game

Buy things top to bottom. The **highlighted card** is the step you're on, and the
**highlighted star** inside it is the next single star to click.

Tick stars as you buy them. A bought star dims and gets a green check; a finished
constellation collapses. In Overview, the box on each row does the same for a whole
constellation at once: empty, an amber dash for part-bought, a green check when it's all
yours.

**Each card shows what completing it grants**, as coloured circles on the right of its
title. `+3` in the Chaos colour means three Chaos affinity when the constellation is
finished, and hovering one gives you the name. A dashed circle means this step grants no affinity, or
none yet because you're only taking part of it.

**Between the last card you finished and the one you're on** sits a small strip: a white
square with the points you've spent, then all five affinities with what you currently
hold. That's the row to check against the game. Affinities you have none of stay in place
and dim, so the one you're watching doesn't move as you complete things.

**Ctrl+Z** undoes a tick, sixty steps back. There's no button for it, since clicking a
star again un-ticks it, but the shortcut is there for the times a single click did more
than you meant.

### Two things the planner does for you

**It won't let you record something the game can't do.**

You can't buy a star without buying its parent first, so clicking a star deep in a
constellation also ticks the ones leading to it. Un-tick a star and anything hanging
off it goes too. Note this follows the actual tree, not the row above: constellations
branch, so clicking star 7 of Amatok gives you 1, 2, 6 and 7. Stars 3, 4 and 5 hang off
a different branch and stay unbought. The tree lines on the left of each star show which
hangs off which.

The same applies between constellations. You can't buy into a constellation until you
hold the affinity it requires, so ticking one completes whatever it depends on, and only
what it depends on. Rushing a constellation that needs primordial and eldritch
will complete the constellations that supply those, and leave alone the ones that
grant something else.

**Crossroads get bought and refunded.**

A Crossroads is a one-point filler used to cross an affinity threshold. Once the
constellations behind it stand on their own, the point comes back. The path shows both
the purchase and the refund, and the running total accounts for it. That's why the
number sometimes goes *down*.

---

## Putting the path in your own order

The order the planner picks is a good one, not the only one. If you want a particular
constellation sooner, whether that's a celestial power you're building around or
something whose passives carry you through the next twenty levels, switch to **Overview**
and drag its row where you want it.

**The bar shows where the row will actually land, not where your cursor is.** That's
worth knowing before it surprises you, because it means the bar sometimes sits still
while you keep moving:

- **It stops moving across positions that mean the same thing.** Dropping something at
  the very top and dropping it one row down are usually the same request, because the
  affinity it needs has to be paid for either way. Rather than pretend those are
  different, the bar shows you the one place it can go.
- **It stops short of where you aimed.** Drag a deep constellation to the top and it
  lands partway instead: as early as the game allows, once the things granting its
  affinity have come forward with it. That isn't the tool overruling you. It's the
  earliest that request can actually be played.
- **It turns red.** Some positions can't be built inside 55 points at all: pulling a
  constellation forward can force a Crossroads that nothing later pays back. Release
  over red and nothing happens. You're told before you let go rather than after.
- **Some rows can't be dragged at all.** If every position would either change nothing
  or overrun the budget, the row won't pick up.

A Crossroads row can't be dragged either. Those are placed and refunded by the planner
as the order changes, so they aren't yours to position.

The **Order** button in the Devotions heading lights up once you've moved something.
Click it to throw your arrangement away and go back to the planner's own order. Your
arrangement survives a reload and survives ticking things off. It is dropped if you
change your tags, weights or scoring mode, because it was an ordering of one particular
set of constellations and those choices produce a different set.

Dragging never changes *which* constellations you get, or what they cost. Only when.

---

## Locking a build

Once you're happy and just want to follow the path in game, click the **padlock** in the
Devotions heading. It's optional, and off unless you ask for it.

Locked, the build is read-only: tags, weights, scoring, dragging and clearing your
progress are all frozen. What stays live is the thing you're actually there to do,
ticking off stars, and only at the two ends of your progress: **the next star to buy**,
and **the last one you bought**. Everything else is inert, and the first time you click
one it says so. Tell it to stop mentioning that and it will. The rule doesn't change,
you just stop being told.

That narrow rule is the whole point. Un-ticking is the destructive click, because
un-ticking something low in the path takes everything depending on it too, so the lock
removes the chance of doing that by accident rather than offering to undo it afterwards.

Unlocking asks first. Locking doesn't: putting the guard up should be frictionless,
taking it down is the thing you might do without meaning to. **Nothing is lost by
unlocking.** Your ticks survive it, and there's no penalty for going back and forth.

You can still read everything while locked. Hovering a star shows what it gives, the tag
library still browses, and Overview and Detail still swap.

---

## Going off-plan

You don't have to follow the order. Tick what you're actually buying. The planner won't
argue, and since the game lets you respec, none of it is one-way.

Worth knowing: the numbers down the right describe *the listed order*. Buy something
near the bottom first and its row still shows the running total it would have had if
you'd walked there, which can read as 48 points when the path you actually took cost 20.
If you want the numbers to match your run, drag that constellation to the front and the
list re-plans around it.

---

## Things worth knowing

- **The planner suggests one good order, not the only one.** Any order that respects
  the affinity requirements works in game.
- **The build is a strong answer, not a proven-optimal one.** It searches rather than
  proving, so a slightly better arrangement may exist. It is always a *legal* build
  inside 55 points.
- **Progress is keyed to individual stars**, so it survives a change of scoring mode or
  a re-solve. Change your tags enough and progress on constellations that leave the
  build stops being shown.
- **Reset all** sits top-right of the Target tags heading. It clears your tags, the path
  and your progress, and undo won't bring it back.

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
| `+39%` in Coverage | what those stars are actually worth |
| **max** | nothing more of that keyword exists |
| amber bar | served well below its weight |
| padlock | build read-only; tick the next star only |
| drag a row in Overview | put a constellation where you want it |
| red drop bar | that position needs more than 55 points |
| Ctrl+Z | undo a tick, 60 steps |
