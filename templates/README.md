# Templates Directory

This directory contains template files used by draftsync for document conversion and formatting.

## Files

### metadata.yaml

EPUB metadata configuration file. Edit this to set:

- Book title, subtitle, author
- Publisher information
- ISBN and publication date
- Table of contents settings

### epub.css

Custom CSS stylesheet for EPUB formatting. Customize:

- Typography and fonts
- Paragraph spacing and indentation
- Heading styles
- Scene breaks and page breaks

### reference.docx (optional)

A reference DOCX file for styling when converting Markdown to DOCX.

To create a reference document:

1. Create a DOCX file with your desired styles in Microsoft Word or LibreOffice
2. Save it as `reference.docx` in this directory
3. Use it with: `draftsync push <file.md> --refdoc templates/reference.docx`

## Usage

These templates are automatically used by the build commands:

- `draftsync build:epub` uses metadata.yaml and epub.css
- `draftsync push --refdoc` uses reference.docx

You can also specify custom template paths using command-line options.
