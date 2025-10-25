# Publishing draftsync to npm

This guide covers how to publish `draftsync` to the npm registry.

## ✅ Good News!

The package name **`draftsync`** is available on npm!

## Before You Publish

### 1. Update package.json

Replace placeholder values in `package.json`:

```json
{
  "author": "Your Name <your.email@example.com>",
  "repository": {
    "url": "git+https://github.com/yourusername/draftsync.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/draftsync/issues"
  },
  "homepage": "https://github.com/yourusername/draftsync#readme"
}
```

Replace:
- `Your Name <your.email@example.com>` with your actual name and email
- `yourusername` with your GitHub username (if you have a repo)

### 2. Create an npm Account

If you don't have one:
1. Go to https://www.npmjs.com/signup
2. Create a free account
3. Verify your email

### 3. Test Everything

```bash
# Run tests
npm test

# Run linter
npm run lint

# Try installing locally
npm link
draftsync --help

# Test in a different directory
cd /tmp
draftsync --help
```

## Publishing Options

### Option A: Personal Package (Recommended)

Publish as `draftsync` (unscoped):

**Pros:**
- Simpler name: `npm install draftsync`
- No @ prefix needed
- More discoverable

**Cons:**
- Name must be unique globally (but `draftsync` is available!)

### Option B: Scoped Package

Publish as `@yourusername/draftsync`:

**Pros:**
- Always available (your username namespace)
- Can organize multiple packages under your scope
- Can have private packages (paid)

**Cons:**
- Longer name: `npm install @yourusername/draftsync`
- Less discoverable

## Publishing Steps

### For Personal Package (draftsync)

```bash
# 1. Login to npm
npm login
# Enter username, password, email, and OTP if 2FA is enabled

# 2. Verify you're logged in
npm whoami

# 3. Check what will be published
npm pack --dry-run

# 4. Publish!
npm publish

# That's it! Your package is live at:
# https://www.npmjs.com/package/draftsync
```

### For Scoped Package (@username/draftsync)

```bash
# 1. Update package.json name
# Change: "name": "draftsync"
# To:     "name": "@yourusername/draftsync"

# 2. Login to npm
npm login

# 3. Publish with public access (required for scoped packages)
npm publish --access public

# Package is live at:
# https://www.npmjs.com/package/@yourusername/draftsync
```

## After Publishing

### Test Installation

```bash
# In a different directory
npm install -g draftsync

# Or for scoped:
npm install -g @yourusername/draftsync

# Test it
draftsync --help
draftsync init
```

### Update npm Page

Your package page will be at:
- https://www.npmjs.com/package/draftsync

The README.md will be displayed automatically!

### Add npm Badge to README

Add this to the top of README.md:

```markdown
[![npm version](https://badge.fury.io/js/draftsync.svg)](https://www.npmjs.com/package/draftsync)
[![npm downloads](https://img.shields.io/npm/dm/draftsync.svg)](https://www.npmjs.com/package/draftsync)
```

## Publishing Updates

### Versioning

Follow semantic versioning (semver):
- **Patch** (1.0.x): Bug fixes - `npm version patch`
- **Minor** (1.x.0): New features - `npm version minor`
- **Major** (x.0.0): Breaking changes - `npm version major`

### Publishing a New Version

```bash
# 1. Make your changes and commit them
git add .
git commit -m "Add new feature"

# 2. Bump the version (creates a git tag)
npm version patch    # 0.1.0 → 0.1.1
# or
npm version minor    # 0.1.0 → 0.2.0
# or
npm version major    # 0.1.0 → 1.0.0

# 3. Publish (prepublishOnly runs tests automatically)
npm publish

# 4. Push to git (including tags)
git push && git push --tags
```

## Organization Publishing (Alternative)

If you want to create an organization:

### Create Organization

1. Go to https://www.npmjs.com/org/create
2. Choose an organization name (e.g., "draftsync-tools")
3. Free for public packages

### Publish to Organization

```bash
# 1. Update package.json
# Change: "name": "draftsync"
# To:     "name": "@draftsync-tools/draftsync"

# 2. Publish
npm publish --access public
```

### Organization Benefits

- Team collaboration
- Multiple related packages
- Brand identity
- Shared ownership

### Organization Costs

- **Free** for unlimited public packages
- **$7/month** per user for private packages

## Troubleshooting

### "You do not have permission to publish"

Make sure you're logged in:
```bash
npm whoami
npm login
```

### "Package name already exists"

Either:
- Choose a different name
- Use a scoped package: `@username/draftsync`

### "prepublishOnly script failed"

Tests or linting failed. Fix issues:
```bash
npm test
npm run lint
```

### "Package name too similar to existing package"

npm may flag similar names. If so:
- Use scoped package
- Choose a more unique name

## What Gets Published

The `files` field in package.json controls what's included:

```json
"files": [
  "bin/",
  "src/",
  "templates/",
  "README.md",
  "LICENSE",
  "QUICKSTART.md"
]
```

**Included:**
- Source code (src/)
- Binary entry point (bin/)
- Templates
- Documentation

**Excluded:**
- node_modules/
- test/
- fixtures/
- .git/
- Development config files

## Pre-publish Checklist

- [ ] Update author in package.json
- [ ] Update repository URLs
- [ ] All tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] README is complete and accurate
- [ ] Version number is correct
- [ ] LICENSE file exists
- [ ] No sensitive data in code
- [ ] Package installs and works: `npm link && draftsync --help`

## Recommended First Version

For initial release:
- Use version **`0.1.0`** or **`1.0.0`**
- `0.x.x` signals "still in development"
- `1.0.0` signals "production ready"

Current version is `0.1.0` which is perfect for a first release!

## Links

- npm Registry: https://www.npmjs.com
- npm Documentation: https://docs.npmjs.com
- Semantic Versioning: https://semver.org
- Publishing Guide: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
