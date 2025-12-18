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
 * Ensures the content script is injected and ready, then calls the callback.
 * @param tabId The ID of the tab to check.
 * @param callback The function to execute once the content script is ready.
 */
function ensureContentScriptReady(tabId: number, callback: () => void) {
  // Ping the content script to see if it's already injected and ready
  chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
    if (chrome.runtime.lastError) {
      // If the ping fails, the content script is not there. Inject it.
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js'],
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to inject content script:', chrome.runtime.lastError.message);
          alert('Failed to inject the content script. Please try refreshing the page.');
        } else {
          callback();
        }
      });
    } else if (response && response.status === 'ready') {
      // If the ping is successful, the script is already there.
      callback();
    } else {
        // In an unexpected state, try to inject anyway
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
        }, callback);
    }
  });
}

/**
 * The main entry point for the popup script.
 * This function is executed when the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
  const mainContent = getElementById('main-content', HTMLDivElement);
  const errorContent = getElementById('error-content', HTMLDivElement);
  const versionDisplay = getElementById('version-display', HTMLSpanElement);

  // Ensure both content divs are found
  if (!mainContent || !errorContent) {
    console.error('Could not find main or error content divs.');
    return;
  }

  // Display the version number regardless of the page validity
  if (versionDisplay) {
    const manifest = chrome.runtime.getManifest();
    versionDisplay.textContent = `v${manifest.version}`;
  }

  // Query for the active tab to check its URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (!currentTab?.url || !currentTab.id) {
        mainContent.style.display = 'none';
        errorContent.style.display = 'block';
        return;
    }

    // Check if the URL is a valid YouTube playlist page
    if (currentTab.url.includes('youtube.com/playlist?list=')) {
      // Ensure the content script is ready before showing the UI
      ensureContentScriptReady(currentTab.id, () => {
        mainContent.style.display = 'block';
        errorContent.style.display = 'none';
        initializeMainContent();
      });
    } else {
      // If invalid, hide the main content and show the error message
      mainContent.style.display = 'none';
      errorContent.style.display = 'block';
    }
  });
});

/**
 * Initializes the event listeners and logic for the main UI.
 * This function is only called if the page is a valid YouTube playlist.
 */
