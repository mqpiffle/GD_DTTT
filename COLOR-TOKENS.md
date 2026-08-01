# Color tokens — reference

Added 2 Aug to `src/ui-mockup.html`'s `:root`, alongside the `--fs-*` font-size tokens
from the 2 Aug font pass. Every color literal in the stylesheet now points at one of
these; nothing is a raw hex or `rgba()` outside `:root` itself (a couple of comments
still quote a hex for readability — those are prose, not live CSS).

**This was a rename, not a redesign.** Values didn't change except for a handful of
near-duplicates that were almost certainly accidental (one or two units per channel
apart — `#ececec` next to `#e6e6e6`, `#232323` next to `#242424`) which got folded onto
the more-common neighbor. Anything a real design decision could plausibly have chosen
on purpose was kept as its own step, even where several steps sit close together.

**A bug worth knowing about if you do this again for radius/border-width next:** the
mechanical replace passes for the `rgba()`-based tokens (glows, shadows, tints) briefly
turned nine `:root` definitions into circular self-references — e.g.
`--glow-danger-1:var(--glow-danger-1)` — because the search string was the bare
`rgba(...)` value with no property-name prefix to distinguish a *usage* site from the
*definition* site, and the definition itself contains that same literal. Hex-based
tokens didn't have this problem because their usage sites are always prefixed with
something like `color:` or `background:`, which never appears in front of a `:root`
declaration. Caught by re-reading the whole `:root` block after the fact — worth doing
that read *before* declaring a token pass done, not after.

## Surfaces — backgrounds only

Darkest to lightest, generic/reusable steps. Numbered rather than named by role because
several serve more than one job (`--surface-2` is both a resting background *and* the
"dark text on a lit control" color for `.tab.on` etc.).

| Token | Value | Where |
|---|---|---|
| `--surface-1` | `#0f0f1e` | page background — midnight blue, hsl(240,33%,9%) *(was `#000`, then `#0b0b22` — desaturated after the pass, because at 50% saturation the blue read as a colour choice rather than as "not quite black" against the near-neutral panels sitting on it)* |
| `--surface-2` | `#0e0e14` | `.tab`, `.mbtn`, `.scoreopt` resting bg; also the dark text color on lit/active controls — slight blue tint to match `--surface-1` *(was `#111`)* |
| `--surface-3` | `#101016` | `.card.refund` *(was `#131313`)* |
| `--surface-4` | `#111117` | `.tip`, scrollbar tracks *(was `#141414`)* |
| `--surface-5` | `#121218` | `.mbox` (modal) *(was `#151515`)* |
| `--surface-6` | `#131319` | `.chip`, `.phead` *(was `#161616`)* |
| `--surface-7` | `#14141a` | `.ledger` *(was `#171717`)* |
| `--surface-8` | `#15151d` | `.mbtn:hover` *(was `#191919`)* |
| `--surface-9` | `#181820` | `.slot`, `.card`, `.mbtn.go` — the workhorse surface *(was `#1c1c1c`)* |
| `--surface-10` | `#1f1f29` | `.card:hover`, `.chip:hover` (raised/hover state) *(was `#242424`)* |
| `--surface-track` | `#303030` | Coverage bar's empty track |
| `--tone-bright` | `#f2f2f2` | hover/active "lit up" backgrounds; also `.orb.pts`'s own text |

## Ink — text, icons, borders (achromatic)

One scale from white to near-black, used for text *or* borders depending on the rule —
the file already reused the same gray for both, so one pool matches reality better than
two.

