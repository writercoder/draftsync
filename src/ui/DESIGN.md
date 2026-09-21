# draftsync design language

The single written source for how draftsync looks and why. Tokens live
in `assets/tokens.css` (the only place hex values are allowed); shared
components in `assets/draftsync.css`; the living reference renders at
`/design` while `draftsync serve` runs.

## The three zones

The UI contains exactly three things. Each has its own palette, and
**color carries domain meaning** — an element takes its colors from the
zone it belongs to, never for decoration.

1. **Text & writing** (`--ink-*`, `--paper-*`) — authorly, black and
   white, "Once upon a time…" but subtle. Manuscript content (titles,
   excerpts, word counts) reads as ink on paper, set in the authorly
   serif (`--font-authorly`). No color ever sits on manuscript text.
2. **Project management** (`--infra-*`) — blue and grey; helpful,
   infrastructure, tools. Buttons, links, stage columns, task chips,
   navigation: the GitHub-tooling register — friendly utility.
3. **AI** (`--ai-pink`, `--ai-green`, `--ai-orange`) — anything AI-
   related is marked in this palette and only this palette. This is the
   AI-audit policy made visual: AI presence is always legible, never
   camouflaged. Pink = AI presence/markers, green = acknowledged/
   justified, orange = attention needed (e.g. unacknowledged prose
   events).

Signals (`--danger`) are zone-independent.

## Rules

- No hex outside `tokens.css`. Components use tokens or inherit.
- No cross-zone color borrowing. If an element seems to need a color
  outside its zone, the design is wrong or the zone map needs a
  discussion — not an exception.
- Markup stays semantic and readable: real elements, few short class
  names, no utility-class chains.
- Both themes always: tokens define light and dark; components never
  hardcode either.
- Wide things scroll inside their own container; the page never scrolls
  sideways.

## Brand

Working direction: **birds — herons and storks**. Literary lineage with
a focus on delivery (the stork delivers, the heron waits and then
strikes the catch). Elegance and class for a literary audience, without
losing the friendliness and utility of GitHub-style tooling.

Provisional mark: the **origami heron** (`assets/heron.svg`) — paper
and bird in one image: folded from the same material the writing is
made of, patient, precise, delivers. Candidates render on `/design` (a delivering-stork sketch was tried
and dropped — it read as clip-art). The mark is zone 1 (monochrome ink); it must work at
16px (favicon) and in both themes.

Voice: quiet confidence. Labels say what happens ("Send for review",
"Record received feedback"); no exclamation marks in chrome.
