# Blue sky: the story as a collection of objects, à la git

Status: exploration, not a decision. Prompted by the maintainer,
2026-09-24.

## The idea

Git's model in one line: immutable content-addressed **blobs**, ordered
**trees** that reference them, **commits** that snapshot trees with
parentage, and **refs** that name commits. Applied to stories:

| git    | story                                                       |
| ------ | ----------------------------------------------------------- |
| blob   | a fragment: one chapter's text at one moment (content hash) |
| tree   | a version of the work: ordered refs to chapter fragments    |
| commit | a snapshot with parent(s), timestamp, note ("draft 3 done") |
| ref    | `draft` (moving), editions as tags (pinned)                 |

## Why this is attractive here — we are already 70% of the way

- `chapters.content_hash` and the `chapter_texts` snapshot table are a
  one-version object store today; keeping _every_ hash instead of the
  latest makes fragments real.
- `project.scan` is a commit ceremony that doesn't yet write commits:
  it detects change, diffs, records the event — adding a
  `chapter_versions (hash, parent_hash, at)` row is a small step.
- Editions are already ordered refs — but to _mutable_ chapters. Object
  editions could **pin fragment hashes**: "the exact text of the
  Everett copy in the 1864 edition" becomes addressable forever.

## What it buys

1. **Anchored reviews** — a review references the hash that was sent.
   "Sarah's notes are against draft 3, you're on draft 6" stops being
   tribal knowledge. (This need already exists in the review
   lifecycle.)
2. **Anchored AI audit** — a prose-suggestion event pinned to the exact
   before/after fragments is a materially stronger disclosure.
3. **Real history** — diff any two versions of a chapter, not just
   last-vs-current; the "alternative ending" draft becomes a branch
   rather than a file naming convention.
4. **Sync as remote tracking** — the pushed Google Doc is a remote ref;
   divergence (local edits + Doc edits) becomes detectable and
   eventually mergeable instead of last-write-wins.

## What it costs, and the boundary that keeps us honest

The standing principle stays: **markdown files are the source of
truth** — clone the repo, everything works. So the object store is the
_derived history_, exactly as git's `.git` is derived from the working
tree. Files are the working tree; the store remembers. Complexity is
real (GC of unreferenced fragments, rename/identity of chapters,
merge UX for prose is unsolved anywhere), so the move is incremental,
value-first.

## Why not just use git?

Many projects _are_ git repos already — where one exists, importing its
history for chapter files is a gift (blame, old versions) and should
happen. But: not every GUI-first user has git; chapter identity must
survive file renames (ours is DB-backed, git's is heuristic); and
review/AI anchoring needs draftsync-level semantics. So: **own minimal
version store in SQLite** (we nearly have it), with git-history import
as an enrichment, not a foundation. Delegating wholesale to
libgit2/isomorphic-git buys generality we don't need and UX we don't
want to inherit.

## Incremental path (each step useful alone)

1. Keep every scan snapshot: `chapter_versions` (hash, parent, at,
   word_count) + content-addressed fragment storage.
2. Reviews pin the hash at `review.request`; the board shows "reviewed
   at version N, now at N+3".
3. Exports record the hashes they shipped (an edition build becomes
   reproducible).
4. Editions optionally pin versions (tag semantics) — "freeze this
   edition".
5. Only then, if wanted: named branches, and Google-Doc-as-remote
   divergence detection.

Step 1–2 are a modest milestone with immediate review-workflow value;
5 is the research end of the horizon.
