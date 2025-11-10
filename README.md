# YouTube Playlist Trimmer

A browser extension for Chrome and Edge that allows you to bulk-delete videos from any of your YouTube playlists based on a powerful set of customizable filters.

## Features

- **Works on Any Playlist:** Clean up your "Watch Later" list, public playlists, or your own private playlists.
- **Flexible Filtering Logic:** Combine filters using either **AND** (all criteria must match) or **OR** (any criterion can match).
- **Advanced Text Matching:**
  - Search for multiple keywords in video titles or channel names (e.g., `news, politics`).
  - Search for exact phrases using double quotes (e.g., `"let's play"`).
- **Filter by Watched Status:** Automatically remove all videos that are marked as fully or partially watched.
- **Filter by Age:** Remove videos older than a specified number of days, weeks, months, or years.
- **Safe and Transparent:**
  - A **Cancel** button allows you to stop the operation at any time.
  - Generates a downloadable `.txt` summary file detailing exactly which videos were removed and why.

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

1.  **Navigate to a Playlist:** Go to any YouTube playlist page you want to clean up (e.g., your "Watch Later" list).
2.  **Open the Extension:** Click the extension's icon in your browser toolbar to open the control panel.
3.  **Set Your Filters:**
    -   **Logic:** Choose whether videos must match **ALL** of your filters or **ANY** of them.
    -   **Title/Channel:** Enter keywords or quoted phrases.
    -   **Age:** Enter a number and select the time unit.
    -   **Watched:** Check the box to target watched videos.
4.  **Start the Process:** Click the **"Delete Selected"** button.
5.  **Wait:** The popup will close, and a "Cancel" button will appear on the page. The script will first scroll through the entire playlist to load all videos. This may take some time for very large playlists.
6.  **Deletion:** Once all videos are loaded, the script will begin deleting the ones that match your criteria.
7.  **Review the Summary:** When the process is complete, a confirmation alert will appear, and your browser will automatically download a `.txt` file summarizing exactly which videos were removed and the reasons why.

## Development

This project is written in TypeScript and uses a simple set of npm scripts for building.

-   **`src/`**: Contains all the source TypeScript, HTML, CSS, and the `manifest.json` file.
-   **`dist/`**: The output directory for the built extension. This folder is what you load into the browser.  Created during build, not included in the repository.
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
