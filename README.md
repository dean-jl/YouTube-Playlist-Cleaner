# YouTube Playlist Cleaner

A Manifest V3 browser extension for Google Chrome, Microsoft Edge, and Firefox that allows you to bulk-delete videos from any of your YouTube playlists based on a powerful set of customizable filters.

## Features

- **Reliable on YouTube's Modern Interface:** Works correctly even when you navigate between pages on YouTube without a full page refresh.
- **Smart UI:** The extension automatically detects if you are on a valid YouTube playlist page. If not, it will show a helpful message instead of the filter controls.
- **Works on Any Playlist:** Clean up your "Watch Later" list, public playlists, or your own private playlists.
- **Flexible Filtering Logic:** Combine filters using either **AND** (all criteria must match) or **OR** (any criterion can match).
- **Advanced Text Matching:**
  - Search for multiple keywords in video titles or channel names (e.g., `news, politics`).
  - Search for exact phrases using double quotes (e.g., `"let's play"`).
- **Delete Duplicate Videos:** Automatically detect videos appearing more than once in the playlist. Preserves the first instance and selects subsequent duplicates for removal.
- **Filter by Duration & YouTube Shorts:**
  - Target YouTube Shorts (≤ 60 seconds).
  - Target videos shorter or longer than a custom minute and second threshold.
- **Export Playlist (CSV):** Backup all videos from the current playlist into a downloadable, clean UTF-8 CSV spreadsheet (including Title, Video ID, URL, Channel, Duration, Watched %, and Age) without deleting anything.
- **Preferences Memory:** Automatically saves your filter configurations to local extension storage (`chrome.storage.local`) and restores them whenever you reopen the extension popup.
- **Filter by Watched Status:** Automatically remove all videos that are marked as fully or partially watched.
  - When using the "Watched for at least (%)" criteria, the extension requires a whole number between 1 and 100 (inclusive). Decimal values will be truncated to integers.
  - The extension reads partial watch progress from YouTube's resume overlay progress bar when available (e.g., `style="width: 11%;"`). If only a full-watched overlay is present, that video will be treated as 100% watched.
- **Filter by Age:** Remove videos older than a specified number of days, weeks, months, or years.
- **Delete Unavailable Videos:** Automatically remove videos with titles like "[Private video]" or "[Deleted video]".
- **Dry Run Option:** Preview which videos would be deleted without actually removing them. This generates a report showing all matched videos and the reasons for their selection.
- **Safe and Transparent:**
  - Confirmation dialog shows the exact count of matched videos before any deletions begin.
  - A floating on-screen progress indicator with live ETA shows continuous progress.
  - A **Cancel** button allows you to stop the operation at any time.
  - Generates a downloadable `.txt` summary file detailing exactly which videos were removed (or would be removed in a dry run) and why.

## Installation

1. **Download the code:** Clone or download this repository to your computer.
2. **Build the extension:**
   - Open a terminal in the project's root directory.
   - Run `npm install` to download the necessary build tools.
   - Run `npm run build` to create the final, production-ready extension in the `dist` folder.
3. **Load the extension in your browser:**
   - **Chrome:** Navigate to `chrome://extensions`.
   - **Edge:** Navigate to `edge://extensions`.
   - Enable the **"Developer mode"** toggle (usually in the top-right or bottom-left corner).
   - Click the **"Load unpacked"** button.
   - Select the `dist` folder from this project directory.

The extension icon will now appear in your browser's toolbar.

## How to Use

1. **Navigate to a Playlist:** Go to any YouTube playlist page you want to clean up. The extension is designed to work seamlessly, whether you land on the page directly or navigate to it from another part of YouTube.
2. **Open the Extension:** Click the extension's icon in your browser toolbar to open the control panel. If you are on a valid playlist page, the filter controls will appear. If not, you will see a message prompting you to navigate to a valid page.
3. **Set Your Filters:**
   - **Logic:** Choose whether videos must match **ALL** of your filters (AND) or **ANY** of them (OR).
   - **Title/Channel:** Enter keywords or quoted phrases.
   - **Age:** Enter a number and select the time unit.
   - **Watched:** Check the box to target watched videos.
   - **Delete Duplicate Videos:** Check this box to delete redundant copies while keeping the first instance.
   - **Duration:** Target Shorts (≤ 60s) or videos shorter/longer than a specified duration.
   - **Delete Unavailable Videos:** Check this box to automatically remove videos that are marked as private or deleted.
   - **Dry Run:** Check this box if you only want to generate a report of videos that *would* be deleted, without actually removing them.
4. **Start the Process or Export:**
   - Click **"Delete Selected"** to begin scanning and deleting.
   - Or click **"Export Playlist (CSV)"** to back up the playlist to a CSV file without deleting anything.
5. **Wait & Confirm:** The script will first scroll through the entire playlist to load all videos. When finished, a confirmation dialog will display how many matching videos were found. Click **OK** to proceed with removal.
6. **Review the Summary:** When the process is complete, your browser will automatically download a `.txt` file summarizing exactly which videos were removed (or would have been removed in a dry run) and the reasons why.

## Development

This project is written in TypeScript and uses a set of npm scripts for building, testing, and multi-browser store packaging.

- **`src/`**: Extension source files (TypeScript, HTML, CSS, manifest).
- **`tests/`**: Automated unit test suite (filter parsing, age calculation, duration conversion, and duplicate detection).
- **`scripts/`**: Cross-browser packaging and validation tooling (`scripts/package.js`).
- **`dist/`**: Output directory for compiled assets. Loaded unpacked into browsers (generated during build, git-ignored).
- **`package/`**: Store media assets and release archives (distribution `.zip` archives are git-ignored).

### Build, Test & Packaging Scripts

- `npm run build`: Cleans `dist`, compiles TypeScript, and copies assets into `dist`.
- `npm test`: Runs the automated unit test suite with the Node.js test runner.
- `npm run package`: Builds and packages store-compliant `.zip` distribution bundles for Chrome, Edge, Firefox, and Safari into `package/`.
- `npm run verify:package`: Audits packaged release archives to verify manifest schemas, required assets, and file cleanliness.
- `npm run clean`: Deletes the `dist` directory.

To work on the extension, you can make changes to the files in `src/` and then run `npm run build` to see your changes.

## 🤖 Authorship & AI Assistance

This application was developed with the assistance of AI tools, guided and validated by human authorship. All architectural decisions, testing, and final implementation were reviewed and refined by the maintainer.

While AI tools supported code generation and scaffolding, the design, logic, and operational validation were shaped by human insight.

The maintainer retains copyright over the human-authored portions of this work.

## 📝 License

Licensed under [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)
