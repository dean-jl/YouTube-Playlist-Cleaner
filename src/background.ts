/**
 * @file This background script is the extension's event handler.
 * It is responsible for listening to navigation events within YouTube
 * and programmatically injecting the content script when a user
 * navigates to a playlist page, solving issues with YouTube's single-page
 * application (SPA) navigation.
 */

/**
 * Listens for changes to the URL in the browser tab.
 * This is crucial for single-page applications like YouTube where the
 * page content changes without a full page reload.
 */
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    // Check if the navigation occurred on a YouTube playlist page
    if (details.url && details.url.includes('youtube.com/playlist?list=')) {
      // Inject the content script into the tab.
      // This ensures that the content script is always available on playlist pages,
      // even if the user navigated there from another part of YouTube without a
      // full page refresh.
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
      });
    }
  },
  {
    // We only need to listen for events on YouTube pages.
    url: [{ hostContains: 'youtube.com' }],
  }
);
