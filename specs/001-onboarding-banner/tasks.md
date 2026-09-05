# Tasks: Onboarding Banner

**Input**: Design documents from `/specs/001-onboarding-banner/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Not requested — this feature has no pure-function surface for
`tests/analysis.test.ts`'s existing scope (see `research.md`); validation is manual, via
`quickstart.md`.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable
independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

## Path Conventions

Single project (Chrome extension) — all paths are under `src/` at the repository root, per
`plan.md`'s Project Structure.

---

## Phase 1: Setup

**Purpose**: Confirm the prerequisite the whole feature depends on.

- [ ] T001 Confirm `permissions: ["storage"]` is already present in `src/manifest.json` (it is —
      no manifest change needed; this task is a verification step, not an edit).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared storage helpers both user stories depend on.

**⚠️ CRITICAL**: US1 and US2 both need this before their tasks can start.

- [ ] T002 Create `src/panel/onboarding.ts` with `getOnboardingDismissed(): Promise<boolean>` and
      `setOnboardingDismissed(): Promise<void>`, wrapping `chrome.storage.local` reads/writes of
      the `wh_onboarding_dismissed` key (see `data-model.md`).

**Checkpoint**: Storage helpers ready — US1 and US2 implementation can proceed.

---

## Phase 3: User Story 1 - First-time orientation (Priority: P1) 🎯 MVP

**Goal**: A first-time user sees a banner above the tabs explaining what they do and the
local-only guarantee.

**Independent Test**: Fresh install (or cleared storage) → open panel → banner appears with all 5
tab names and the local-only statement (quickstart.md Scenario 1).

- [ ] T003 [US1] Implement `renderOnboardingBanner(): HTMLElement` in `src/panel/onboarding.ts`
      using the existing `h()` helper from `src/panel/dom.ts`, with copy covering all 5 tabs
      (Requests, WS/SSE, Console, Sources, Insights) and the "nothing leaves your browser"
      statement (spec FR-002, FR-003).
- [ ] T004 [P] [US1] Add `.onboarding-banner` styles in `src/styles.css`, matching the existing
      `.empty` visual language (spec Assumptions).
- [ ] T005 [US1] In `src/panel/main.ts`, call `getOnboardingDismissed()` (from T002) before the
      first `render()`, and if falsy, mount `renderOnboardingBanner()` (from T003) above the tab
      bar; ensure it does not cover the tab bar or toolbar (spec FR-001, FR-007).

**Checkpoint**: US1 independently testable — banner shows on first open.

---

## Phase 4: User Story 2 - Dismiss and stay dismissed (Priority: P2)

**Goal**: Dismissing the banner hides it permanently for that install.

**Independent Test**: Dismiss banner → reopen panel → banner does not reappear
(quickstart.md Scenario 2).

- [ ] T006 [US2] Add a dismiss control to `renderOnboardingBanner()`
      (`src/panel/onboarding.ts`) that calls `setOnboardingDismissed()` (from T002) and removes
      the banner element from the live DOM without a full re-render (spec FR-004, FR-005).

**Checkpoint**: US2 independently testable — dismissal persists across panel reopens.

---

## Phase 5: User Story 3 - No regression to existing empty states (Priority: P3)

**Goal**: Confirm existing per-tab empty states are unaffected.

**Independent Test**: With banner dismissed, open a tab with no data → existing empty-state
message still appears (quickstart.md Scenario 3).

- [ ] T007 [US3] Manually verify each of the 4 existing empty-state messages in
      `src/panel/main.ts` (lines ~207, ~317, ~394, ~428) still renders correctly with the banner
      code present and dismissed — no code change expected; this is a regression check only.

**Checkpoint**: US3 independently testable — no regression found (or, if found, fix in T003/T005).

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T008 [P] Update `README.md`'s feature list to mention the first-run onboarding banner.
- [ ] T009 Run `npm run typecheck` and `npm run build`; confirm both succeed with no new errors.

---

## Dependencies

- Phase 1 (T001) has no dependencies — verification only.
- Phase 2 (T002) depends on nothing but blocks all of Phase 3 and Phase 4.
- Phase 3 (US1: T003, T004, T005): T003 and T004 touch different files and can run in parallel;
  T005 depends on both T002 and T003.
- Phase 4 (US2: T006) depends on T002 and T003 (extends the same banner element).
- Phase 5 (US3: T007) depends on T005 (banner must be wired in before checking for regressions).
- Final Phase (T008, T009) depends on all of the above.

## Parallel Example

```
# T003 and T004 touch different files and have no dependency on each other:
Task: "Implement renderOnboardingBanner() in src/panel/onboarding.ts"
Task: "Add .onboarding-banner styles in src/styles.css"
```

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1)**: a banner that appears on first run already delivers
the core value (orientation) even before dismissal is wired up. US2 (dismiss) and US3 (regression
check) can follow as fast-follow increments in the same sitting, since they're small, but US1 alone
is a legitimate, demoable stopping point.
