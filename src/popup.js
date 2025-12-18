/* popup.js - runtime JS for the extension popup
   This is a direct JavaScript implementation of the popup logic so the
   popup works even when TypeScript isn't compiled during development.
*/

// Simple helper to get element by ID
function $id(id) {
  return document.getElementById(id);
}

// Ensure content script is injected and ready, then call callback
function ensureContentScriptReady(tabId, callback) {
  try {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, function(response) {
      if (chrome.runtime.lastError) {
        // Not injected, inject now
        chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, function() {
          if (chrome.runtime.lastError) {
            console.error('Failed to inject content script:', chrome.runtime.lastError.message);
            alert('Failed to inject the content script. Please try refreshing the page.');
          } else {
            callback();
          }
        });
      } else if (response && response.status === 'ready') {
        callback();
      } else {
        // Ping response unexpected; attempt injection silently
        chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, callback);
      }
    });
  } catch (e) {
    console.error('ensureContentScriptReady error:', e);
    // best-effort: try to inject
    try {
      chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, callback);
    } catch (err) {
      console.error('Failed to execute scripting API:', err);
      alert('Could not ensure content script.');
    }
  }
}

// DOMContentLoaded entry
document.addEventListener('DOMContentLoaded', function() {
  var mainContent = $id('main-content');
  var errorContent = $id('error-content');
  var versionDisplay = $id('version-display');

  if (!mainContent || !errorContent) {
    console.error('Could not find main or error content divs.');
    return;
  }

  if (versionDisplay) {
    try {
      var manifest = chrome.runtime.getManifest();
      versionDisplay.textContent = 'v' + (manifest && manifest.version ? manifest.version : '');
    } catch (e) {
      /* ignore manifest read errors to avoid console noise */
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var currentTab = (tabs && tabs[0]) || null;
    if (!currentTab || !currentTab.url || !currentTab.id) {
      mainContent.style.display = 'none';
      errorContent.style.display = 'block';
      return;
    }
    if (currentTab.url.includes('youtube.com/playlist?list=')) {
      ensureContentScriptReady(currentTab.id, function() {
        mainContent.style.display = 'block';
        errorContent.style.display = 'none';
        initializeMainContent();
      });
    } else {
      mainContent.style.display = 'none';
      errorContent.style.display = 'block';
    }
  });
});

