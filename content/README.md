# Content Directory

Place your Markdown manuscript files here.

## File Naming

For consistent chapter ordering in your EPUB, use numbered prefixes:

```
01-chapter-one.md
02-chapter-two.md
03-chapter-three.md
...
```

## Markdown Format

Use standard Markdown syntax:

```markdown
# Chapter Title

This is a paragraph.

This is another paragraph with _italic_ and **bold** text.

## Section Heading

> A blockquote

- List item 1
- List item 2

---

Scene break (three dashes creates a horizontal rule)
```

## Example Chapter

Create a file like `01-chapter-one.md`:

```markdown
# Chapter One

The story begins here...

This is the first paragraph of your manuscript. Write your content using
standard Markdown formatting.

## A Section Within the Chapter

You can add sections within chapters using level-2 headings.

---

Use three dashes for scene breaks within a chapter.

The story continues after the break...
```

## Building

When you run `draftsync build:epub`, all `.md` files in this directory will be combined in alphabetical order into a single EPUB.

The first `#` heading in each file becomes a chapter in the table of contents.
