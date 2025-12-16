### Technical Specification

**1. Technical Context**

*   **Language:** TypeScript
*   **Platform:** Chrome Extension
*   **Key Dependencies:** None, it's a plain TypeScript project.

**2. Implementation Approach**

The goal is to allow users to define what "watched" means. I will extend the existing "Watched videos" filter with more granular options.

**2.1. Data Model and Interface Changes**

I will update the `Filters` interface in `src/content.ts` and the data passed from `src/popup.ts`.

The current `isWatched` property is a boolean. I will change it to an object to accommodate the new settings.

**In `src/content.ts`:**

```typescript
//
// existing interface
//
/** Represents the structure of the age filter from the popup. */
interface AgeFilter {
  value: number;
  unit: 'days' | 'weeks' | 'months' | 'years';
}

//
// new interface for the watched filter
//
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
  isWatched?: WatchedFilter; // Changed from boolean to WatchedFilter
  deleteUnavailable?: boolean;
  age?: AgeFilter;
}
```

**In `src/popup.ts`:**

The code that constructs the `filters` object will be modified to create the `WatchedFilter` object.

**2.2. User Interface (UI) Changes**

In `src/popup.html`, I will add a dropdown and a number input field to configure the watched criteria. These new elements will be initially hidden and will only appear when the "Watched videos" checkbox is checked.

```html
      <div class="filter-group">
        <label>
          <input type="checkbox" id="is-watched">
          Watched videos
        </label>
        <div id="watched-options" class="filter-group" style="display: none; padding-left: 20px;">
          <label for="watched-criteria">Criteria:</label>
          <select id="watched-criteria">
            <option value="any" selected>Played for any duration</option>
            <option value="percent">Watched for at least (%)</option>
            <option value="seconds" disabled>Watched for at least (seconds) - Not available</option>
          </select>
          <input type="number" id="watched-value" min="1" max="100" style="display: none; width: 50px;" placeholder="%">
        </div>
      </div>
```
I've disabled the "seconds" option for now, as I'm not confident I can get the exact watch time in seconds from the UI. I will explain this limitation to the user.

In `src/popup.ts`, I'll add event listeners to manage the visibility of these new UI elements.

**2.3. Core Logic Changes in `content.ts`**

*   **`extractVideoData` function:** I will modify this function to extract the watch percentage from the video's progress bar. I'll look for the `ytd-thumbnail-overlay-resume-playback-renderer` element and then find the progress bar element within it. I will assume the progress bar element has a `style.width` property that I can parse. I'll add a new property `watchPercentage` to the `VideoData` interface.
    ```typescript
    interface VideoData {
      element: HTMLElement;
      title: string;
      channelName:.zenflow/tasks/new-task-135e/spec.md string;
      isWatched: boolean;
      watchPercentage: number; // New property
      ageString?: string;
    }
    ```
    If a video is fully watched, `watchPercentage` will be 100. If it's partially watched, I'll extract the percentage. If it's not watched, it will be 0.

*   **`getVideosToDeleteAndReasons` function:** I will update this function to use the new `isWatched` filter object. It will check the `criteria` and `value` to determine if a video should be marked for deletion.

**3. Source Code Files to be Modified**

*   `src/popup.html`: To add the new UI elements.
*   `src/popup.ts`: To handle the new UI elements and send the updated filter to the content script.
*   `src/content.ts`: To implement the new watch time logic.

**4. Verification Approach**

1.  **Manual Testing:** I will manually test the feature on a YouTube playlist with a mix of watched, partially watched, and unwatched videos. I will test all the new "watched" criteria.
2.  **Linting:** The project does not seem to have a linter configured. I will follow the existing code style.