function initializeMainContent() {
  const deleteButton = getElementById('delete-button', HTMLButtonElement);
  const helpButton = getElementById('help-button', HTMLButtonElement);
  const helpModal = getElementById('help-modal', HTMLDivElement);
  const helpBackdrop = getElementById('help-backdrop', HTMLDivElement);
  // top close removed; we will focus the bottom close button when opening the help modal
  const isWatchedCheckbox = getElementById('is-watched', HTMLInputElement);
  const watchedOptionsDiv = getElementById('watched-options', HTMLDivElement);
  const watchedCriteriaSelect = getElementById('watched-criteria', HTMLSelectElement);
  const watchedValueInput = getElementById('watched-value', HTMLInputElement);

  // Help modal wiring
  const openHelp = () => {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'false');
    // focus the bottom close button for accessibility
    // focus the modal content so the user starts at the top
    const content = document.getElementById('help-content') as HTMLDivElement | null;
    if (content) content.focus();
    // activate focus trap
    activateFocusTrap(content);
  };
  const closeHelp = () => {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'true');
    // return focus to help button
    if (helpButton) helpButton.focus();
    // deactivate focus trap
    deactivateFocusTrap();
  };

  if (helpButton) {
    helpButton.addEventListener('click', openHelp);
  }
  if (helpBackdrop) {
    helpBackdrop.addEventListener('click', closeHelp);
  }
  const helpCloseBottom = document.getElementById('help-close-bottom') as HTMLButtonElement | null;
  if (helpCloseBottom) helpCloseBottom.addEventListener('click', closeHelp);

  // Focus trap implementation
  let _focusTrapHandler: ((e: KeyboardEvent) => void) | null = null;
  const getFocusableElements = (root: Element | null): HTMLElement[] => {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("a[href], button, textarea, input, select, [tabindex]:not([tabindex='-1'])")).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
  };
  const activateFocusTrap = (root: Element | null) => {
    if (!root) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey) {
        if (active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    _focusTrapHandler = handler;
    document.addEventListener('keydown', handler);
  };
  const deactivateFocusTrap = () => {
    if (_focusTrapHandler) {
      document.removeEventListener('keydown', _focusTrapHandler);
      _focusTrapHandler = null;
    }
  };

  // --- Event Listeners for Watched Filter ---
  if (isWatchedCheckbox && watchedOptionsDiv) {
    isWatchedCheckbox.addEventListener('change', () => {
      // Use 'flex' so the CSS flex row layout for #watched-options is honored
      watchedOptionsDiv.style.display = isWatchedCheckbox.checked ? 'flex' : 'none';
    });
  }

  if (watchedCriteriaSelect && watchedValueInput) {
    watchedCriteriaSelect.addEventListener('change', () => {
      // Only the 'percent' option is supported here. Show the numeric input inline
      // and constrain it to whole numbers between 1 and 100.
      const showValueInput = watchedCriteriaSelect.value === 'percent';
      watchedValueInput.style.display = showValueInput ? 'inline-block' : 'none';
      if (watchedCriteriaSelect.value === 'percent') {
        watchedValueInput.placeholder = '%';
        watchedValueInput.setAttribute('min', '1');
        watchedValueInput.setAttribute('max', '100');
        watchedValueInput.setAttribute('step', '1');
        // Ensure input mode helps mobile keyboards (harmless on desktop)
        watchedValueInput.setAttribute('inputmode', 'numeric');
      } else {
        // Clear constraints for other (future) criteria
        watchedValueInput.removeAttribute('min');
        watchedValueInput.removeAttribute('max');
        watchedValueInput.removeAttribute('step');
        watchedValueInput.removeAttribute('inputmode');
      }
    });

    // Enforce whole numbers and clamp between 1 and 100 while the user types
    watchedValueInput.addEventListener('input', () => {
      const raw = watchedValueInput.value;
      if (!raw) return;
      // If user types a decimal, truncate to integer
      if (raw.includes('.')) {
        const intVal = Math.floor(parseFloat(raw));
        watchedValueInput.value = isNaN(intVal) ? '' : String(intVal);
      }
      // Clamp to min/max if attributes are present
      const minAttr = watchedValueInput.getAttribute('min');
      const maxAttr = watchedValueInput.getAttribute('max');
      const min = minAttr ? parseInt(minAttr, 10) : undefined;
      const max = maxAttr ? parseInt(maxAttr, 10) : undefined;
      const current = parseInt(watchedValueInput.value, 10);
      if (!isNaN(current)) {
        if (min !== undefined && current < min) watchedValueInput.value = String(min);
        if (max !== undefined && current > max) watchedValueInput.value = String(max);
      }
    });
  }

  if (deleteButton) {
    // Avoid adding multiple listeners if this function is ever called more than once
    if (deleteButton.dataset.listenerAttached) return;
    deleteButton.dataset.listenerAttached = 'true';

    deleteButton.addEventListener('click', () => {
      try {
        const logicInput = document.querySelector('input[name="logic"]:checked') as HTMLInputElement;
        const logic = logicInput?.value || 'OR';
        
        const ageValueInput = getElementById('video-age-value', HTMLInputElement);
        const ageUnitSelect = getElementById('video-age-unit', HTMLSelectElement);
        const titleContainsInput = getElementById('title-contains', HTMLInputElement);
        const channelNameInput = getElementById('channel-name', HTMLInputElement);
        const deleteUnavailableCheckbox = getElementById('delete-unavailable', HTMLInputElement);
        const dryRunCheckbox = getElementById('dry-run', HTMLInputElement);

        const ageValueStr = ageValueInput?.value;
        const ageUnit = ageUnitSelect?.value;
        const titleContains = titleContainsInput?.value;
        const channelName = channelNameInput?.value;
        const deleteUnavailable = deleteUnavailableCheckbox?.checked || false;
        const isDryRun = dryRunCheckbox?.checked || false;

        if (ageValueStr) {
          const ageValue = parseInt(ageValueStr, 10);
          if (isNaN(ageValue) || ageValue <= 0) {
            alert('Video age must be a positive number.');
            return; // Stop the process
          }
        }
        
        // Build the watched filter object
        const watchedCriteria = watchedCriteriaSelect?.value || 'any';
        const watchedValueStr = watchedValueInput?.value;
        let watchedValue = 0;
        // Parse and validate watchedValue if provided
        if (watchedValueStr) {
          const parsedValue = parseInt(watchedValueStr, 10);
          if (isNaN(parsedValue) || parsedValue <= 0) {
            alert('Watched value must be a positive whole number.');
            return;
          }
          // If percent criteria is selected, enforce 1-100 range
          if (watchedCriteria === 'percent' && (parsedValue < 1 || parsedValue > 100)) {
            alert('Please enter a percentage between 1 and 100.');
            return;
          }
          watchedValue = parsedValue;
        }

        // Only enable the watched filter if the checkbox is checked and the chosen criteria is valid.
        let isWatchedEnabled = isWatchedCheckbox?.checked || false;
        if (isWatchedEnabled) {
          if (watchedCriteria === 'percent') {
            // require a provided watchedValue > 0
            if (!watchedValue || watchedValue <= 0) {
              alert('Please enter a percentage between 1 and 100 for the watched criteria.');
              return;
            }
            isWatchedEnabled = true;
          } else {
            // 'any' criteria is valid so keep enabled
            isWatchedEnabled = true;
          }
        }

        const filters = {
           titleContains: titleContains,
           channelName: channelName,
           isWatched: {
             enabled: isWatchedEnabled,
             criteria: watchedCriteria,
             value: watchedValue,
           },
           deleteUnavailable: deleteUnavailable,
           age: (ageValueStr && ageUnit) ? { value: parseInt(ageValueStr, 10), unit: ageUnit } : undefined,
         };

         // Send the command to the content script
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
           if (tabs && tabs.length > 0 && tabs[0].id) {
             chrome.tabs.sendMessage(tabs[0].id, { action: 'deleteVideos', filters: filters, logic: logic, isDryRun: isDryRun }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error sending message:', chrome.runtime.lastError.message);
                  // This alert should no longer be needed with the handshake, but is kept as a fallback.
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
