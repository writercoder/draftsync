# Contributing to draftsync

Thank you for your interest in contributing to draftsync!

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Install Pandoc: `brew install pandoc` (or your platform's equivalent)
4. Run the CLI locally: `./bin/draftsync.js --help`

## Project Structure

```
draftsync/
├── bin/
│   └── draftsync.js          # CLI entry point
├── src/
│   ├── cli.js                # Command routing and main logic
│   ├── auth.js               # Google OAuth2 authentication
│   ├── drive.js              # Google Drive API operations
│   ├── docs.js               # Google Docs API operations
│   ├── pandoc.js             # Pandoc conversion wrapper
│   └── build/
│       ├── epub.js           # EPUB build system
│       ├── web.js            # Web HTML export
│       └── kdp.js            # Kindle preview integration
├── templates/                # Default templates
└── content/                  # Example content directory
```

## Priority TODOs

### 1. Complete Google API Integration

The Google Docs sync features are currently stubbed. See TODOs in:

- `src/auth.js` - Implement full OAuth2 flow
- `src/drive.js` - Implement file upload/download
- `src/docs.js` - Implement document formatting API

Key tasks:

- [ ] Implement OAuth2 authorization flow with browser redirect
- [ ] Token storage and refresh
- [ ] File upload to Google Drive
- [ ] DOCX → Google Docs conversion
- [ ] Google Docs → DOCX export
- [ ] Apply formatting via Google Docs API

### 2. Add Tests

Create test coverage:

- [ ] Unit tests for Pandoc conversions
- [ ] Integration tests for build commands
- [ ] Mock tests for Google API calls
- [ ] CLI command tests

### 3. Error Handling

Improve error messages and recovery:

- [ ] Better Pandoc error parsing
- [ ] Retry logic for API calls
- [ ] Validation before conversions
- [ ] User-friendly error messages

### 4. Additional Features

- [ ] Support for more metadata fields
- [ ] Custom Pandoc filters
- [ ] Batch operations (push/pull all files)
- [ ] Watch mode for auto-rebuilding
- [ ] PDF export
- [ ] Git integration for version tracking
- [ ] Interactive init wizard

## Code Style

This project uses ESLint and Prettier:

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Check formatting
npm run format:check

# Fix formatting
npm run format
```

## Commit Guidelines

- Use clear, descriptive commit messages
- Reference issue numbers when applicable
- Keep commits focused and atomic

Format:

```
type: brief description

Longer explanation if needed

Fixes #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Testing Your Changes

1. Test CLI commands manually:

   ```bash
   ./bin/draftsync.js init
   ./bin/draftsync.js build:epub
   ```

2. Test with sample content:

   ```bash
   echo "# Test Chapter" > content/test.md
   ./bin/draftsync.js build:epub
   ```

3. Verify EPUB output opens in a reader

## Submitting a Pull Request

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting and formatting
5. Test your changes
6. Commit with clear messages
7. Push to your fork
8. Open a pull request

## Documentation

When adding features:

- Update README.md with new commands
- Add JSDoc comments to functions
- Update QUICKSTART.md if it affects basic usage
- Add examples to help users

## Questions?

Open an issue for:

- Bug reports
- Feature requests
- Questions about the codebase
- Discussion about architecture

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
