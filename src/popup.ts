/**
 * @file This script manages the extension's popup UI.
 * It is responsible for checking the current page URL and displaying the appropriate view,
 * reading user input, and sending commands to the content script.
 */

/**
 * A type-safe helper function to get an element by its ID and verify its type.
 * @param id The ID of the element to find.
 * @param typeConstructor The expected constructor of the element (e.g., HTMLDivElement).
 * @returns The typed element, or null if it's not found or the type is incorrect.
 */
function getElementById<T extends HTMLElement>(id: string, typeConstructor: new () => T): T | null {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`Element with ID '${id}' not found.`);
    return null;
  }
  if (!(element instanceof typeConstructor)) {
    console.error(`Element with ID '${id}' is not of the expected type.`);
    return null;
  }
  return element as T;
}

/**
 * The main entry point for the popup script.
 * This function is executed when the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Query for the active tab to check its URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const mainContent = getElementById('main-content', HTMLDivElement);
    const errorContent = getElementById('error-content', HTMLDivElement);

    // Ensure both content divs are found
    if (!mainContent || !errorContent) {
      console.error('Could not find main or error content divs.');
      return;
    }

    // Check if the URL is a valid YouTube playlist page
    const currentUrl = tabs[0]?.url;
    if (currentUrl && currentUrl.includes('youtube.com/playlist?list=')) {
      // If valid, show the main content and hide the error message
      mainContent.style.display = 'block';
      errorContent.style.display = 'none';
      initializeMainContent();
    } else {
      // If invalid, hide the main content and show the error message
      mainContent.style.display = 'none';
      errorContent.style.display = 'block';
    }
  });

  // Display the version number regardless of the page validity
  const versionDisplay = getElementById('version-display', HTMLSpanElement);
  if (versionDisplay) {
    const manifest = chrome.runtime.getManifest();
    versionDisplay.textContent = `v${manifest.version}`;
  }
});

/**
 * Initializes the event listeners and logic for the main UI.
 * This function is only called if the page is a valid YouTube playlist.
 */
function initializeMainContent() {
  const deleteButton = getElementById('delete-button', HTMLButtonElement);

  if (deleteButton) {
    deleteButton.addEventListener('click', () => {
      try {
        const logicInput = document.querySelector('input[name="logic"]:checked') as HTMLInputElement;
        const logic = logicInput?.value || 'OR';
        
        const ageValueInput = getElementById('video-age-value', HTMLInputElement);
        const ageUnitSelect = getElementById('video-age-unit', HTMLSelectElement);
        const titleContainsInput = getElementById('title-contains', HTMLInputElement);
        const channelNameInput = getElementById('channel-name', HTMLInputElement);
        const isWatchedCheckbox = getElementById('is-watched', HTMLInputElement);
        const deleteUnavailableCheckbox = getElementById('delete-unavailable', HTMLInputElement);
        const dryRunCheckbox = getElementById('dry-run', HTMLInputElement);

        const ageValueStr = ageValueInput?.value;
        const ageUnit = ageUnitSelect?.value;
        const titleContains = titleContainsInput?.value;
        const channelName = channelNameInput?.value;
        const isWatched = isWatchedCheckbox?.checked;
        const deleteUnavailable = deleteUnavailableCheckbox?.checked || false;
        const isDryRun = dryRunCheckbox?.checked || false;

        if (ageValueStr) {
          const ageValue = parseInt(ageValueStr, 10);
          if (isNaN(ageValue) || ageValue <= 0) {
            alert('Video age must be a positive number.');
            return; // Stop the process
          }
        }

        const filters = {
          titleContains: titleContains,
          channelName: channelName,
          isWatched: isWatched,
          deleteUnavailable: deleteUnavailable,
          age: (ageValueStr && ageUnit) ? { value: parseInt(ageValueStr, 10), unit: ageUnit } : undefined,
        };

        // Send the command to the content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'deleteVideos',
              filters: filters,
              logic: logic,
              isDryRun: isDryRun,
            }, () => {
              if (chrome.runtime.lastError) {
                console.error('Error sending message:', chrome.runtime.lastError.message);
                alert('Could not connect to the YouTube playlist page. Please ensure you are on a valid playlist and try again.');
              } else {
                window.close();
              }
            });
          } else {
            console.error('Could not find active tab to send message to.');
          }
        });
      } catch (error) {
        console.error("An error occurred in the popup's click handler:", error);
      }
    });
  }
}
