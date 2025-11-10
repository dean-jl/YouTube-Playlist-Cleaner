/**
 * @file This is the core content script for the YouTube Playlist Trimmer extension.
 * It is injected into YouTube playlist pages and is responsible for all DOM manipulation,
 * including scrolling, data extraction, and video deletion.
 */

// --- Global State ---
let isCancelled = false;
const CANCEL_BUTTON_ID = 'yt-trimmer-cancel-button';

// --- Constants ---
const SELECTORS = {
  videoRenderer: 'ytd-playlist-video-renderer',
  videoTitle: '#video-title',
  channelName: 'ytd-channel-name a',
  watchedOverlay: 'ytd-thumbnail-overlay-playback-status-renderer',
  resumeOverlay: 'ytd-thumbnail-overlay-resume-playback-renderer',
  metaBlock: '#video-info span', // Corrected selector for age string
  menuButton: 'yt-icon-button.ytd-menu-renderer',
  menuPopup: 'ytd-menu-popup-renderer',
  removeMenuItem: 'ytd-menu-service-item-renderer',
  removeMenuItemText: 'yt-formatted-string',
  continuationSpinner: 'ytd-continuation-item-renderer',
};

// --- Interfaces ---

/** Represents the data extracted from a single video element on the page. */
interface VideoData {
  element: HTMLElement;
  title: string;
  channelName: string;
  isWatched: boolean;
  ageString?: string;
}

/** Represents the structure of the age filter from the popup. */
interface AgeFilter {
  value: number;
  unit: 'days' | 'weeks' | 'months' | 'years';
}

/** Represents the complete set of filters sent from the popup. */
interface Filters {
  titleContains?: string;
  channelName?: string;
  isWatched?: boolean;
  deleteUnavailable?: boolean; // New filter for private/deleted videos
  age?: AgeFilter;
}

/** Represents a video that has been matched for deletion, including the reasons why. */
interface DeletionCandidate {
  element: HTMLElement;
  title: string;
  reasons: string[];
}

/** Represents the final result of the deletion process. */
interface DeletionResult {
  summaryText: string;
  deletedCount: number;
}

// --- Helper Functions ---

/**
 * A simple promise-based delay function.
 * @param ms The number of milliseconds to wait.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits for a specific element to appear in the DOM.
 * @param selector The CSS selector for the element.
 * @param timeout The maximum time to wait in milliseconds.
 * @returns A promise that resolves with the element, or null if it times out.
 */
function waitForElement(selector: string, timeout = 5000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      console.warn(`waitForElement timed out for selector: ${selector}`);
      resolve(null);
    }, timeout);
  });
}

/**
 * Programmatically clicks an element and waits for a short delay.
 * @param element The HTMLElement to click.
 * @param delay The time to wait in milliseconds after the click.
 */
const clickElement = async (element: HTMLElement, delay = 100): Promise<void> => {
  element.click();
  await sleep(delay);
};

/**
 * Parses a filter string from an input field into an array of searchable terms.
 * This handles comma-separated values and quoted phrases for exact matching.
 * @example ' review, "let's play" ' -> ['review', 'let's play']
 * @param filterString The raw string from the input field.
 * @returns An array of lowercase search terms.
 */
const parseFilterString = (filterString: string | undefined): string[] => {
  if (!filterString) return [];
  const terms: string[] = [];
  const phraseRegex = /"([^"]+)"/g;
  let remainingString = filterString;
  let match;
  while ((match = phraseRegex.exec(filterString)) !== null) {
    const phrase = match[1].trim();
    if (phrase) terms.push(phrase.toLowerCase());
    remainingString = remainingString.replace(match[0], '');
  }
  const otherTerms = remainingString.split(',').map(term => term.trim().toLowerCase()).filter(term => term.length > 0);
  return [...terms, ...otherTerms];
};

// --- UI Functions ---

/**
 * Creates and injects a "Cancel" button onto the page.
 */
const createCancelButton = () => {
  const button = document.createElement('button');
  button.id = CANCEL_BUTTON_ID;
  button.textContent = 'Cancel Operation';
  Object.assign(button.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '9999', backgroundColor: '#f44336',
    color: 'white', border: 'none', borderRadius: '5px', padding: '15px', fontSize: '16px', cursor: 'pointer'
  });
  button.onclick = () => {
    console.log('Cancel button clicked by user.');
    isCancelled = true;
    button.textContent = 'Cancelling...';
    button.setAttribute('disabled', 'true');
  };
  document.body.appendChild(button);
};

