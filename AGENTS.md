# AGENTS.md — YouTube Playlist Cleaner Extension

Manifest V3 browser extension for Google Chrome and Microsoft Edge to selectively clean, filter, and batch delete items from YouTube playlists.

---

## Project Overview

The **YouTube Playlist Cleaner** is a Manifest V3 browser extension for Google Chrome and Microsoft Edge. It automates filtering and deleting videos from YouTube playlists using custom user criteria (watched status/percentage, publication age, title keywords, channel names, and unavailable/private/deleted status).

It supports:

- **AND / OR matching logic** across multiple filter criteria.
- **Dry Run mode**: Identifies and previews matching videos without deleting them.
- **Auto-scrolling engine**: Loads long playlists dynamically using `MutationObserver` and `IntersectionObserver`.
- **Batch deletion**: Automates opening video context menus and clicking YouTube's remove action.
- **Summary report export**: Generates and downloads a timestamped `.txt` report of deleted/matched videos with reasons and URLs.
- **Cancellation overlay**: Allows users to safely interrupt in-progress scanning and deletion.

---

## Guidelines & Rules

### Rule 1 — Think Before Coding

State assumptions explicitly. Ask rather than guess. Push back when a simpler approach exists. Stop when confused.

### Rule 2 — Simplicity First (Right Way Beats Simplest Way)

Minimum code that solves the problem. Nothing speculative. No abstractions for single-use code. Simplicity governs implementation of the chosen design; conformance with domain models, security boundaries, and established patterns outranks raw brevity.

### Rule 3 — Surgical Changes

Touch only what you must. Don't touch adjacent code unless necessary. Match existing style. Don't refactor what isn't broken.

### Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified. Strong success criteria allow autonomous progress.

### Rule 5 — Surface Conflicts, Don't Average Them

If two patterns contradict, pick one (more recent / more tested). Explain why. Flag the other for cleanup. Don't blend conflicting patterns.

### Rule 6 — Read Before You Write

Before adding code, read exports, immediate callers, shared utilities. If unsure why existing code is structured a certain way, check or ask.

### Rule 7 — Tests Verify Intent, Not Just Behavior

Tests must encode WHY behavior matters, not just WHAT it does. A test that cannot fail when business logic changes is wrong.

### Rule 8 — Match Codebase Conventions

Conformance > personal taste inside the codebase. If a convention is flawed, surface it rather than quietly diverging.

### Rule 9 — Strict Project Boundary

You must NOT make any changes to files outside the project root directory. Do not run destructive commands (`rm`, `mv`, `mkdir`) outside the active project root.

### Rule 10 — Be Succinct and To-The-Point

Say only what is minimally necessary to communicate clearly and concisely.

### Rule 11 — Never Display Secrets in Transcripts

Values from credentials, passwords, auth tokens, or API keys must be masked before reaching transcripts.

### Rule 12 — Security & Manifest V3 Compliance

- Strictly follow Manifest V3 security rules: no `eval()`, no dynamically fetched remote scripts.
- Maintain minimal necessary permissions in `manifest.json` (`activeTab`, `webNavigation`, `scripting`, `https://www.youtube.com/*`).
- Protect against double-injection in content scripts using global guards (`__YPC_CONTENT_SCRIPT_INITIALIZED`).
- Ensure all DOM overlays and UI elements are cleaned up on completion, error, or cancellation.

---

## Extension Architecture & Components

```text
YouTube-Playlist-Cleaner/
├── src/
│   ├── manifest.json       # Manifest V3 extension configuration & permissions
│   ├── background.ts       # Service worker listening to SPA navigation on YouTube playlist URLs
│   ├── content.ts          # Injected content script (DOM traversal, scrolling, filtering, deletion)
│   ├── popup.html          # Extension popup UI (filters, dry run toggle, match logic)
│   ├── popup.ts            # Popup controller, validation, and content script messaging
│   ├── popup.css           # Popup styling
│   └── icon*.png           # Extension icons (16px, 48px, 128px)
├── dist/                   # Compiled extension bundle loaded unpacked into browser
├── tests/                  # Unit tests (Node.js test runner)
│   └── content_utils.test.mjs
├── scripts/
│   └── package.js          # Cross-browser packaging & validation script (Chrome, Edge, Firefox, Safari)
├── package/                # Production zip release archives and store media assets
├── docs/                   # Documentation and architectural specifications
├── package.json            # NPM scripts and build configuration
├── tsconfig.json           # TypeScript configuration (target es2020, strict)
├── STYLES.md               # Style and convention guidelines
├── TASK.md                 # Active and completed task tracking
└── session_context.md      # Development session log
```

---

## Development & Testing Workflow

### Local Development in Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the repository `dist/` directory (after running `npm run build`).
4. When code changes are made, run `npm run build` and click the refresh/reload icon on the extension card.

### Running Tests, Building & Packaging

```bash
# Run unit tests
npm test

# Build extension into dist/
npm run build

# Package for all stores (Chrome, Edge, Firefox, Safari) and audit packages
npm run package

# Package for specific browsers
npm run package:chrome
npm run package:edge
npm run package:firefox
npm run package:safari

# Audit and verify existing packages in package/
npm run verify:package
```

---

## Wrap-Up Procedure

When completing work or asked to "wrap up" the session:

1. **Summarize the session** in the response: tasks performed, key decisions, verification results, and any pending items.
2. **Update `session_context.md`** — record current state, completed work, decisions, and immediate next steps.
3. **Update `TASK.md`** — mark completed tasks and note any new work discovered.
4. **Final commit (no push)** — commit outstanding changes locally with a clear message. Do not push unless explicitly instructed.
