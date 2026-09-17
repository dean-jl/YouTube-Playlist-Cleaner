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
  let hasShownRemoveActionNotFoundAlert = false;
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
    videoId?: string;
    durationString?: string;
    durationSeconds?: number | null;
  }

  /** Represents the structure of the age filter from the popup. */
  interface AgeFilter {
    value: number;
    unit: 'days' | 'weeks' | 'months' | 'years';
  }

  /** Represents the structure of the duration filter from the popup. */
  interface DurationFilter {
    criteria: 'shorts' | 'shorter' | 'longer';
    value?: number; // duration in seconds
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
    deleteUnavailable?: boolean; // filter for private/deleted videos
    deleteDuplicates?: boolean;  // filter for duplicate playlist entries
    duration?: DurationFilter;   // filter for duration / Shorts
    age?: AgeFilter;
  }

  /** Represents a video that has been matched for deletion, including the reasons why. */
  interface DeletionCandidate {
    element: HTMLElement;
    title: string;
    reasons: string[];
    videoUrl?: string;
    videoId?: string;
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

  const extractVideoIdFromUrl = (videoUrl?: string): string | undefined => {
    if (!videoUrl) return undefined;
    try {
      const url = new URL(videoUrl, 'https://www.youtube.com');
      const v = url.searchParams.get('v');
      return v || undefined;
    } catch (e) {
      return undefined;
    }
  };

  const findRemoveFromPlaylistMenuItem = (menuPopup: HTMLElement): HTMLElement | null => {
    const menuItems = Array.from(menuPopup.querySelectorAll<HTMLElement>(SELECTORS.removeMenuItem));
    if (menuItems.length === 0) return null;

    const keyRegex = /(removefromplaylist|remove_from_playlist|removefromplaylistaction)/i;

    const deepHasKey = (root: any): boolean => {
      const seen = new Set<any>();
      const queue: Array<{ value: any; depth: number }> = [{ value: root, depth: 0 }];
      while (queue.length > 0) {
        const { value, depth } = queue.shift()!;
        if (!value || depth > 7) continue;
        if (typeof value !== 'object') continue;
        if (seen.has(value)) continue;
        seen.add(value);

        if (Array.isArray(value)) {
          for (const v of value) queue.push({ value: v, depth: depth + 1 });
          continue;
        }

        for (const k of Object.keys(value)) {
          if (keyRegex.test(k)) return true;
          queue.push({ value: (value as any)[k], depth: depth + 1 });
        }
      }
      return false;
    };

    for (const item of menuItems) {
      const dataRoots = [
        (item as any).data,
        (item as any).__data,
        (item as any).__data?.data,
        (item as any).__data?.data?.serviceEndpoint,
        (item as any).serviceEndpoint,
        (item as any).navigationEndpoint,
      ];
      if (dataRoots.some(r => deepHasKey(r))) {
        (item as any).__ypc_removeMatch = 'endpoint';
        return item;
      }
    }

    const iconMatches = (item: HTMLElement): boolean => {
      const iconEl = item.querySelector<HTMLElement>('yt-icon');
      const iconAttr = (iconEl?.getAttribute('icon') || iconEl?.getAttribute('src') || '').toLowerCase();
      return iconAttr.includes('delete') || iconAttr.includes('remove');
    };

    const iconCandidates = menuItems.filter(iconMatches);
    if (iconCandidates.length === 1) {
      (iconCandidates[0] as any).__ypc_removeMatch = 'icon';
      return iconCandidates[0];
    }

    const textCandidates = menuItems.filter((item) => {
      const t = (item.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return false;

      const matchers: RegExp[] = [
        /^Remove from/i,
        /^Quitar de/i,
        /^Retirer de/i,
        /^Remover de/i,
        /^Rimuovi da/i,
        /^Verwijderen uit/i,
        /^Usuń z/i,
        /Удалить из/i,
        /再生リスト.*削除/,
        /재생목록.*삭제/,
        /播放列表.*移除/,
      ];

      return matchers.some((re) => re.test(t));
    });

    if (textCandidates.length === 1) {
      (textCandidates[0] as any).__ypc_removeMatch = 'label';
      return textCandidates[0];
    }

    return null;
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
    showNotification(`${operationType} A summary file for the ${videoCount} matched videos has been downloaded.`, 6000);
  };

  /**
   * Displays a non-blocking modern in-page notification banner.
   * @param message The message to display.
   * @param duration Duration in ms before auto-dismiss (0 for manual dismiss).
   */
  const showNotification = (message: string, duration = 4500): void => {
    const existing = document.getElementById('yt-cleaner-notification');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'yt-cleaner-notification';
    Object.assign(banner.style, {
      position: 'fixed', top: '24px', right: '24px', zIndex: '100000',
      background: 'rgba(28, 28, 30, 0.96)', color: '#ffffff', padding: '12px 18px',
      borderRadius: '8px', fontSize: '13px', lineHeight: '1.4', maxWidth: '400px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.15)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
      transition: 'opacity 0.2s ease, transform 0.2s ease'
    });

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    textSpan.style.flex = '1';

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.opacity = '0.6';
    closeBtn.style.fontSize = '12px';

    banner.appendChild(textSpan);
    banner.appendChild(closeBtn);
    banner.onclick = () => banner.remove();
    document.body.appendChild(banner);

    if (duration > 0) {
      setTimeout(() => {
        if (document.body.contains(banner)) {
          banner.style.opacity = '0';
          banner.style.transform = 'translateY(-8px)';
          setTimeout(() => banner.remove(), 200);
        }
      }, duration);
    }
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
      position: 'fixed', bottom: '80px', right: '16px', zIndex: '10000',
      background: 'rgba(28, 28, 30, 0.95)', color: '#ffffff', padding: '10px 14px',
      borderRadius: '8px', fontSize: '13px', maxWidth: '340px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });
    container.innerHTML = `
      <div id="${STATUS_ID}-text" style="font-weight: 500; line-height: 1.3;">Loading playlist...</div>
      <div id="${STATUS_ID}-bar-bg" style="width: 100%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin-top: 8px; overflow: hidden; display: none;">
        <div id="${STATUS_ID}-bar-fill" style="width: 0%; height: 100%; background: #3ea6ff; transition: width 0.2s ease;"></div>
      </div>
    `;
    document.body.appendChild(container);
  };

  const updateStatus = (text: string, percent?: number) => {
    const el = document.getElementById(`${STATUS_ID}-text`);
    if (el) el.textContent = text;
    if (percent !== undefined) {
      const barBg = document.getElementById(`${STATUS_ID}-bar-bg`);
      const barFill = document.getElementById(`${STATUS_ID}-bar-fill`);
      if (barBg) barBg.style.display = 'block';
      if (barFill) barFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
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
    const WAIT_GROW_MS = 1000; // how long to wait for growth after each scroll
    const POLL_INTERVAL = 60;
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
      await sleep(120);

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
    const videoId = extractVideoIdFromUrl(videoUrl);

    // Extract duration from thumbnail overlay or metadata
    const timeOverlay = videoElement.querySelector<HTMLElement>('ytd-thumbnail-overlay-time-status-renderer, span.ytd-thumbnail-overlay-time-status-renderer, #time-status');
    const durationString = timeOverlay ? timeOverlay.textContent?.trim() : undefined;
    const durationSeconds = parseDurationToSeconds(durationString);

    return { element: videoElement, title, channelName, isWatched, watchPercentage, ageString, videoUrl, videoId, durationString, durationSeconds };
  };

  /**
   * Converts a duration string (e.g., "3:45", "1:02:15", "0:45", "SHORTS") into seconds.
   * @param durationStr The duration string to parse.
   * @returns The duration in seconds, or null if unparseable.
   */
  const parseDurationToSeconds = (durationStr?: string): number | null => {
    if (!durationStr) return null;
    const clean = durationStr.replace(/\s+/g, '').toUpperCase();
    if (clean.includes('SHORT')) return 60;
    const parts = clean.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
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
    const seenVideoIds = new Set<string>();

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
      filters.deleteDuplicates,
      Boolean(filters.duration),
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
      }

      if (filters.deleteUnavailable && (video.title === '[Private video]' || video.title === '[Deleted video]')) {
        reasons.push('Is unavailable ([Private video] or [Deleted video])');
      }

      if (filters.deleteDuplicates) {
        const idKey = video.videoId || (video.title ? video.title.toLowerCase().trim() : null);
        if (idKey) {
          if (seenVideoIds.has(idKey)) {
            reasons.push('Duplicate video (keeps earlier instance)');
          } else {
            seenVideoIds.add(idKey);
          }
        }
      }

      if (filters.duration) {
        const { criteria, value } = filters.duration;
        if (criteria === 'shorts') {
          const isShort = (video.durationSeconds !== null && video.durationSeconds !== undefined && video.durationSeconds <= 60) ||
                          (video.durationString && video.durationString.toUpperCase().includes('SHORT')) ||
                          (video.videoUrl && video.videoUrl.includes('/shorts/'));
          if (isShort) {
            reasons.push('Is a YouTube Short (<= 60s)');
          }
        } else if (criteria === 'shorter' && value !== undefined && value > 0) {
          if (video.durationSeconds !== null && video.durationSeconds !== undefined && video.durationSeconds < value) {
            reasons.push(`Duration shorter than ${Math.floor(value / 60)}m ${value % 60}s`);
          }
        } else if (criteria === 'longer' && value !== undefined && value > 0) {
          if (video.durationSeconds !== null && video.durationSeconds !== undefined && video.durationSeconds > value) {
            reasons.push(`Duration longer than ${Math.floor(value / 60)}m ${value % 60}s`);
          }
        }
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
        candidates.push({ element: video.element, title: video.title, reasons: reasons, videoUrl: (video as VideoData).videoUrl, videoId: (video as VideoData).videoId });
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
    if (showToasts) { 
      showStatus(); 
      updateStatus(`${isDryRun ? 'Identifying' : 'Removing'} 0 of ${total}...`, 0); 
    }

    const deletedVideoSummaries: string[] = [];
    const failedRemovals: { title: string, reasons: string[], videoUrl?: string, videoId?: string }[] = []; // Track failed removals with optional URL

    // Helper to avoid including URLs for inaccessible items
    const isUnavailableTitle = (t?: string) => {
      if (!t) return false;
      const tt = t.trim();
      return tt === '[Private video]' || tt === '[Deleted video]';
    };

    // Track how many were successfully processed (removed or counted in dry run)
    let processedCount = 0;
    const processStartTime = Date.now();

    // Helper to reactively wait for the YouTube menu popup to render its menu items
    const waitForMenuPopup = async (timeout = 700): Promise<HTMLElement | null> => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = document.querySelector<HTMLElement>(SELECTORS.menuPopup);
        if (el && el.querySelectorAll(SELECTORS.removeMenuItem).length > 0) {
          return el;
        }
        await sleep(25);
      }
      return document.querySelector<HTMLElement>(SELECTORS.menuPopup);
    };

    // Helper to wait for an element to be removed from the DOM (resolves on removal or timeout)
    const waitForRemoval = async (el: HTMLElement, timeout = 5000): Promise<void> => {
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (!document.body.contains(el)) return resolve();
          if (Date.now() - start > timeout) return resolve();
          setTimeout(check, 80);
        };
        check();
      });
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

      const elapsed = Date.now() - processStartTime;
      const avgPerVideo = idx > 0 ? elapsed / idx : 0;
      const remainingSec = Math.round((total - idx) * avgPerVideo / 1000);
      const etaText = idx > 0 && remainingSec > 0 ? ` (ETA: ~${remainingSec}s)` : '';
      const percent = Math.round((idx / total) * 100);

      if (showToasts) updateStatus(`${verb} ${idx + 1} of ${total}${etaText}: ${shortTitle}`, percent);

      const videoElement = candidate.element;

      try {
        // Scroll the video into view to ensure it's in the DOM
        try {
          candidate.element.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
        } catch {
          candidate.element.scrollIntoView(true);
        }
        await sleep(80); // Quick settle for DOM render

        const menuButton = candidate.element.querySelector<HTMLElement>(SELECTORS.menuButton);
        
        // Skip videos with no menu button (e.g., private/unavailable videos)
        if (!menuButton) {
          console.log("Skipping video with no menu button (likely private/unavailable):", candidate.title);
          // For dry run, we still want to include these in the summary
          if (isDryRun) {
            const hasUrl = (candidate.videoUrl && !isUnavailableTitle(candidate.title));
            const reason = 'No menu available (private/unavailable video)';
            if (hasUrl) {
              deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${reason})\n  ${candidate.videoUrl}`);
            } else {
              deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${reason})`);
            }
          }
          continue;
        }

        // For dry run, we don't need to interact with the menu, just record the match
        if (isDryRun) {
          const hasUrl = (candidate.videoUrl && !isUnavailableTitle(candidate.title));
          if (hasUrl) {
            deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: Would be removed)\n  ${candidate.videoUrl}`);
          } else {
            deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: Would be removed)`);
          }
          processedCount++;
          continue;
        }

        // Click the menu button for actual removal
        menuButton.click();
        // Wait reactively for menu popup to appear
        const menuPopup = await waitForMenuPopup(700);
        if (!menuPopup) {
          console.error("Menu did not open for video:", candidate.title);
          document.body.click(); // Dismiss any open menus
          await sleep(60);
          failedRemovals.push({ 
            title: candidate.title, 
            reasons: ['Menu did not open'], 
            videoUrl: candidate.videoUrl, 
            videoId: candidate.videoId 
          });
          // Continue with next video even if menu doesn't open, as it might be a temporary issue
          continue;
        }

        // Find and click the remove item button
        const removeItemButton = findRemoveFromPlaylistMenuItem(menuPopup);
        if (removeItemButton) {
          // Click the remove button
          removeItemButton.click();
          
          // Wait for the video to be removed from the DOM reactively
          await waitForRemoval(candidate.element);
          processedCount++;

          const hasUrl = (candidate.videoUrl && !isUnavailableTitle(candidate.title));
          if (hasUrl) {
            // Put Reason line before the URL
            deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})\n  ${candidate.videoUrl}`);
          } else {
            deletedVideoSummaries.push(`- ${candidate.title}\n  (Reason: ${candidate.reasons.join(', ')})`);
          }
        } else {
          // If we found a menu but can't find the remove action, this is a critical error
          // that likely affects all videos, so we should fail fast
          console.error("CRITICAL: Could not find remove-from-playlist menu item for video:", 
            candidate.title, candidate.videoId);
            
          // Clean up before showing the alert
          document.body.click(); // Dismiss menu
          await sleep(100);
          
          if (!hasShownRemoveActionNotFoundAlert) {
            hasShownRemoveActionNotFoundAlert = true;
            const errorMsg = "Could not find the 'Remove from playlist' menu action. " +
              "This can happen when YouTube's interface has changed or is in an unsupported language. " +
              "Please report this issue to the extension developer.";
            
            showNotification(errorMsg, 8000);
              
            return { 
              summaryText: `Stopped: ${errorMsg} (video: ${candidate.title || 'unknown'})`, 
              deletedCount: processedCount 
            };
          }
          
          return { 
            summaryText: `Removal action not found in menu for video: ${candidate.title || 'unknown'}`, 
            deletedCount: processedCount 
          };
        }
      } catch (error) {
        console.error("Error removing video:", candidate.title, error);
        failedRemovals.push({ 
          title: candidate.title, 
          reasons: [`Error: ${error instanceof Error ? error.message : String(error)}`],
          videoUrl: candidate.videoUrl,
          videoId: candidate.videoId
        });
      } finally {
        // Update progress
        const progress = Math.round((processedCount + failedRemovals.length) / total * 100);
        chrome.runtime.sendMessage({ type: 'progress', progress });
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
      if (filters.deleteDuplicates) criteriaHeader += `- Delete Duplicate Videos (keep first)\n`;
      if (filters.duration) {
        if (filters.duration.criteria === 'shorts') {
          criteriaHeader += `- Duration: Shorts (<= 60 seconds)\n`;
        } else if (filters.duration.criteria === 'shorter') {
          criteriaHeader += `- Duration: Shorter than ${filters.duration.value || 0}s\n`;
        } else if (filters.duration.criteria === 'longer') {
          criteriaHeader += `- Duration: Longer than ${filters.duration.value || 0}s\n`;
        }
      }
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
      updateStatus(`${isDryRun ? 'Dry run complete' : 'Deletion complete'}. ${deletedCount} processed.`, 100);
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
   * Exports the loaded playlist videos as a downloadable CSV or JSON file.
   * @param format 'csv' | 'json'
   */
  const exportPlaylistData = async (format: 'csv' | 'json' = 'csv') => {
    showNotification('Loading all videos in playlist for export...', 3500);
    await loadAllVideos(true);

    const videoElements = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.videoRenderer));
    const allVideos = videoElements.map(extractVideoData).filter((v): v is VideoData => v !== null);

    if (allVideos.length === 0) {
      showNotification('No videos found in playlist to export.', 3500);
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      const exportItems = allVideos.map((v) => ({
        title: v.title,
        videoId: v.videoId,
        videoUrl: v.videoUrl,
        channelName: v.channelName,
        duration: v.durationString,
        durationSeconds: v.durationSeconds,
        watched: v.isWatched,
        watchPercentage: v.watchPercentage,
        age: v.ageString
      }));
      const blob = new Blob([JSON.stringify(exportItems, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `youtube-playlist-export-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Title', 'Video ID', 'URL', 'Channel', 'Duration', 'Watched %', 'Age'];
      const escapeCsv = (str: string = '') => `"${str.replace(/"/g, '""')}"`;
      const rows = allVideos.map((v) => [
        escapeCsv(v.title),
        escapeCsv(v.videoId || ''),
        escapeCsv(v.videoUrl || ''),
        escapeCsv(v.channelName || ''),
        escapeCsv(v.durationString || ''),
        escapeCsv(v.watchPercentage !== undefined ? `${v.watchPercentage}%` : (v.isWatched ? 'Watched' : '0%')),
        escapeCsv(v.ageString || '')
      ].join(','));

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `youtube-playlist-export-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    showNotification(`Exported ${allVideos.length} playlist videos successfully.`, 4500);
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

    if (request.action === 'exportPlaylist') {
      exportPlaylistData(request.format || 'csv');
      sendResponse({ status: 'started' });
      return false;
    }

    if (request.action === 'deleteVideos') {
      // Type guard to ensure required parameters are present
      if (request.filters && request.logic && typeof request.isDryRun === 'boolean') {
        handleDeleteRequest(request.filters, request.logic, request.isDryRun);
        sendResponse({ status: 'started' });
      } else {
        sendResponse({ status: 'invalid' });
      }
      return false;
    }

    return false;
  });

} // end of if (!__YPC_CONTENT_SCRIPT_INITIALIZED) block
