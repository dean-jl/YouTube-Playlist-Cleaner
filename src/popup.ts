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
const SETTINGS_KEY = 'yt_playlist_cleaner_settings';

interface SavedPreferences {
  logic?: string;
  titleContains?: string;
  channelName?: string;
  ageValue?: string;
  ageUnit?: string;
  isWatched?: boolean;
  watchedCriteria?: string;
  watchedValue?: string;
  deleteUnavailable?: boolean;
  deleteDuplicates?: boolean;
  durationEnabled?: boolean;
  durationCriteria?: string;
  durationMinutes?: string;
  durationSeconds?: string;
  dryRun?: boolean;
}

/**
 * Saves the user's current filter selections to chrome.storage.local and localStorage.
 */
function savePreferences(): void {
  try {
    const logicInput = document.querySelector('input[name="logic"]:checked') as HTMLInputElement;
    const prefs: SavedPreferences = {
      logic: logicInput?.value || 'OR',
      titleContains: (getElementById('title-contains', HTMLInputElement))?.value || '',
      channelName: (getElementById('channel-name', HTMLInputElement))?.value || '',
      ageValue: (getElementById('video-age-value', HTMLInputElement))?.value || '',
      ageUnit: (getElementById('video-age-unit', HTMLSelectElement))?.value || 'days',
      isWatched: (getElementById('is-watched', HTMLInputElement))?.checked || false,
      watchedCriteria: (getElementById('watched-criteria', HTMLSelectElement))?.value || 'any',
      watchedValue: (getElementById('watched-value', HTMLInputElement))?.value || '',
      deleteUnavailable: (getElementById('delete-unavailable', HTMLInputElement))?.checked || false,
      deleteDuplicates: (getElementById('delete-duplicates', HTMLInputElement))?.checked || false,
      durationEnabled: (getElementById('duration-filter-enabled', HTMLInputElement))?.checked || false,
      durationCriteria: (getElementById('duration-criteria', HTMLSelectElement))?.value || 'shorts',
      durationMinutes: (getElementById('duration-minutes', HTMLInputElement))?.value || '',
      durationSeconds: (getElementById('duration-seconds', HTMLInputElement))?.value || '',
      dryRun: (getElementById('dry-run', HTMLInputElement))?.checked || false
    };

    // Primary: chrome.storage.local (persists across popup closes and restarts)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [SETTINGS_KEY]: prefs }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Could not save to chrome.storage.local:', chrome.runtime.lastError.message);
        }
      });
    }

    // Secondary fallback: localStorage
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore localStorage errors
    }
  } catch (err) {
    console.error('Failed to save filter preferences:', err);
  }
}

/**
 * Applies saved preferences to the popup UI elements.
 */
