// Guard against double-injection: if the page already ran this content script, skip re-initializing.
if ((window as any).__YPC_CONTENT_SCRIPT_INITIALIZED) {
  // already initialized in this page context — no-op
} else {
  (window as any).__YPC_CONTENT_SCRIPT_INITIALIZED = true;

  /**
   * @file This is the core content script for the YouTube Playlist Cleaner extension.
   * It is injected into YouTube playlist pages and is responsible for all DOM manipulation,
   * including scrolling, data extraction, and video deletion.
   */

  // --- Global State ---
  let isCancelled = false;
  // debug flag removed; content script will not emit debug logs by default

  const CANCEL_BUTTON_ID = 'yt-cleaner-cancel-button';

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
    watchPercentage: number;
    ageString?: string;
    videoUrl?: string; // full absolute URL to the video when available
  }

  /** Represents the structure of the age filter from the popup. */
  interface AgeFilter {
    value: number;
    unit: 'days' | 'weeks' | 'months' | 'years';
  }

  /** Represents the structure of the watched filter from the popup. */
  interface WatchedFilter {
    enabled: boolean;
    criteria: 'any' | 'seconds' | 'percent';
    value: number;
  }

  /** Represents the complete set of filters sent from the popup. */
  interface Filters {
    titleContains?: string;
    channelName?: string;
    isWatched?: WatchedFilter;
    deleteUnavailable?: boolean; // New filter for private/deleted videos
    age?: AgeFilter;
  }

  /** Represents a video that has been matched for deletion, including the reasons why. */
  interface DeletionCandidate {
    element: HTMLElement;
    title: string;
    reasons: string[];
    videoUrl?: string;
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
    link.download = `youtube-cleaner-summary-${timestamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const operationType = isDryRun ? 'Dry run completed.' : 'Deletion complete.';
    alert(`${operationType} A summary file for the ${videoCount} matched videos has been downloaded.`);
  };

  /**
   * On-screen status indicator for loading progress.
   */
  const STATUS_ID = 'yt-cleaner-status';
  const showStatus = () => {
    if (document.getElementById(STATUS_ID)) return;
    const container = document.createElement('div');
    container.id = STATUS_ID;
    Object.assign(container.style, {
      // position the toast near the bottom-right but above the cancel button
      position: 'fixed', bottom: '80px', right: '12px', zIndex: '10000', background: 'rgba(0,0,0,0.8)',
      color: 'white', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', maxWidth: '320px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)', fontFamily: 'Arial, sans-serif'
    });
    container.textContent = 'Loading playlist...';
    document.body.appendChild(container);
  };

  const updateStatus = (text: string) => {
    const el = document.getElementById(STATUS_ID);
    if (el) el.textContent = text;
  };

  const hideStatus = () => {
    const el = document.getElementById(STATUS_ID);
    if (el) el.remove();
  };

  /**
   * Scrolls down the playlist page to ensure all videos are loaded into the DOM.
   * Combined approach: uses MutationObserver to detect node additions, IntersectionObserver
   * to track visibility of the last node, and scrollHeight comparisons. The routine
   * first scrolls to the top (so we start from a deterministic state regardless of
   * where the user scrolled), then actively scrolls to bottom and nudges until the
   * playlist finishes loading. Restores user's scroll position when finished.
   * @returns A promise that resolves with the total number of videos found.
   */
  const loadAllVideos = async (showStatusFlag = true): Promise<number> => {
    const WAIT_GROW_MS = 1400; // how long to wait for growth after each scroll
    const POLL_INTERVAL = 150;
    const NO_GROW_THRESHOLD = 2; // quicker stop but still allow a retry
    const MAX_TOTAL_MS = 120_000; // global safety cap

    if (showStatusFlag) showStatus();

    // Remember user's scroll so we can restore it later
    const originalScroll = window.scrollY || window.pageYOffset || 0;

    // Ensure a consistent starting point: scroll to top to load initial nodes reliably
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
    await sleep(250);

    const playlistContainer = document.querySelector('ytd-playlist-video-list-renderer') || document.querySelector(SELECTORS.videoRenderer)?.parentElement || document.body;

    let lastCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
    let prevScrollHeight = document.documentElement.scrollHeight;
    let noGrowCount = 0;

    // Set up a mutation observer to quickly detect node additions
    let mutationObserved = false;
    const mo = new MutationObserver(() => { mutationObserved = true; });
    try { mo.observe(playlistContainer as Node, { childList: true, subtree: true }); } catch (e) { /* ignore */ }

    // IntersectionObserver to know when the current last node is visible
    let lastNodeVisible = false;
    let io: any = null;
    const observeLastNode = (node: Element | null) => {
      if (io) {
        try { io.disconnect(); } catch (e) { }
        io = null;
      }
      lastNodeVisible = false;
      if (!node) return;
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) lastNodeVisible = true;
        }
      }, { root: null, threshold: 0.01 });
      try { io.observe(node); } catch (e) { /* ignore */ }
    };

    const startTime = Date.now();

    while (Date.now() - startTime < MAX_TOTAL_MS) {
      if (isCancelled) break;

      // Strong nudge: scroll to document bottom which reliably triggers lazy-load
      try { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }); }
      catch (e) { window.scrollBy({ top: window.innerHeight, behavior: 'auto' }); }

      // short settle
      await sleep(220);

      // Update last-node observation
      const nodes = document.querySelectorAll<HTMLElement>(SELECTORS.videoRenderer);
      const currentLastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      observeLastNode(currentLastNode);

      if (showStatusFlag) updateStatus(`Loading playlist... ${lastCount} items loaded`);

      // Wait for short period to detect growth via mutation, new nodes, or scrollHeight increase
      mutationObserved = false;
      const grew = await new Promise<boolean>((resolve) => {
        const t0 = Date.now();
        const check = () => {
          const curCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
          const curHeight = document.documentElement.scrollHeight;
          if (curCount > lastCount) return resolve(true);
          if (curHeight > prevScrollHeight) return resolve(true);
          if (mutationObserved) return resolve(true);
          if (Date.now() - t0 > WAIT_GROW_MS) return resolve(false);
          setTimeout(check, POLL_INTERVAL);
        };
        check();
      });

      const currentCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
      const currentHeight = document.documentElement.scrollHeight;

      if (grew && currentCount > lastCount) {
        lastCount = currentCount;
        prevScrollHeight = currentHeight;
        noGrowCount = 0;
        // continue loading
        continue;
      }

      // No growth this round
      noGrowCount++;

      // Check for continuation spinner and last node visibility for decisive end detection
      const continuationSpinner = document.querySelector(SELECTORS.continuationSpinner) as HTMLElement | null;
      const nodesAfter = document.querySelectorAll<HTMLElement>(SELECTORS.videoRenderer);
      const lastNodeAfter = nodesAfter.length > 0 ? nodesAfter[nodesAfter.length - 1] : null;
      // lastNodeVisible is updated by IntersectionObserver

      if (showStatusFlag) updateStatus(`Loading playlist... ${nodesAfter.length} items loaded` + (continuationSpinner ? ' (loading...)' : ''));

      // If no spinner present and the last node is visible, assume end.
      if (!continuationSpinner && lastNodeVisible) {
        break;
      }

      // If we've had a couple of no-growth rounds, assume end to keep it timely
      if (noGrowCount >= NO_GROW_THRESHOLD) {
        break;
      }

      // Otherwise nudge a little further down and repeat
      try { window.scrollBy({ top: Math.max(window.innerHeight * 0.8, 800), behavior: 'auto' }); } catch (e) { }
      await sleep(180);
    }

    // Cleanup observers
    try { mo.disconnect(); } catch (e) { }
    if (io && typeof (io as any).disconnect === 'function') try { (io as any).disconnect(); } catch (e) { }

    // Restore user's original scroll position so we don't disrupt their browsing context
    try { window.scrollTo({ top: originalScroll, behavior: 'auto' }); } catch (e) { window.scrollTo(0, originalScroll); }

    const finalCount = document.querySelectorAll(SELECTORS.videoRenderer).length;
    if (showStatusFlag) updateStatus(`Loaded ${finalCount} videos.`);
    await sleep(500);
    if (showStatusFlag) hideStatus();

    // finished loading
    return finalCount;
  };

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
    const resumeOverlay = videoElement.querySelector<HTMLElement>(SELECTORS.resumeOverlay);
    const isPartiallyWatched = resumeOverlay !== null;
    const isWatched = isFullyWatched || isPartiallyWatched;

    let watchPercentage = 0;
    // Prefer the resume overlay progress when present (it can be more accurate).
    if (isPartiallyWatched && resumeOverlay) {
      const progressBar = resumeOverlay.querySelector<HTMLElement>('#progress');
      if (progressBar && progressBar.style.width) {
        watchPercentage = parseInt(progressBar.style.width, 10) || 0;
      }
    } else if (isFullyWatched) {
      // Fallback: if only the fully watched overlay is present, treat as 100%.
      watchPercentage = 100;
    }

    const metaDataSpans = videoElement.querySelectorAll<HTMLElement>(SELECTORS.metaBlock);
    const ageString = Array.from(metaDataSpans).find(el => el.textContent?.includes('ago'))?.textContent?.trim();
    // Try to extract video URL from the title anchor
    let videoUrl: string | undefined = undefined;
    try {
      const titleAnchor = titleElement as HTMLAnchorElement | null;
      if (titleAnchor && titleAnchor.getAttribute) {
        const href = titleAnchor.getAttribute('href');
        if (href) {
          if (href.startsWith('http')) videoUrl = href;
          else if (href.startsWith('/')) videoUrl = 'https://www.youtube.com' + href;
        }
      }
    } catch (e) { /* ignore */ }
    return { element: videoElement, title, channelName, isWatched, watchPercentage, ageString, videoUrl };
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
      filters.isWatched?.enabled,
      filters.deleteUnavailable,
      titleSearchTerms.length > 0,
      channelSearchTerms.length > 0,
      filterAgeInDays !== null
    ].filter(Boolean).length;

    for (const video of videos) {
      const reasons: string[] = [];

      if (filters.isWatched && filters.isWatched.enabled) {
        const { criteria, value } = filters.isWatched;
        let match = false;
        // Defensive check: only apply percent criteria when the provided value is a positive integer.
        if (criteria === 'any' && video.isWatched) {
          match = true;
          reasons.push('Is watched (any duration)');
        } else if (criteria === 'percent') {
          // Only consider numeric comparisons when value is valid (>0)
          if (value > 0 && video.watchPercentage >= value) {
            match = true;
            reasons.push(`Watched for at least ${value}%`);
          }
        }
        // Future 'seconds' criteria would go here
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
        candidates.push({ element: video.element, title: video.title, reasons: reasons, videoUrl: (video as VideoData).videoUrl });
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

    // Prepare on-screen status for per-video progress (disabled for dry run)
    const total = candidates.length;
    const showToasts = !isDryRun;
    if (showToasts) { showStatus(); updateStatus(`${isDryRun ? 'Identifying' : 'Removing'} 0 of ${total}...`); }

    const deletedVideoSummaries: string[] = [];
    const failedRemovals: { title: string, reasons: string[], videoUrl?: string }[] = []; // Track failed removals with optional URL

    // Helper to avoid including URLs for inaccessible items
    const isUnavailableTitle = (t?: string) => {
      if (!t) return false;
      const tt = t.trim();
      return tt === '[Private video]' || tt === '[Deleted video]';
    };

    for (let idx = 0; idx < candidates.length; idx++) {
      const candidate = candidates[idx];
      if (isCancelled) {
        if (showToasts) updateStatus(`Cancelled at ${idx} of ${total}.`);
        break;
      }

      const safeTitle = (candidate.title || '(untitled)').replace(/\s+/g, ' ').trim();
      const shortTitle = safeTitle.length > 80 ? safeTitle.slice(0, 77) + '...' : safeTitle;
      const verb = isDryRun ? 'Identifying' : 'Removing';
      if (showToasts) updateStatus(`${verb} ${idx + 1} of ${total}: ${shortTitle}`);

      const videoElement = candidate.element;

      // For a dry run we don't need to interact with the page; just record the summary.
      if (isDryRun) {
        // Include URL when available in dry-run output, but skip for unavailable titles
        const hasUrl = (candidate.videoUrl && !isUnavailableTitle(candidate.title));
        if (hasUrl) {
          // Put Reason line before the URL
          deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})\n  ${candidate.videoUrl}`);
        } else {
          deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})`);
        }
        // small pause so status is perceivable for very fast loops
        await sleep(60);
        continue; // Skip actual deletion and avoid scrolling/interacting
      }

      // Actual deletion path: scroll to the video and interact with the menu to remove it.
      try {
        videoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200); // Wait for scroll

        const menuButton = videoElement.querySelector<HTMLElement>(SELECTORS.menuButton);
        if (!menuButton) {
          // couldn't find the menu button; cannot remove this video — record as a failure and continue
          console.error("Could not find menu button for video:", candidate.title);
          failedRemovals.push({ title: candidate.title, reasons: ['Menu button not found'], videoUrl: candidate.videoUrl });
          continue;
        }
        await clickElement(menuButton);

        const menuPopup = await waitForElement(SELECTORS.menuPopup, 3000);
        if (menuPopup) {
          const menuItems = menuPopup.querySelectorAll<HTMLElement>(SELECTORS.removeMenuItem);
          const removeItemButton = Array.from(menuItems).find(item =>
            item.textContent?.trim().startsWith('Remove from')
          );

          if (removeItemButton) {
            await clickElement(removeItemButton, 300);
            const hasUrl = (candidate.videoUrl && !isUnavailableTitle(candidate.title));
            if (hasUrl) {
              // Put Reason line before the URL
              deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})\n  ${candidate.videoUrl}`);
            } else {
              deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})`);
            }
          } else {
            console.error("Could not find 'Remove from' button in menu for video:", candidate.title);
            document.body.click(); // Dismiss menu
            await sleep(100);
            failedRemovals.push({ title: candidate.title, reasons: ['Remove button not found in menu'], videoUrl: candidate.videoUrl });
          }
        } else {
          console.error("Could not find menu popup for video:", candidate.title);
          failedRemovals.push({ title: candidate.title, reasons: ['Menu popup not found'], videoUrl: candidate.videoUrl });
        }
      } catch (e) {
        console.error('Error processing candidate:', candidate.title, e);
        failedRemovals.push({ title: candidate.title, reasons: ['Exception during removal'], videoUrl: candidate.videoUrl });
      }
    }

    const deletedCount = deletedVideoSummaries.length;
    let summaryText: string;

    if (deletedCount === 0 && failedRemovals.length === 0) {
      summaryText = isCancelled ? "Operation was cancelled before any videos were processed." : "No videos were ultimately processed. This may happen if the 'Remove from' button could not be found for the matched videos (in a real run).";
    } else {
      let criteriaHeader = `Search Criteria (Match ${logic}):\n`;
      if (filters.isWatched && filters.isWatched.enabled) {
        if (filters.isWatched.criteria === 'any') {
          criteriaHeader += `- Is Watched (any duration)\n`;
        } else if (filters.isWatched.criteria === 'percent') {
          criteriaHeader += `- Watched for at least ${filters.isWatched.value}%\n`;
        }
      }
      if (filters.deleteUnavailable) criteriaHeader += `- Delete Unavailable Videos\n`;
      if (filters.titleContains) criteriaHeader += `- Title Contains: ${filters.titleContains}\n`;
      if (filters.channelName) criteriaHeader += `- Channel Contains: ${filters.channelName}\n`;
      if (filters.age) criteriaHeader += `- Older Than: ${filters.age.value} ${filters.age.unit}\n`;
      criteriaHeader += '---\n\n';

      const failedCount = failedRemovals.length;
      const summaryHeader = isDryRun ?
        `Dry Run Summary:\n- Matched: ${total}\n- Would remove: ${deletedCount}\n- Failed to remove: ${failedCount}\n\n` :
        `Deletion Summary:\n- Matched: ${total}\n- Removed: ${deletedCount}\n- Failed to remove: ${failedCount}\n\n`;
      summaryText = criteriaHeader + summaryHeader + deletedVideoSummaries.join('\n');

      // Add failed removals to the summary if any
      if (failedRemovals.length > 0) {
        summaryText += '\n---\n\nFailed to Remove Videos:\n';
        for (const failure of failedRemovals) {
          const hasUrl = (failure.videoUrl && !isUnavailableTitle(failure.title));
          if (hasUrl) {
            // Put the reason before the URL
            summaryText += `- ${failure.title}\n  (Reason: ${failure.reasons.join(', ')})\n  ${failure.videoUrl}\n`;
          } else {
            summaryText += `- ${failure.title}\n  (Reason: ${failure.reasons.join(', ')})\n`;
          }
        }
      }
    }

    // Final status update then hide (only for non-dry-run)
    if (showToasts) {
      updateStatus(`${isDryRun ? 'Dry run complete' : 'Deletion complete'}. ${deletedCount} processed.`);
      await sleep(700);
      hideStatus();
    }

    return { summaryText, deletedCount };
  };


  /**
   * Attempts to parse the playlist's total video count from the page header/sidebar.
   * Returns the integer count if found, otherwise null.
   */
  const getPlaylistTotalCount = (): number | null => {
    // Common YouTube structures that contain the playlist stats
    const selectors = [
      'ytd-playlist-sidebar-primary-info-renderer',
      'ytd-playlist-header-renderer',
      '#stats',
      '#metadata #stats',
      'ytd-video-secondary-info-renderer'
    ];

    const regex = /([\d,]+)\s+videos?/i;

    for (const sel of selectors) {
      const node = document.querySelector(sel);
      if (!node) continue;
      const text = node.textContent || '';
      const m = text.match(regex);
      if (m) {
        return parseInt(m[1].replace(/,/g, ''), 10);
      }
    }

    // Fallback: try scanning common text-bearing elements for a 'X videos' phrase
    const candidates = Array.from(document.querySelectorAll('span, div')) as HTMLElement[];
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const m = t.match(regex);
      if (m) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(val) && val > 0) return val;
      }
    }

    return null;
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
      // Disable on-screen status/toasts during dry run
      await loadAllVideos(!isDryRun);
      if (isCancelled) {
        alert('Operation cancelled during video loading.');
        return;
      }
      const videoElements = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.videoRenderer));
      const allVideos = videoElements.map(extractVideoData).filter((v): v is VideoData => v !== null);
      // extraction complete
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
    }
  };

  // Listen for the message from the popup script.
  chrome.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ status: 'ready' });
      return false; // responded synchronously
    }

    if (request.action === 'deleteVideos') {
      // Type guard to ensure required parameters are present
      if (request.filters && request.logic && typeof request.isDryRun === 'boolean') {
        handleDeleteRequest(request.filters, request.logic, request.isDryRun);
        sendResponse({ status: 'started' });
      } else {
        console.error('deleteVideos action received without required parameters.');
        sendResponse({ status: 'error', message: 'Missing parameters for deleteVideos action.' });
      }
      return false; // responded synchronously
    }
  });
}