| Token | Value | Where |
|---|---|---|
| `--ink-1` | `#fff` | max emphasis: primary borders, "you're on this" text |
| `--ink-2` | `#e6e6e6` | near-white: chip text, star names *(absorbs `#ececec`, `#e8e8e8`, `#ddd`)* |
| `--ink-3` | `#cfcfcf` | secondary readable: tooltip body, orb numbers |
| `--ink-4` | `#b8b8b8` | Coverage bar's filled portion |
| `--ink-5` | `#b0b0b0` | power row's constellation/cost note |
| `--ink-6` | `#a8a8a8` | modal body text |
| `--ink-7` | `#9a9a9a` | tab default text, `.orb.pts` border |
| `--ink-8` | `#909090` | Coverage's tree-total bracket |
| `--ink-9` | `#8a8a8a` | the most-reused muted gray: labels, quiet meta text throughout |
| `--ink-10` | `#7a7a7a` | Overview's tabular numbers |
| `--ink-11` | `#6f6f6f` | `.tg.other`, the Coverage info icon |
| `--ink-12` | `#6a6a6a` | quiet labels, hover borders *(absorbs `#666`)* |
| `--ink-13` | `#5f5f5f` | faint: refund rows, star index numbers, "pet" suffix *(absorbs `#5a5a5a`)* |
| `--ink-14` | `#4f4f4f` | very faint: empty-slot placeholder, error text |
| `--ink-15` | `#4a4a4a` | near-invisible: star-tree gutter |

## Line — hairline borders, dividers

Same achromatic pool as ink, but the values cluster tighter and darker, so they get
their own short list.

| Token | Value | Where |
|---|---|---|
| `--line-1` | `#4d4d4d` | `.scoreopt` border |
| `--line-2` | `#3f3f3f` | `.pck` icon color, `.ledger` border |
| `--line-3` | `#3d3d3d` | `.tg` border |
| `--line-4` | `#3a3a3a` | the workhorse default border — used almost everywhere |
| `--line-5` | `#333` | `.tab`, `.total` border |
| `--line-6` | `#2e2e2e` | `.rb` background, `.stars` border-top |
| `--line-7` | `#2a2a2a` | `.plain` border, `.phead` border-bottom *(absorbs `#2b2b2b`)* |
| `--line-8` | `#262626` | `.cat` border-top |
| `--line-9` | `#222` | `.prow+.prow` border-top |
| `--line-10` | `#1f1f1f` | `.row` border-bottom |

## Accents — the five meaningful hues

The colors that actually carry meaning in this app. Variants are named for what they
*are* (bright/soft/muted/deep/dim/border), not where they're used, since most get reused
across several rules.

| Token | Value | Meaning |
|---|---|---|
| `--accent-danger` | `#e5484d` | red — weight 1, mbox border, zero-row warning icon |
| `--accent-danger-soft` | `#e07a7a` | Coverage's zero-row count |
| `--accent-danger-bright` | `#ff7a7d` | weight-star hover, tier 1 |
| `--accent-danger-muted` | `#8a7070` | blocked chip text |
| `--accent-danger-dim` | `#6a4a4a` | blocked chip's remove icon |
| `--accent-danger-border` | `#3a2a2a` | blocked chip border |
| `--accent-warn` | `#e8c15a` | amber — weight 2, under-served rows, solving pulse |
| `--accent-warn-bright` | `#f3d585` | weight-star hover, tier 2 |
| `--accent-warn-deep` | `#d9b03c` | partially-ticked checkbox |
| `--accent-warn-border` | `#8a7330` | partially-ticked checkbox border |
| `--accent-success` | `#4ade80` | green — weight 3, maxed rows, done checks |
| `--accent-success-bright` | `#7ff0a8` | weight-star hover, tier 3 |
| `--accent-success-muted` | `#2f4a35` | bought-row done tick |
| `--accent-success-border` | `#3f6047` | completed-card border |
| `--accent-current` | `#90c5df` | light blue — "you are here" / next *(kept paler/less saturated than `--af-primordial` on purpose, since they share a hue)* |
| `--accent-current-bright` | `#c2e0f0` | next-star's number |
| `--accent-current-muted` | `#4b809b` | next-star's tree gutter |
| `--accent-power` | `#7fffd4` | teal/mint — celestial power text and borders |

