# YouTube Playlist Cleaner

A browser extension for Chrome and Edge that allows you to bulk-delete videos from any of your YouTube playlists based on a powerful set of customizable filters.

## Features

-   **Reliable on YouTube's Modern Interface:** Works correctly even when you navigate between pages on YouTube without a full page refresh.
-   **Smart UI:** The extension automatically detects if you are on a valid YouTube playlist page. If not, it will show a helpful message instead of the filter controls.
-   **Works on Any Playlist:** Clean up your "Watch Later" list, public playlists, or your own private playlists.
-   **Flexible Filtering Logic:** Combine filters using either **AND** (all criteria must match) or **OR** (any criterion can match).
-   **Advanced Text Matching:**
    -   Search for multiple keywords in video titles or channel names (e.g., `news, politics`).
    -   Search for exact phrases using double quotes (e.g., `"let's play"`).
-   **Filter by Watched Status:** Automatically remove all videos that are marked as fully or partially watched.
    -   When using the "Watched for at least (%)" criteria, the extension requires a whole number between 1 and 100 (inclusive). Decimal values will be truncated to integers.
    -   The extension reads partial watch progress from YouTube's resume overlay progress bar when available (e.g., `style="width: 11%;"`). If only a full-watched overlay is present, that video will be treated as 100% watched.
-   **Filter by Age:** Remove videos older than a specified number of days, weeks, months, or years.
-   **Delete Unavailable Videos:** Automatically remove videos with titles like "[Private video]" or "[Deleted video]".
-   **Dry Run Option:** Preview which videos would be deleted without actually removing them. This generates a report showing all matched videos and the reasons for their selection.
-   **Safe and Transparent:**
    -   A **Cancel** button allows you to stop the operation at any time.
    -   Generates a downloadable `.txt` summary file detailing exactly which videos were removed (or would be removed in a dry run) and why.

## Installation

1.  **Download the code:** Clone or download this repository to your computer.
2.  **Build the extension:**
    -   Open a terminal in the project's root directory.
    -   Run `npm install` to download the necessary build tools.
    -   Run `npm run build` to create the final, production-ready extension in the `dist` folder.
3.  **Load the extension in your browser:**
    -   **Chrome:** Navigate to `chrome://extensions`.
    -   **Edge:** Navigate to `edge://extensions`.
    -   Enable the **"Developer mode"** toggle (usually in the top-right or bottom-left corner).
    -   Click the **"Load unpacked"** button.
    -   Select the `dist` folder from this project directory.

The extension icon will now appear in your browser's toolbar.

## How to Use

1.  **Navigate to a Playlist:** Go to any YouTube playlist page you want to clean up. The extension is designed to work seamlessly, whether you land on the page directly or navigate to it from another part of YouTube.
2.  **Open the Extension:** Click the extension's icon in your browser toolbar to open the control panel. If you are on a valid playlist page, the filter controls will appear. If not, you will see a message prompting you to navigate to a valid page.
3.  **Set Your Filters:**
    -   **Logic:** Choose whether videos must match **ALL** of your filters or **ANY** of them.
    -   **Title/Channel:** Enter keywords or quoted phrases.
    -   **Age:** Enter a number and select the time unit.
    -   **Watched:** Check the box to target watched videos.
    -   **Delete Unavailable Videos:** Check this box to automatically remove videos that are marked as private or deleted.
    -   **Dry Run:** Check this box if you only want to generate a report of videos that *would* be deleted, without actually removing them.
4.  **Start the Process:** Click the **"Delete Selected"** button.
5.  **Wait:** The popup will close, and a "Cancel" button will appear on the page. The script will first scroll through the entire playlist to load all videos. This may take some time for very large playlists.
6.  **Deletion / Report Generation:**
    -   If **Dry Run** was *not* selected, the script will begin deleting the videos that match your criteria.
    -   If **Dry Run** *was* selected, no videos will be deleted, but a report will still be generated.
7.  **Review the Summary:** When the process is complete, a confirmation alert will appear, and your browser will automatically download a `.txt` file summarizing exactly which videos were removed (or would have been removed in a dry run) and the reasons why.

## Development

This project is written in TypeScript and uses a simple set of npm scripts for building.

-   **`src/`**: Contains all the source TypeScript, HTML, CSS, and the `manifest.json` file.
-   **`dist/`**: The output directory for the built extension. This folder is what you load into the browser. Created during build, not included in the repository.
-   **`docs/`**: Contains project documentation, including the implementation plan and this README.

### Build Process

-   `npm run build`: Cleans the `dist` directory, compiles the TypeScript files, and copies all necessary assets (`.html`, `.css`, `.json`) into `dist`.
-   `npm run clean`: Deletes the `dist` directory.
-   `npm run build:ts`: Compiles TypeScript files from `src` to JavaScript in `dist`.
-   `npm run copy:assets`: Copies non-TypeScript assets from `src` to `dist`.

To work on the extension, you can make changes to the files in `src/` and then run `npm run build` to see your changes.

## 🤖 Authorship & AI Assistance

This application was developed with the assistance of AI tools, guided and validated by human authorship. All architectural decisions, testing, and final implementation were reviewed and refined by the maintainer.

While AI tools supported code generation and scaffolding, the design, logic, and operational validation were shaped by human insight.

The maintainer retains copyright over the human-authored portions of this work.

## 📝 License

Licensed under [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)