// Initialize UI logic
function initializeMainContent() {
  var deleteButton = $id('delete-button');
  var helpButton = $id('help-button');
  var helpModal = $id('help-modal');
  var helpBackdrop = $id('help-backdrop');
  var helpClose = null; // top close removed; use bottom close button as focus target
  var isWatchedCheckbox = $id('is-watched');
  var watchedOptionsDiv = $id('watched-options');
  var watchedCriteriaSelect = $id('watched-criteria');
  var watchedValueInput = $id('watched-value');

  // Help modal wiring
  function openHelp() {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'false');
    // focus the modal content so keyboard users start at the top of the modal
    var content = $id('help-content');
    if (content) content.focus();
    // Add Escape handler while modal is open
    document.addEventListener('keydown', escKeyHandler);
    // Activate focus trap
    activateFocusTrap(content);
  }
  function closeHelp() {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'true');
    if (helpButton) helpButton.focus();
    // Remove Escape handler when modal closed
    document.removeEventListener('keydown', escKeyHandler);
    // Deactivate focus trap
    deactivateFocusTrap();
  }
  function escKeyHandler(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      closeHelp();
    }
  }
  if (helpButton) helpButton.addEventListener('click', openHelp);
  if (helpBackdrop) helpBackdrop.addEventListener('click', closeHelp);
  var helpCloseBottom = $id('help-close-bottom');
  if (helpCloseBottom) helpCloseBottom.addEventListener('click', closeHelp);

  // Watched filtering UI
  if (isWatchedCheckbox && watchedOptionsDiv) {
    isWatchedCheckbox.addEventListener('change', function() {
      watchedOptionsDiv.style.display = isWatchedCheckbox.checked ? 'flex' : 'none';
    });
  }
  if (watchedCriteriaSelect && watchedValueInput) {
    watchedCriteriaSelect.addEventListener('change', function() {
      var showValueInput = watchedCriteriaSelect.value === 'percent';
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
    });

    watchedValueInput.addEventListener('input', function() {
      var raw = watchedValueInput.value;
      if (!raw) return;
      if (raw.indexOf('.') !== -1) {
        var intVal = Math.floor(parseFloat(raw));
        watchedValueInput.value = isNaN(intVal) ? '' : String(intVal);
      }
      var minAttr = watchedValueInput.getAttribute('min');
      var maxAttr = watchedValueInput.getAttribute('max');
      var min = minAttr ? parseInt(minAttr, 10) : undefined;
      var max = maxAttr ? parseInt(maxAttr, 10) : undefined;
      var current = parseInt(watchedValueInput.value, 10);
      if (!isNaN(current)) {
        if (min !== undefined && current < min) watchedValueInput.value = String(min);
        if (max !== undefined && current > max) watchedValueInput.value = String(max);
      }
    });
  }

  if (deleteButton) {
    if (deleteButton.dataset.listenerAttached) return;
    deleteButton.dataset.listenerAttached = 'true';

    deleteButton.addEventListener('click', function() {
      try {
        var logicInput = document.querySelector('input[name="logic"]:checked');
        var logic = (logicInput && logicInput.value) ? logicInput.value : 'OR';

        var ageValueInput = $id('video-age-value');
        var ageUnitSelect = $id('video-age-unit');
        var titleContainsInput = $id('title-contains');
        var channelNameInput = $id('channel-name');
        var deleteUnavailableCheckbox = $id('delete-unavailable');
        var dryRunCheckbox = $id('dry-run');

        var ageValueStr = ageValueInput ? ageValueInput.value : '';
        var ageUnit = ageUnitSelect ? ageUnitSelect.value : '';
        var titleContains = titleContainsInput ? titleContainsInput.value : '';
        var channelName = channelNameInput ? channelNameInput.value : '';
        var deleteUnavailable = deleteUnavailableCheckbox ? deleteUnavailableCheckbox.checked : false;
        var isDryRun = dryRunCheckbox ? dryRunCheckbox.checked : false;

        if (ageValueStr) {
          var ageValue = parseInt(ageValueStr, 10);
          if (isNaN(ageValue) || ageValue <= 0) {
            alert('Video age must be a positive number.');
            return;
          }
        }

        var watchedCriteria = watchedCriteriaSelect ? watchedCriteriaSelect.value : 'any';
        var watchedValueStr = watchedValueInput ? watchedValueInput.value : '';
        var watchedValue = 0;
        if (watchedValueStr) {
          var parsedValue = parseInt(watchedValueStr, 10);
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

        var isWatchedEnabled = isWatchedCheckbox ? isWatchedCheckbox.checked : false;
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

        var filters = {
          titleContains: titleContains,
          channelName: channelName,
          isWatched: {
            enabled: isWatchedEnabled,
            criteria: watchedCriteria,
            value: watchedValue
          },
          deleteUnavailable: deleteUnavailable,
          age: (ageValueStr && ageUnit) ? { value: parseInt(ageValueStr, 10), unit: ageUnit } : undefined
        };

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs && tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'deleteVideos', filters: filters, logic: logic, isDryRun: isDryRun }, function() {
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
  // --- Focus trap implementation ---
  var _focusTrapHandler = null;
  function getFocusableElements(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'))
      .filter(function(el) { return !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'; });
  }
  function activateFocusTrap(root) {
    if (!root) return;
    var handler = function(e) {
      if (e.key !== 'Tab') return;
      var focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;
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
  }
  function deactivateFocusTrap() {
    if (_focusTrapHandler) {
      document.removeEventListener('keydown', _focusTrapHandler);
      _focusTrapHandler = null;
    }
  }
}
