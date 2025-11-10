/**
 * @file This script manages the extension's popup UI.
 * It is responsible for reading user input from the popup, constructing the filter object,
 * and sending the command to the content script.
 */

/**
 * A type-safe helper function to get an element by its ID and verify its type.
 * @param id The ID of the element to find.
 * @param typeConstructor The expected constructor of the element (e.g., HTMLInputElement).
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

console.log('Popup script parsed.');

document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOM loaded.');

  const deleteButton = getElementById('delete-button', HTMLButtonElement);

  if (deleteButton) {
    deleteButton.addEventListener('click', () => {
      console.log('Delete button clicked.');
      try {
        const logicInput = document.querySelector('input[name="logic"]:checked') as HTMLInputElement;
        const logic = logicInput?.value || 'OR';
        
        const ageValueInput = getElementById('video-age-value', HTMLInputElement);
        const ageUnitSelect = getElementById('video-age-unit', HTMLSelectElement);
        const titleContainsInput = getElementById('title-contains', HTMLInputElement);
        const channelNameInput = getElementById('channel-name', HTMLInputElement);
        const isWatchedCheckbox = getElementById('is-watched', HTMLInputElement);
        const deleteUnavailableCheckbox = getElementById('delete-unavailable', HTMLInputElement); // Get delete-unavailable checkbox
        const dryRunCheckbox = getElementById('dry-run', HTMLInputElement);

        const ageValueStr = ageValueInput?.value;
        const ageUnit = ageUnitSelect?.value;
        const titleContains = titleContainsInput?.value;
        const channelName = channelNameInput?.value;
        const isWatched = isWatchedCheckbox?.checked;
        const deleteUnavailable = deleteUnavailableCheckbox?.checked || false; // Get delete-unavailable state
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
          deleteUnavailable: deleteUnavailable, // Include delete-unavailable state
          age: (ageValueStr && ageUnit) ? { value: parseInt(ageValueStr, 10), unit: ageUnit } : undefined,
        };

        console.log('Sending filters to content script:', { filters, logic, isDryRun });

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'deleteVideos',
              filters: filters,
              logic: logic,
              isDryRun: isDryRun,
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error('Error sending message:', chrome.runtime.lastError.message);
                alert('Could not connect to the YouTube playlist page. Please ensure you are on a valid playlist and try again.');
              } else {
                console.log('Message sent successfully. Closing popup.');
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
});