function applyPreferences(prefs: SavedPreferences): void {
  if (!prefs) return;

  if (prefs.logic) {
    const radio = document.querySelector(`input[name="logic"][value="${prefs.logic}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;
  }
  const titleInput = getElementById('title-contains', HTMLInputElement);
  if (titleInput && prefs.titleContains !== undefined) titleInput.value = prefs.titleContains;

  const channelInput = getElementById('channel-name', HTMLInputElement);
  if (channelInput && prefs.channelName !== undefined) channelInput.value = prefs.channelName;

  const ageValue = getElementById('video-age-value', HTMLInputElement);
  if (ageValue && prefs.ageValue !== undefined) ageValue.value = prefs.ageValue;

  const ageUnit = getElementById('video-age-unit', HTMLSelectElement);
  if (ageUnit && prefs.ageUnit !== undefined) ageUnit.value = prefs.ageUnit;

  const isWatched = getElementById('is-watched', HTMLInputElement);
  const watchedOpts = getElementById('watched-options', HTMLDivElement);
  if (isWatched && prefs.isWatched !== undefined) {
    isWatched.checked = prefs.isWatched;
    if (watchedOpts) watchedOpts.style.display = prefs.isWatched ? 'grid' : 'none';
  }

  const watchedCrit = getElementById('watched-criteria', HTMLSelectElement);
  const watchedVal = getElementById('watched-value', HTMLInputElement);
  if (watchedCrit && prefs.watchedCriteria !== undefined) {
    watchedCrit.value = prefs.watchedCriteria;
    if (watchedVal) {
      const isPercent = prefs.watchedCriteria === 'percent';
      watchedVal.style.display = isPercent ? 'inline-block' : 'none';
      if (isPercent) {
        watchedVal.placeholder = '%';
        watchedVal.setAttribute('min', '1');
        watchedVal.setAttribute('max', '100');
        watchedVal.setAttribute('step', '1');
        watchedVal.setAttribute('inputmode', 'numeric');
      }
    }
  }
  if (watchedVal && prefs.watchedValue !== undefined) {
    watchedVal.value = prefs.watchedValue;
  }

  const delUnavail = getElementById('delete-unavailable', HTMLInputElement);
  if (delUnavail && prefs.deleteUnavailable !== undefined) delUnavail.checked = prefs.deleteUnavailable;

  const delDupes = getElementById('delete-duplicates', HTMLInputElement);
  if (delDupes && prefs.deleteDuplicates !== undefined) delDupes.checked = prefs.deleteDuplicates;

  const durEnabled = getElementById('duration-filter-enabled', HTMLInputElement);
  const durOpts = getElementById('duration-options', HTMLDivElement);
  if (durEnabled && prefs.durationEnabled !== undefined) {
    durEnabled.checked = prefs.durationEnabled;
    if (durOpts) durOpts.style.display = prefs.durationEnabled ? 'grid' : 'none';
  }

  const durCrit = getElementById('duration-criteria', HTMLSelectElement);
  const durTimeInputs = document.getElementById('duration-time-inputs') as HTMLElement | null;
  if (durCrit && prefs.durationCriteria !== undefined) {
    durCrit.value = prefs.durationCriteria;
    if (durTimeInputs) {
      durTimeInputs.style.display = (prefs.durationCriteria === 'shorter' || prefs.durationCriteria === 'longer') ? 'inline-flex' : 'none';
    }
  }

  const durMin = getElementById('duration-minutes', HTMLInputElement);
  if (durMin && prefs.durationMinutes !== undefined) durMin.value = prefs.durationMinutes;

  const durSec = getElementById('duration-seconds', HTMLInputElement);
  if (durSec && prefs.durationSeconds !== undefined) durSec.value = prefs.durationSeconds;

  const dryRun = getElementById('dry-run', HTMLInputElement);
  if (dryRun && prefs.dryRun !== undefined) dryRun.checked = prefs.dryRun;
}

/**
 * Restores user's filter selections from chrome.storage.local or localStorage.
 */
function loadPreferences(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([SETTINGS_KEY], (result) => {
        if (result && result[SETTINGS_KEY]) {
          applyPreferences(result[SETTINGS_KEY]);
        } else {
          loadFromLocalStorage();
        }
      });
    } else {
      loadFromLocalStorage();
    }
  } catch (err) {
    console.error('Failed to load filter preferences:', err);
    loadFromLocalStorage();
  }
}

/**
 * Fallback to load preferences from localStorage.
 */
function loadFromLocalStorage(): void {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (!data) return;
    const prefs: SavedPreferences = JSON.parse(data);
    applyPreferences(prefs);
  } catch (err) {
    console.error('Failed to load filter preferences from localStorage:', err);
  }
}

/**
 * Initializes the event listeners and logic for the main UI.
 * This function is only called if the page is a valid YouTube playlist.
 */
function initializeMainContent() {
  const deleteButton = getElementById('delete-button', HTMLButtonElement);
  const exportButton = getElementById('export-button', HTMLButtonElement);
  const helpButton = getElementById('help-button', HTMLButtonElement);
  const helpModal = getElementById('help-modal', HTMLDivElement);
  const helpBackdrop = getElementById('help-backdrop', HTMLDivElement);
  const isWatchedCheckbox = getElementById('is-watched', HTMLInputElement);
  const watchedOptionsDiv = getElementById('watched-options', HTMLDivElement);
  const watchedCriteriaSelect = getElementById('watched-criteria', HTMLSelectElement);
  const watchedValueInput = getElementById('watched-value', HTMLInputElement);

  const durationEnabledCheckbox = getElementById('duration-filter-enabled', HTMLInputElement);
  const durationOptionsDiv = getElementById('duration-options', HTMLDivElement);
  const durationCriteriaSelect = getElementById('duration-criteria', HTMLSelectElement);
  const durationTimeInputs = document.getElementById('duration-time-inputs') as HTMLElement | null;

  // Restore saved preferences
  loadPreferences();

  // Help modal wiring
  const openHelp = () => {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'false');
    const content = document.getElementById('help-content') as HTMLDivElement | null;
    if (content) content.focus();
    activateFocusTrap(content);
  };
  const closeHelp = () => {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'true');
    if (helpButton) helpButton.focus();
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
      watchedOptionsDiv.style.display = isWatchedCheckbox.checked ? 'grid' : 'none';
      savePreferences();
    });
  }

  if (watchedCriteriaSelect && watchedValueInput) {
    watchedCriteriaSelect.addEventListener('change', () => {
      const showValueInput = watchedCriteriaSelect.value === 'percent';
      watchedValueInput.style.display = showValueInput ? 'inline-block' : 'none';
      if (watchedCriteriaSelect.value === 'percent') {
        watchedValueInput.placeholder = '%';
        watchedValueInput.setAttribute('min', '1');
        watchedValueInput.setAttribute('max', '100');
        watchedValueInput.setAttribute('step', '1');
        watchedValueInput.setAttribute('inputmode', 'numeric');
      } else {
        watchedValueInput.removeAttribute('min');
        watchedValueInput.removeAttribute('max');
        watchedValueInput.removeAttribute('step');
        watchedValueInput.removeAttribute('inputmode');
      }
      savePreferences();
    });

    watchedValueInput.addEventListener('input', () => {
      const raw = watchedValueInput.value;
      if (!raw) {
        savePreferences();
        return;
      }
      if (raw.includes('.')) {
        const intVal = Math.floor(parseFloat(raw));
        watchedValueInput.value = isNaN(intVal) ? '' : String(intVal);
      }
      const minAttr = watchedValueInput.getAttribute('min');
      const maxAttr = watchedValueInput.getAttribute('max');
      const min = minAttr ? parseInt(minAttr, 10) : undefined;
      const max = maxAttr ? parseInt(maxAttr, 10) : undefined;
      const current = parseInt(watchedValueInput.value, 10);
      if (!isNaN(current)) {
        if (min !== undefined && current < min) watchedValueInput.value = String(min);
        if (max !== undefined && current > max) watchedValueInput.value = String(max);
      }
      savePreferences();
    });
    watchedValueInput.addEventListener('change', savePreferences);
    watchedValueInput.addEventListener('blur', savePreferences);
  }

  // --- Event Listeners for Duration Filter ---
  if (durationEnabledCheckbox && durationOptionsDiv) {
    durationEnabledCheckbox.addEventListener('change', () => {
      durationOptionsDiv.style.display = durationEnabledCheckbox.checked ? 'grid' : 'none';
      savePreferences();
    });
  }

  if (durationCriteriaSelect && durationTimeInputs) {
    durationCriteriaSelect.addEventListener('change', () => {
      const isCustomTime = durationCriteriaSelect.value === 'shorter' || durationCriteriaSelect.value === 'longer';
      durationTimeInputs.style.display = isCustomTime ? 'inline-flex' : 'none';
      savePreferences();
    });
  }

  // Auto-save on logic radio buttons
  document.querySelectorAll<HTMLInputElement>('input[name="logic"]').forEach((r) => {
    r.addEventListener('change', savePreferences);
  });

  // Auto-save on inputs
  const autoSaveInputs = ['title-contains', 'channel-name', 'video-age-value', 'video-age-unit', 'delete-unavailable', 'delete-duplicates', 'duration-minutes', 'duration-seconds', 'dry-run'];
  for (const id of autoSaveInputs) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', savePreferences);
      el.addEventListener('input', savePreferences);
    }
  }

  // --- Playlist Export Button ---
  if (exportButton) {
    if (!exportButton.dataset.listenerAttached) {
      exportButton.dataset.listenerAttached = 'true';
      exportButton.addEventListener('click', () => {
        savePreferences();
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'exportPlaylist', format: 'csv' }, () => {
              if (chrome.runtime.lastError) {
                console.error('Error sending export message:', chrome.runtime.lastError.message);
                alert('Could not connect to the YouTube playlist page. Please try refreshing.');
              } else {
                window.close();
              }
            });
          }
        });
      });
    }
  }

  // --- Delete Button Handler ---
  if (deleteButton) {
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
        const deleteDuplicatesCheckbox = getElementById('delete-duplicates', HTMLInputElement);
        const dryRunCheckbox = getElementById('dry-run', HTMLInputElement);

        const ageValueStr = ageValueInput?.value;
        const ageUnit = ageUnitSelect?.value;
        const titleContains = titleContainsInput?.value;
        const channelName = channelNameInput?.value;
        const deleteUnavailable = deleteUnavailableCheckbox?.checked || false;
        const deleteDuplicates = deleteDuplicatesCheckbox?.checked || false;
        const isDryRun = dryRunCheckbox?.checked || false;

        if (ageValueStr) {
          const ageValue = parseInt(ageValueStr, 10);
          if (isNaN(ageValue) || ageValue <= 0) {
            alert('Video age must be a positive number.');
            return;
          }
        }
        
        // Build the watched filter object
        const watchedCriteria = watchedCriteriaSelect?.value || 'any';
        const watchedValueStr = watchedValueInput?.value;
        let watchedValue = 0;
        if (watchedValueStr) {
          const parsedValue = parseInt(watchedValueStr, 10);
          if (isNaN(parsedValue) || parsedValue <= 0) {
            alert('Watched value must be a positive whole number.');
            return;
          }
          if (watchedCriteria === 'percent' && (parsedValue < 1 || parsedValue > 100)) {
            alert('Please enter a percentage between 1 and 100.');
            return;
          }
          watchedValue = parsedValue;
        }

        let isWatchedEnabled = isWatchedCheckbox?.checked || false;
        if (isWatchedEnabled) {
          if (watchedCriteria === 'percent') {
            if (!watchedValue || watchedValue <= 0) {
              alert('Please enter a percentage between 1 and 100 for the watched criteria.');
              return;
            }
            isWatchedEnabled = true;
          } else {
            isWatchedEnabled = true;
          }
        }

        // Build duration filter object
        let durationFilter: { criteria: 'shorts' | 'shorter' | 'longer'; value?: number } | undefined = undefined;
        if (durationEnabledCheckbox?.checked) {
          const crit = (durationCriteriaSelect?.value as 'shorts' | 'shorter' | 'longer') || 'shorts';
          if (crit === 'shorts') {
            durationFilter = { criteria: 'shorts', value: 60 };
          } else {
            const minInput = getElementById('duration-minutes', HTMLInputElement);
            const secInput = getElementById('duration-seconds', HTMLInputElement);
            const min = parseInt(minInput?.value || '0', 10);
            const sec = parseInt(secInput?.value || '0', 10);
            const totalSec = (isNaN(min) ? 0 : min) * 60 + (isNaN(sec) ? 0 : sec);
            if (totalSec <= 0) {
              alert('Please enter a duration greater than 0 for the duration filter.');
              return;
            }
            durationFilter = { criteria: crit, value: totalSec };
          }
        }

        savePreferences();

        const filters = {
          titleContains: titleContains,
          channelName: channelName,
          isWatched: {
            enabled: isWatchedEnabled,
            criteria: watchedCriteria,
            value: watchedValue,
          },
          deleteUnavailable: deleteUnavailable,
          deleteDuplicates: deleteDuplicates,
          duration: durationFilter,
          age: (ageValueStr && ageUnit) ? { value: parseInt(ageValueStr, 10), unit: ageUnit } : undefined,
        };

        // Send the command to the content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'deleteVideos', filters: filters, logic: logic, isDryRun: isDryRun }, () => {
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
