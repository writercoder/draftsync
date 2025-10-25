# Quick Start Guide

Get started with draftsync in 5 minutes.

## Installation

```bash
# Install dependencies
npm install

# Link globally (optional, for running 'draftsync' from anywhere)
npm link
```

## First EPUB in 3 Steps

### 1. Initialize project
```bash
./bin/draftsync.js init
```

### 2. Create sample content
```bash
cat > content/chapter-01.md << 'EOF'
# Chapter One: The Beginning

It was a dark and stormy night...

The old mansion stood on the hill, its windows dark and forbidding.

## The Discovery

Inside, a young detective found something unexpected.

---

Meanwhile, in another part of town, events were unfolding that would
change everything.
EOF
```

### 3. Build EPUB
```bash
./bin/draftsync.js build:epub
```

Your EPUB is now at `dist/book.epub`!

## Customize Your Book

Edit the metadata:
```bash
nano templates/metadata.yaml
```

Change these fields:
- `title`: Your book title
- `author`: Your name
- `date`: Publication date
- `description`: Book description

## Next Steps

### Add more chapters
```bash
echo "# Chapter Two" > content/chapter-02.md
echo "# Chapter Three" > content/chapter-03.md
```

### Rebuild
```bash
./bin/draftsync.js build:epub
```

### Validate
```bash
./bin/draftsync.js check:epub dist/book.epub
```

### Build web version
```bash
./bin/draftsync.js build:web
open dist/web/index.html
```

### Preview for Kindle
```bash
./bin/draftsync.js preview:kdp dist/book.epub
```

## Google Docs Sync (Coming Soon)

The Google Docs integration is stubbed but not fully implemented yet.

To complete it, you'll need to:
1. Set up Google Cloud credentials
2. Implement the OAuth2 flow in `src/auth.js`
3. Complete the Drive API integration in `src/drive.js`

See the TODO comments in those files for details.

## Requirements

- Node.js 18+
- Pandoc (for conversions)
  ```bash
  # macOS
  brew install pandoc

  # Linux
  sudo apt install pandoc

  # Windows
  choco install pandoc
  ```

## Troubleshooting

### "pandoc: command not found"
Install Pandoc: https://pandoc.org/installing.html

### "Cannot find module"
Run `npm install` in the project directory

### Permission denied
Make sure `bin/draftsync.js` is executable:
```bash
chmod +x bin/draftsync.js
```

## Help

```bash
./bin/draftsync.js --help
```

For detailed documentation, see [README.md](README.md)