/**
 * Removes the "Cancel" button from the page.
 */
const removeCancelButton = () => {
  const button = document.getElementById(CANCEL_BUTTON_ID);
  if (button) button.remove();
};

/**
 * Triggers a browser download for the summary text file.
 * @param summaryText The full text content of the summary.
 * @param videoCount The exact number of videos deleted, for the final alert.
 * @param isDryRun Whether the operation was a dry run.
 */
const downloadSummary = (summaryText: string, videoCount: number, isDryRun: boolean) => {
  if (videoCount === 0) {
    alert(summaryText); // Show messages like "No videos found" or "Cancelled"
    return;
  }
  const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.download = `youtube-trim-summary-${timestamp}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  const operationType = isDryRun ? 'Dry run completed.' : 'Deletion complete.';
  alert(`${operationType} A summary file for the ${videoCount} matched videos has been downloaded.`);
};

// --- Core Logic ---

/**
 * Extracts all relevant data from a single video renderer element.
 * @param videoElement The `<ytd-playlist-video-renderer>` element.
 * @returns A `VideoData` object, or `null` if essential data cannot be found.
 */
const extractVideoData = (videoElement: HTMLElement): VideoData | null => {
  const titleElement = videoElement.querySelector<HTMLElement>(SELECTORS.videoTitle);
  if (!titleElement) { // Only return null if title is not found, as it's essential
    return null;
  }
  const title = titleElement.innerText.trim();

  // Channel name might not exist for private/deleted videos, so handle gracefully
  const channelElement = videoElement.querySelector<HTMLElement>(SELECTORS.channelName);
  const channelName = channelElement ? channelElement.innerText.trim() : ''; // Default to empty string

  const isFullyWatched = videoElement.querySelector(SELECTORS.watchedOverlay) !== null;
  const isPartiallyWatched = videoElement.querySelector(SELECTORS.resumeOverlay) !== null;
  const isWatched = isFullyWatched || isPartiallyWatched;
  const metaDataSpans = videoElement.querySelectorAll<HTMLElement>(SELECTORS.metaBlock);
  const ageString = Array.from(metaDataSpans).find(el => el.textContent?.includes('ago'))?.textContent?.trim();
  return { element: videoElement, title, channelName, isWatched, ageString };
};

/**
 * Converts a relative time string (e.g., "3 weeks ago", "a year ago") into a number of days.
 * @param ageString The string to parse.
 * @returns The age in days, or `null` if parsing fails.
 */
const parseAgeToDays = (ageString: string): number | null => {
    if (!ageString) return null;

    // Match patterns like "a year ago", "an hour ago", "5 years ago"
    const match = ageString.match(/(a|an|\d+)\s+(day|week|month|year)/);
    if (!match) return null;

    const valueStr = match[1];
    const unitStr = match[2];

    const value = (valueStr === 'a' || valueStr === 'an') ? 1 : parseInt(valueStr, 10);
    
    switch (unitStr) {
        case 'day': return value;
        case 'week': return value * 7;
        case 'month': return value * 30; // Approximation
        case 'year': return value * 365; // Approximation
        default: return null;
    }
};

/**
 * Filters the list of all videos to find candidates for deletion based on user criteria.
 * @param videos The array of all `VideoData` objects from the page.
 * @param filters The filter criteria from the popup.
 * @param logic The matching logic to use, either 'AND' or 'OR'.
 * @returns An array of `DeletionCandidate` objects.
 */
const getVideosToDeleteAndReasons = (videos: VideoData[], filters: Filters, logic: 'AND' | 'OR'): DeletionCandidate[] => {
  const candidates: DeletionCandidate[] = [];
  const titleSearchTerms = parseFilterString(filters.titleContains);
  const channelSearchTerms = parseFilterString(filters.channelName);
  
  let filterAgeInDays: number | null = null;
  if (filters.age && filters.age.value) {
    const { value, unit } = filters.age;
    switch (unit) {
        case 'days': filterAgeInDays = value; break;
        case 'weeks': filterAgeInDays = value * 7; break;
        case 'months': filterAgeInDays = value * 30; break;
        case 'years': filterAgeInDays = value * 365; break;
    }
  }
  
  const activeFilterCount = [
    filters.isWatched, 
    filters.deleteUnavailable,
    titleSearchTerms.length > 0, 
    channelSearchTerms.length > 0, 
    filterAgeInDays !== null
  ].filter(Boolean).length;

  for (const video of videos) {
    const reasons: string[] = [];
    if (filters.isWatched && video.isWatched) {
      reasons.push('Is watched');
    }
    if (filters.deleteUnavailable && (video.title === '[Private video]' || video.title === '[Deleted video]')) {
      reasons.push('Is unavailable ([Private video] or [Deleted video])');
    }
    if (titleSearchTerms.length > 0) {
      const foundTerm = titleSearchTerms.find(term => video.title.toLowerCase().includes(term));
      if (foundTerm) {
        reasons.push(`Title contains '${foundTerm}'`);
      }
    }
    if (channelSearchTerms.length > 0) {
      const foundTerm = channelSearchTerms.find(term => video.channelName.toLowerCase().includes(term));
      if (foundTerm) {
        reasons.push(`Channel contains '${foundTerm}'`);
      }
    }
    if (filterAgeInDays !== null && video.ageString) {
        const videoAgeInDays = parseAgeToDays(video.ageString);
        if (videoAgeInDays !== null && videoAgeInDays > filterAgeInDays) {
            reasons.push(`Is older than ${filters.age?.value} ${filters.age?.unit}`);
        }
    }

    const matchesOr = reasons.length > 0;
    const matchesAnd = reasons.length === activeFilterCount && activeFilterCount > 0;

    if ((logic === 'OR' && matchesOr) || (logic === 'AND' && matchesAnd)) {
      candidates.push({ element: video.element, title: video.title, reasons: reasons });
    }
  }
  return candidates;
};

/**
 * Deletes a list of videos and generates a summary of the operation.
 * @param candidates The list of videos to delete.
 * @param filters The original filters used, for the summary header.
 * @param logic The matching logic used, for the summary header.
 * @param isDryRun If true, no actual deletions will occur.
 * @returns A `DeletionResult` object containing the summary text and the count of deleted videos.
 */
const deleteVideosAndCreateSummary = async (candidates: DeletionCandidate[], filters: Filters, logic: 'AND' | 'OR', isDryRun: boolean): Promise<DeletionResult> => {
  const operationVerb = isDryRun ? 'identify' : 'delete';
  alert(`Found ${candidates.length} videos that match your criteria. The ${operationVerb} process will now begin. Please do not interact with the page.`);
  const deletedVideoSummaries: string[] = [];

  for (const candidate of candidates) {
    if (isCancelled) break;
    const videoElement = candidate.element;
    videoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200); // Wait for scroll

    if (isDryRun) {
      console.log(`Dry Run: Would have removed: ${candidate.title}`);
      deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})`);
      continue; // Skip actual deletion
    }

    const menuButton = videoElement.querySelector<HTMLElement>(SELECTORS.menuButton);
    if (!menuButton) continue;
    await clickElement(menuButton);
    
    const menuPopup = await waitForElement(SELECTORS.menuPopup, 3000);
    if (menuPopup) {
      const menuItems = menuPopup.querySelectorAll<HTMLElement>(SELECTORS.removeMenuItem);
      const removeItemButton = Array.from(menuItems).find(item => 
        item.textContent?.trim().startsWith('Remove from')
      );

      if (removeItemButton) {
        await clickElement(removeItemButton, 300);
        console.log(`Removed: ${candidate.title}`);
        deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})`);
      } else {
        console.error("Could not find 'Remove from' button in menu for video:", candidate.title);
        document.body.click(); // Dismiss menu
        await sleep(100);
      }
    } else {
      console.error("Could not find menu popup for video:", candidate.title);
    }
  }

  const deletedCount = deletedVideoSummaries.length;
  let summaryText: string;

  if (deletedCount === 0) {
    summaryText = isCancelled ? "Operation was cancelled before any videos were processed." : "No videos were ultimately processed. This may happen if the 'Remove from' button could not be found for the matched videos (in a real run).";
  } else {
    let criteriaHeader = `Search Criteria (Match ${logic}):\n`;
    if (filters.isWatched) criteriaHeader += `- Is Watched\n`;
    if (filters.deleteUnavailable) criteriaHeader += `- Delete Unavailable Videos\n`; // Add to summary
    if (filters.titleContains) criteriaHeader += `- Title Contains: ${filters.titleContains}\n`;
    if (filters.channelName) criteriaHeader += `- Channel Contains: ${filters.channelName}\n`;
    if (filters.age) criteriaHeader += `- Older Than: ${filters.age.value} ${filters.age.unit}\n`;
    criteriaHeader += '---\n\n';

    const summaryHeader = isDryRun ? 
      `Dry Run Summary (${deletedCount} videos would be removed):\n\n` :
      `Deletion Summary (${deletedCount} videos removed):\n\n`;
    summaryText = criteriaHeader + summaryHeader + deletedVideoSummaries.join('\n');
  }
  
  return { summaryText, deletedCount };
};

/**
 * Scrolls down the playlist page to ensure all videos are loaded into the DOM.
 * @returns A promise that resolves with the total number of videos found.
 */
const loadAllVideos = async (): Promise<number> => {
  const MAX_SCROLLS = 100;
  let lastVideoCount = 0;
  let stableScrolls = 0;

  for (let i = 0; i < MAX_SCROLLS; i++) {
    if (isCancelled) {
      console.log('Loading cancelled by user.');
      break;
    }
    
    const continuationSpinner = document.querySelector(SELECTORS.continuationSpinner);
    if (!continuationSpinner) {
      console.log("No continuation spinner found. Assuming end of list.");
      break;
    }
    
    console.log(`[Scroll ${i + 1}/${MAX_SCROLLS}] Scrolling to load more videos...`);
    continuationSpinner.scrollIntoView({ behavior: 'smooth', block: 'end' });
    await sleep(2000); // Wait for new content to potentially load

    const currentVideoCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
    if (currentVideoCount === lastVideoCount) {
      stableScrolls++;
      console.log(`Video count is stable at ${currentVideoCount}. Stable scrolls: ${stableScrolls}`);
    } else {
      lastVideoCount = currentVideoCount;
      stableScrolls = 0; // Reset if new videos are loaded
    }

    if (stableScrolls >= 3) {
      console.log("Video count has been stable for 3 consecutive checks. Assuming end of list.");
      break;
    }
  }

  const finalCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
  console.log(`Finished loading. Total videos found: ${finalCount}`);
  return finalCount;
};

/**
 * The main entry point for the deletion process, triggered by a message from the popup.
 * @param filters The filter criteria from the popup.
 * @param logic The matching logic ('AND' or 'OR').
 * @param isDryRun If true, no actual deletions will occur.
 */
const handleDeleteRequest = async (filters: Filters, logic: 'AND' | 'OR', isDryRun: boolean) => {
  isCancelled = false;
  createCancelButton();
  try {
    const operationType = isDryRun ? 'dry run' : 'deletion';
    alert(`Starting ${operationType}... The extension will now scroll down to load all videos in your playlist. Please wait.`);
    await loadAllVideos();
    if (isCancelled) {
      alert('Operation cancelled during video loading.');
      return;
    }
    const videoElements = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.videoRenderer));
    const allVideos = videoElements.map(extractVideoData).filter((v): v is VideoData => v !== null);
    console.log(`Extraction complete. Found data for ${allVideos.length} videos.`);
    const videosToDelete = getVideosToDeleteAndReasons(allVideos, filters, logic);
    if (videosToDelete.length > 0) {
      const result = await deleteVideosAndCreateSummary(videosToDelete, filters, logic, isDryRun);
      downloadSummary(result.summaryText, result.deletedCount, isDryRun);
    } else {
      alert('No videos found matching your criteria.');
    }
  } catch (error) {
    console.error('An error occurred during the operation:', error);
    alert('An unexpected error occurred. Check the console for details.');
  } finally {
    removeCancelButton();
    isCancelled = false;
    console.log('Operation finished or cancelled. Cleaned up.');
  }
};

// Listen for the message from the popup script.
chrome.runtime.onMessage.addListener((request: { action: string, filters: Filters, logic: 'AND' | 'OR', isDryRun: boolean }, sender, sendResponse) => {
  if (request.action === 'deleteVideos') {
    handleDeleteRequest(request.filters, request.logic || 'OR', request.isDryRun || false);
    sendResponse({ status: 'started' });
    return true; // Indicates an asynchronous response.
  }
});
