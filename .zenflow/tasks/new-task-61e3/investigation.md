# Bug Investigation: Intermittent "Could not connect" Error

## Bug Summary

The user reports an intermittent error message, "Could not connect to the YouTube playlist page. Please ensure you are on a valid playlist and try again," when they click the "Delete Selected" button. This happens even when they are on a valid YouTube playlist page. Refreshing the page seems to resolve the issue temporarily.

## Root Cause Analysis

The root cause of this bug is a **race condition** between the extension's popup script (`popup.ts`) and the content script (`content.ts`).

1.  **Background Injection**: The `background.ts` script uses `chrome.webNavigation.onHistoryStateUpdated` to detect navigation to a YouTube playlist. When this happens, it programmatically injects `content.ts` into the page. This is necessary for YouTube's single-page application (SPA) design.

2.  **Popup Action**: When the user clicks the extension's action icon, `popup.ts` runs. It checks if the URL is a playlist and, if so, displays the main UI with the "Delete Selected" button.

3.  **The Race**: The bug occurs when the user opens the popup and clicks "Delete Selected" *before* the background script has finished injecting `content.ts`.
    - The popup attempts to send a message to the content script using `chrome.tabs.sendMessage`.
    - Because the content script isn't yet loaded and listening for messages, the `sendMessage` call fails.
    - This failure sets `chrome.runtime.lastError`.
    - The callback in `popup.ts` detects this error and displays the "Could not connect..." alert.

The intermittent nature of the bug is due to variations in page load speed, system performance, and how quickly the user interacts with the popup after navigating to the page.

## Affected Components

-   `src/popup.ts`: The error is thrown here when it cannot communicate with the content script.
-   `src/background.ts`: The timing of its injection logic is the source of the race condition.
-   `src/content.ts`: Its absence at the critical moment causes the error.

## Proposed Solution

To fix this, I will implement a "handshake" mechanism to ensure the content script is loaded and ready *before* the user can perform any actions that require it.

1.  **Modify `src/content.ts`**:
    -   Update the `chrome.runtime.onMessage` listener to handle a new message type: `{ action: 'ping' }`.
    -   When it receives a `ping`, it will immediately respond with `{ status: 'ready' }`.

2.  **Modify `src/popup.ts`**:
    -   When the popup is opened (`DOMContentLoaded`), and the URL is confirmed to be a valid playlist, it will not immediately show the main UI.
    -   Instead, it will first send a `{ action: 'ping' }` message to the content script.
    -   **Success Case**: If it receives a `{ status: 'ready' }` response, it means the content script is active. The popup will then proceed to initialize the main UI (`initializeMainContent()`).
    -   **Failure Case**: If the `sendMessage` call fails (`chrome.runtime.lastError` is set), it means the content script is not present. The popup will then:
        1.  Programmatically inject `content.js` using `chrome.scripting.executeScript()`.
        2.  In the callback of `executeScript` (which confirms the script is loaded), it will then call `initializeMainContent()`.

This change makes the extension more robust. It removes the race condition by actively ensuring the content script is available when the popup is opened, rather than passively relying on the background script's timing. The background script's injection logic will be kept as a good fallback for general SPA navigation.