## Glow — rgba() shadows for the accents

Kept as independent literals rather than derived from the accent hex (no `color-mix()`
assumed) — if an accent's hex ever changes, its glow needs updating too.

| Token | Value |
|---|---|
| `--glow-danger-1` | `rgba(229,72,77,.14)` |
| `--glow-danger-2` | `rgba(229,72,77,.6)` |
| `--glow-danger-3` | `rgba(229,72,77,.75)` |
| `--glow-warn-1` | `rgba(232,193,90,.6)` |
| `--glow-warn-2` | `rgba(232,193,90,.75)` |
| `--glow-success-1` | `rgba(74,222,128,.6)` |
| `--glow-success-2` | `rgba(74,222,128,.7)` |
| `--glow-current-1` | `rgba(144,197,223,.45)` |
| `--glow-current-2` | `rgba(144,197,223,.26)` |

## Tint — flat, pre-mixed dark backgrounds carrying an accent's hue

Not the same idea as a glow (accent-at-low-alpha): these are their own hex so they sit
correctly over the surface beneath rather than actually compositing.

| Token | Value | Where |
|---|---|---|
| `--tint-success` | `#161b17` | completed-card background |
| `--tint-success-hover` | `#1c231d` | completed-card hover |
| `--tint-success-strong` | `#132a1b` | checked checkbox background |
| `--tint-success-highlight` | `#1a2418` | Overview's first-hit row |
| `--tint-danger` | `#241a1a` | blocked chip's remove-icon background |
| `--tint-warn` | `#241f10` | partially-ticked checkbox background |
| `--tint-current` | `#11232c` | next-star row background |
| `--tint-current-hover` | `#162f3b` | next-star row hover |
| `--tint-current-row` | `#0d1a21` | Overview's current row |
| `--tint-power` | `#0d2f27` | celestial-power pill background |
| `--tint-spent` | `rgba(255,255,255,.11)` | points-spent square background |

## Misc shadows

| Token | Value | Where |
|---|---|---|
| `--shadow-soft` | `rgba(0,0,0,.65)` | `.tip` and `.mbox` drop shadow |
| `--overlay-scrim` | `rgba(6,6,6,.82)` | rush-offer modal backdrop |

## Affinity hues

Already named via the `.af-*` classes; promoted to variables too so anything outside
those five rules can reference the same colors without retyping hex. Each affinity's
text, border and background are three *independently* chosen values, not one hue at
three alphas — the background intentionally samples a different, more saturated source
than the text/border pair (see the comment at `.af-ascendant` in the stylesheet).

| Affinity | Text | Border | Background |
|---|---|---|---|
| Ascendant | `--af-ascendant` `#b98ce8` | `--af-ascendant-border` `#6f4b96` | `--af-ascendant-bg` `rgba(168,123,224,.13)` |
| Chaos | `--af-chaos` `#ff5c9d` | `--af-chaos-border` `#93335c` | `--af-chaos-bg` `rgba(255,92,157,.13)` |
| Eldritch | `--af-eldritch` `#b5e550` | `--af-eldritch-border` `#6a8a2c` | `--af-eldritch-bg` `rgba(181,229,80,.13)` |
| Order | `--af-order` `#f0ce6b` | `--af-order-border` `#8e7431` | `--af-order-bg` `rgba(232,193,90,.13)` |
| Primordial | `--af-primordial` `#5cb0f0` | `--af-primordial-border` `#2d6795` | `--af-primordial-bg` `rgba(62,155,229,.13)` |

## What's left, per FUTURE-PLANS.md

Border-radius and border-width are still literal throughout (`999px` pills, `12px`/
`10px`/`6px` card corners, `1px`/`2px`/`3px` border widths). Same treatment would apply:
audit, name by role, replace. Smaller surface area than color was — radius in particular
is mostly `999px` (pill) or `6px`/`8px`/`10px`/`12px` (card corners), so probably a
4-5-token job.
