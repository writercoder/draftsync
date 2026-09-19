# Demo: The Gettysburg Address

A ready-to-build draftsync project using a real public-domain manuscript with a
real revision history: the five known manuscript copies of Abraham Lincoln's
Gettysburg Address (November 19, 1863) — about 270 words that Lincoln kept
revising, giving genuine textual differences to demo with.

## Layout

```
content/
├── 01-gettysburg-address.md        The Bliss copy — the "final" text
└── drafts/                          Excluded from builds by default
    ├── 01-nicolay-first-draft.md    First draft
    ├── 02-hay-second-draft.md       Second draft
    ├── 03-everett-copy.md           Third copy (1864)
    └── 04-bancroft-copy.md          Fourth copy (1864)
```

## Try it

From this directory (requires Pandoc):

```bash
# Build the standard edition — drafts/ are excluded automatically
../../bin/draftsync.js build:epub

# Include a draft on purpose, via pattern
../../bin/draftsync.js build:epub --include "drafts/02-*.md"
```

To build a **comparison edition** with all five copies as chapters in
composition order, uncomment the `chapters:` list in
`templates/metadata.yaml` and run `build:epub` again.

## Why these texts make a good demo

Lincoln's revisions between copies are small, real, and easy to spot in a
diff — ideal for demonstrating sync and versioning:

| Passage           | Nicolay (1st draft)                  | Hay (2nd draft)                        | Bliss (final)                             |
| ----------------- | ------------------------------------ | -------------------------------------- | ----------------------------------------- |
| Opening           | "upon this continent"                | "upon this continent"                  | "on this continent"                       |
| After "dedicate…" | "This we may, in all propriety do."  | "It is altogether fitting and proper…" | same as Hay                               |
| "under God"       | absent                               | absent                                 | "this nation, under God, shall have…"     |
| Closing           | "the nation, shall have a new birth" | "this nation shall have"               | "that this nation, under God, shall have" |

## Provenance

All five copies are in the public domain (author died 1865; works published
before 1930). Transcriptions follow the versions published on Wikisource:

| Copy     | Written | Held by                              | Transcription                                                      |
| -------- | ------- | ------------------------------------ | ------------------------------------------------------------------ |
| Nicolay  | 1863    | Library of Congress                  | https://en.wikisource.org/wiki/Gettysburg_Address_(Nicolay_draft)  |
| Hay      | 1863    | Library of Congress                  | https://en.wikisource.org/wiki/Gettysburg_Address_(Hay_draft)      |
| Everett  | 1864    | Abraham Lincoln Presidential Library | https://en.wikisource.org/wiki/Gettysburg_Address_(Everett_draft)  |
| Bancroft | 1864    | Cornell University                   | https://en.wikisource.org/wiki/Gettysburg_Address_(Bancroft_draft) |
| Bliss    | 1864    | White House (Lincoln Room)           | https://en.wikisource.org/wiki/Gettysburg_Address_(Bliss_copy)     |

Notes:

- The **Bliss copy** is the only one Lincoln signed and dated, and is the
  standard text (it is the version inscribed at the Lincoln Memorial).
- The **Hay manuscript** carries Lincoln's own pencil corrections; the file
  here uses the clean reading text (corrections applied). See the Wikisource
  or Library of Congress facsimiles for the marked-up manuscript.
- The **Nicolay copy**'s second page was written in pencil at Gettysburg,
  producing its famously awkward join ("to stand here, we here be
  dedicated…") — preserved verbatim in the draft file.
