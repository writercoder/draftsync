# draftsync

[![CI](https://github.com/writercoder/draftsync/actions/workflows/ci.yml/badge.svg)](https://github.com/writercoder/draftsync/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/draftsync.svg)](https://www.npmjs.com/package/draftsync)
[![npm downloads](https://img.shields.io/npm/dm/draftsync.svg)](https://www.npmjs.com/package/draftsync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A developer-friendly CLI tool for synchronizing Markdown manuscripts with Google Docs and exporting to EPUB, Kindle, and web formats.

## Features

- **Bidirectional Sync**: Push Markdown to Google Docs, pull Google Docs back to Markdown
- **Manuscript Formatting**: Apply standard manuscript formatting (double-spacing, margins, headers)
- **EPUB Generation**: Build validated EPUBs with metadata, CSS, and cover images
- **Kindle Support**: Preview and test for Amazon Kindle Direct Publishing (KDP)
- **Web Export**: Convert to static HTML for web publishing
- **Manifest Tracking**: Automatic mapping between local files and Google Docs

## Installation

### Prerequisites

1. **Node.js** (v18 or higher)
   ```bash
   node --version
   ```

2. **Pandoc** (required for conversions)
   ```bash
   # macOS
   brew install pandoc

   # Windows (with Chocolatey)
   choco install pandoc

   # Linux (Debian/Ubuntu)
   sudo apt install pandoc

   # Or download from: https://pandoc.org/installing.html
   ```

3. **Google Cloud credentials** (for Google Docs sync)
   - See [Google API Setup](#google-api-setup) below

### Install draftsync

```bash
# Clone or download the repository
git clone https://github.com/yourusername/draftsync.git
cd draftsync

# Install dependencies
npm install

# Link globally (optional)
npm link
```

## Google API Setup

To sync with Google Docs, you need OAuth2 credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API and Google Docs API
4. Create OAuth2 credentials:
   - Go to "Credentials" → "Create Credentials" → "OAuth client ID"
   - Choose "Desktop app" as the application type
   - Download the credentials JSON file
5. Save the file as `credentials.json` in your project root

**Note**: The initial authentication flow is not yet fully implemented. See the TODOs in `src/auth.js` for details.

## Quick Start

### 1. Initialize a project

```bash
draftsync init
```

This creates:
- `content/` - Put your Markdown files here
- `dist/` - Build outputs go here
- `templates/` - EPUB metadata and CSS
- `.draftsync.json` - Manifest file

### 2. Add your manuscript

Create Markdown files in `content/`:

```bash
echo "# Chapter 1" > content/01-chapter-one.md
echo "# Chapter 2" > content/02-chapter-two.md
```

### 3. Build an EPUB

```bash
draftsync build:epub
```

Your EPUB will be created at `dist/book.epub`.

### 4. Customize metadata

Edit `templates/metadata.yaml` to set:
- Book title, author, publisher
- ISBN, publication date
- Cover image path

### 5. Push to Google Docs (when ready)

```bash
draftsync push content/01-chapter-one.md
```

## Commands

### Project Management

```bash
# Initialize a new draftsync project
draftsync init

# Show sync status of all linked files
draftsync status
```

### Google Docs Sync

```bash
# Link a Markdown file to an existing Google Doc
draftsync link <file.md> <google-doc-id>

# Push Markdown to Google Docs
draftsync push <file.md> [options]
  --folder-id <id>     # Place in specific Google Drive folder
  --refdoc <path>      # Use reference DOCX for styling
  --format             # Apply manuscript formatting

# Pull Google Doc to Markdown
draftsync pull <file.md>
```

### Publishing

```bash
# Build EPUB from all Markdown files
draftsync build:epub [options]
  -o, --output <path>    # Output file (default: dist/book.epub)
  -m, --metadata <path>  # Metadata YAML (default: templates/metadata.yaml)
  -c, --css <path>       # CSS file (default: templates/epub.css)
  --cover <path>         # Cover image

# Validate EPUB
draftsync check:epub <file.epub>

# Build static HTML
draftsync build:web [options]
  -o, --output <dir>     # Output directory (default: dist/web)

# Preview for Kindle
draftsync preview:kdp [file.epub]
```

## Workflow Examples

### Writing and Publishing Workflow

```bash
# 1. Start a new project
draftsync init

# 2. Write your manuscript in content/
# ... edit files ...

# 3. Build and validate EPUB
draftsync build:epub
draftsync check:epub dist/book.epub

# 4. Preview for Kindle
draftsync preview:kdp dist/book.epub

# 5. Build web version
draftsync build:web
```

### Collaborative Editing with Google Docs

```bash
# 1. Push to Google Docs for collaborative editing
draftsync push content/chapter-01.md --format

# 2. Share the Google Doc with collaborators
# (Copy the URL from the output)

# 3. After edits, pull back to Markdown
draftsync pull content/chapter-01.md

# 4. Rebuild EPUB with changes
draftsync build:epub
```

## File Structure

```
your-project/
├── content/              # Your Markdown manuscripts
│   ├── 01-chapter-one.md
│   ├── 02-chapter-two.md
│   └── ...
├── dist/                 # Build outputs
│   ├── book.epub
│   ├── web/
│   └── *.docx
├── templates/            # Templates and styles
│   ├── metadata.yaml     # EPUB metadata
│   ├── epub.css          # EPUB stylesheet
│   └── reference.docx    # DOCX style reference (optional)
├── .draftsync.json       # File mapping manifest
└── credentials.json      # Google API credentials (not in git!)
```

## Configuration

### EPUB Metadata

Edit `templates/metadata.yaml`:

```yaml
title: "Your Book Title"
author: ["Your Name"]
publisher: "Publisher Name"
language: en-US
# ... see file for more options
```

### EPUB Styling

Edit `templates/epub.css` to customize:
- Typography and fonts
- Paragraph indentation
- Chapter headings
- Scene breaks

### Manuscript Formatting (Google Docs)

When pushing with `--format`, draftsync applies:
- Double-spaced paragraphs (2.0 line spacing)
- 1-inch margins on all sides
- Header with author/title
- Page numbers in footer

## Development Status

### Working Features
- ✅ Project initialization
- ✅ EPUB build with Pandoc
- ✅ Web HTML export
- ✅ Kindle Previewer integration
- ✅ File manifest tracking

### In Progress (Stubbed)
- ⚠️ Google OAuth2 authentication
- ⚠️ Google Drive upload/download
- ⚠️ Google Docs formatting API
- ⚠️ DOCX → Google Docs conversion

The Google API integration is currently stubbed with clear TODOs. The conversion and build pipeline is fully functional using Pandoc.

## Extending draftsync

### Adding New Commands

Create a new file in `src/` and register it in `src/cli.js`:

```javascript
// src/cli.js
import { myNewCommand } from './my-feature.js';

program
  .command('my-command')
  .description('Do something cool')
  .action(myNewCommand);
```

### CI/CD Integration

Example GitHub Action:

```yaml
name: Build EPUB
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: sudo apt install pandoc
      - run: npx draftsync build:epub
      - uses: actions/upload-artifact@v3
        with:
          name: epub
          path: dist/book.epub
```

## Troubleshooting

### Pandoc not found
```bash
# Install Pandoc
brew install pandoc  # macOS
# or visit https://pandoc.org/installing.html
```

### EPUB validation fails
```bash
# Install epubcheck
brew install epubcheck  # macOS
# or download from https://github.com/w3c/epubcheck/releases
```

### Google API errors
Make sure you have:
1. Created a Google Cloud project
2. Enabled Drive and Docs APIs
3. Downloaded `credentials.json`
4. Placed it in the project root

## Contributing

Contributions are welcome! Areas to expand:

1. **Complete Google API integration** (see TODOs in `src/auth.js`, `src/drive.js`, `src/docs.js`)
2. **Add tests** (unit tests, integration tests)
3. **Improve error handling**
4. **Add more export formats** (PDF, Markdown variants)
5. **Better template system**

## License

MIT

## Links

- [Pandoc Documentation](https://pandoc.org/MANUAL.html)
- [Google Drive API](https://developers.google.com/drive)
- [Google Docs API](https://developers.google.com/docs)
- [EPUB Specification](https://www.w3.org/publishing/epub32/)
- [Amazon KDP Guidelines](https://kdp.amazon.com/en_US/help/topic/G200735480)

## Support

For issues and questions:
- GitHub Issues: https://github.com/yourusername/draftsync/issues
- Documentation: This README
