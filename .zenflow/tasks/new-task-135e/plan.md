# Spec and build

## Configuration
- **Artifacts Path**: {@artifacts_path} → `.zenflow/tasks/{task_id}`

---

## Agent Instructions

Ask the user questions when anything is unclear or needs their input. This includes:
- Ambiguous or incomplete requirements
- Technical decisions that affect architecture or user experience
- Trade-offs that require business context

Do not make assumptions on important decisions — get clarification first.

---

## Workflow Steps

### [x] Step: Technical Specification
<!-- chat-id: 7942706d-5bd4-4808-abad-c9b162b78e3b -->

Assess the task's difficulty, as underestimating it leads to poor outcomes.
- easy: Straightforward implementation, trivial bug fix or feature
- medium: Moderate complexity, some edge cases or caveats to consider
- hard: Complex logic, many caveats, architectural considerations, or high-risk changes

Create a technical specification for the task that is appropriate for the complexity level:
- Review the existing codebase architecture and identify reusable components.
- Define the implementation approach based on established patterns in the project.
- Identify all source code files that will be created or modified.
- Define any necessary data model, API, or interface changes.
- Describe verification steps using the project's test and lint commands.

Save the output to `{@artifacts_path}/spec.md` with:
- Technical context (language, dependencies)
- Implementation approach
- Source code structure changes
- Data model / API / interface changes
- Verification approach

If the task is complex enough, create a detailed implementation plan based on `{@artifacts_path}/spec.md`:
- Break down the work into concrete tasks (incrementable, testable milestones)
- Each task should reference relevant contracts and include verification steps
- Replace the Implementation step below with the planned tasks

Rule of thumb for step size: each step should represent a coherent unit of work (e.g., implement a component, add an API endpoint, write tests for a module). Avoid steps that are too granular (single function).

Save to `{@artifacts_path}/plan.md`. If the feature is trivial and doesn't warrant this breakdown, keep the Implementation step below as is.

---

### [x] Step: Implementation

#### [x] Sub-step: Update `popup.html`
- Add the new UI elements for configuring the "watched" criteria as specified in `spec.md`.

#### [x] Sub-step: Update `popup.ts`
- Add event listeners to manage the visibility of the new UI elements.
- Modify the `filters` object to include the new `WatchedFilter` object.

#### [x] Sub-step: Update `content.ts` interfaces
- Add the `WatchedFilter` interface.
- Update the `Filters` interface to use `WatchedFilter`.
- Add the `watchPercentage` property to the `VideoData` interface.

#### [x] Sub-step: Update `extractVideoData` in `content.ts`
- Modify the function to extract the watch percentage from the video's progress bar.
- Set the `watchPercentage` property in the returned `VideoData` object.

#### [x] Sub-step: Update `getVideosToDeleteAndReasons` in `content.ts`
- Modify the function to use the new `WatchedFilter` object to identify videos for deletion based on the selected criteria.

#### [x] Sub-step: Manual Verification
- Manually test the new functionality on a YouTube playlist.
