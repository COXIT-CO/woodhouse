# Tasks: Fix WS/SSE & Console Capture and List Scroll Reset

**Input**: Design documents from `/specs/002-fix-ws-capture-scroll/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/relay-messages.md,
quickstart.md

**Tests**: Not requested. Every change is relay or panel code, outside `tests/analysis.test.ts`'s
`src/analysis/*` scope (research.md, Constitution Additional Constraints). Validation is manual,
via `quickstart.md`.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3), so each story can
be implemented and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

## Path Conventions

Single project (Chrome extension). All paths are under `src/` at the repository root, per
`plan.md`'s Project Structure.

---

## Phase 1: Setup

**Purpose**: Confirm the root cause before changing code (spec Assumptions; research.md "Still to confirm").

- [ ] T001 Build the current code (`npm run build`), load `dist/` unpacked, and run quickstart.md
      Scenarios 1 and 2 **before any change**. Confirm in `chrome://serviceworker-internals` that
      the Woodhouse worker stops while idle, and that WS/SSE and Console stay at 0 afterwards.
      Record the result as a note under this task. If the cause differs (e.g. the socket lives in
      a Web Worker), stop and revise `research.md` and `plan.md` before Phase 3.
- [ ] T002 Record the baseline: `src/manifest.json` `permissions` is exactly `["storage"]`
      (re-checked in T014).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None needed. The three stories touch separate concerns: the relay files for US1, and
separate sections of `src/panel/main.ts` for US2 and US3. No shared scaffolding blocks them.

**Checkpoint**: Proceed directly to the user stories once T001 confirms the root cause.

---

## Phase 3: User Story 1 - Live socket and console activity always reaches the panel (Priority: P1) 🎯 MVP

**Goal**: Events reach the panel after a service-worker restart and when emitted before the panel
opened, with a priority-capped backlog (FR-001–FR-004).

**Independent Test**: quickstart.md Scenarios 1, 2 and 3. Both tabs populate after an idle or
stopped worker and after opening the panel late. The cap keeps connections and reports drops.

- [ ] T003 [P] [US1] In `src/sw.ts`, answer every `__whBridge` batch synchronously with
      `sendResponse({ delivered })`. `delivered` is true only if a port exists for
      `sender.tab.id` and `port.postMessage` didn't throw. On a panel `init`, after registering the
      port, call `chrome.tabs.sendMessage(tabId, { __whPanelReady: 1 }).catch(() => {})`. Keep the
      SW free of event state (contracts/relay-messages.md §1, §3, Invariants).
- [ ] T004 [P] [US1] In `src/panel/capture.ts`, move the `chrome.runtime.connect` /
      `postMessage({ type: "init", … })` / `onMessage` block into a local `connectPort()` arrow
      helper. On `port.onDisconnect`, schedule `connectPort()` again after a new module-level
      `RECONNECT_DELAY_MS = 250`, one attempt at a time, and skip it when `chrome.runtime.id` is
      undefined (extension reloaded; spec Edge Cases). Contract §2.
- [ ] T005 [US1] In `src/bridge.ts`, add `attached: boolean | undefined` per data-model.md.
      - Send with `chrome.runtime.sendMessage(...).then(res => …)`.
      - On `{ delivered: false }`, a missing response or a rejection: put the batch back at the
        front of the queue, re-apply the caps, and set `attached = false`.
      - Skip sending on the 250 ms tick while `attached === false` (FR-004).
      - Add a `chrome.runtime.onMessage` listener for `{ __whPanelReady: 1 }` that sets
        `attached = true` and flushes immediately.
      Depends on T003's response shape.
- [ ] T006 [US1] In `src/bridge.ts`, split the backlog. Keep `ws-open`/`sse-open` events in a new
      `openEvents` list capped at a new `MAX_OPEN_EVENTS = 200`, flushed ahead of `queue`. Make
      `queue` (existing `MAX_QUEUE = 2000`) drop **oldest** instead of newest when full. Add every
      discard from either list to `dropped` (FR-003; data-model.md "Retained event backlog").
      Same file as T005, so it runs after T005.

**Checkpoint**: US1 is independently testable. Run quickstart.md Scenarios 1–3.

---

## Phase 4: User Story 2 - Keep my place in the list while inspecting (Priority: P2)

**Goal**: List and detail panes keep their scroll position across selection and live updates.
Detail starts at the top for a new selection. Each tab remembers its list position (FR-008–FR-011).

**Independent Test**: quickstart.md Scenario 5.

- [ ] T007 [US2] In `src/panel/main.ts`, add module-level `renderedTab: TabId` and
      `listScroll: Partial<Record<TabId, number>>`. At the top of `render()`, before
      `app.textContent = ""`, read `app.querySelector(".list-pane")?.scrollTop` into
      `listScroll[renderedTab]`. After `app.append(...)`, set the new `.list-pane`'s `scrollTop` to
      `listScroll[activeTab] ?? 0`, then set `renderedTab = activeTab`. Place this next to the
      existing filter focus/caret preservation, using the same style.
- [ ] T008 [US2] In `src/panel/main.ts`'s `render()`, also save `.detail-pane` `scrollTop` and the
      current selection key (`${renderedTab}:${selectedReq?.id ?? selectedConn?.id ?? ""}`) before
      clearing. After rebuilding, restore the detail scroll only when the new key equals the saved
      one; otherwise leave it at 0 (FR-010; data-model.md "Per-tab view position"). Same file as
      T007, so it runs after T007.

**Checkpoint**: US2 is independently testable. Run quickstart.md Scenario 5, steps 1–6.

---

## Phase 5: User Story 3 - WS/SSE tab never contradicts the network log (Priority: P3)

**Goal**: Network-log-only WebSocket/SSE connections are listed once and labeled, counts include
them, and the empty-state copy is accurate (FR-005–FR-007).

**Independent Test**: quickstart.md Scenario 4.

- [ ] T009 [US3] In `src/panel/main.ts` (WS/SSE tab section), add a local helper that derives
      network-only connections from `store.requests`:
      - WS if `resourceType === "websocket"` or `status === 101`; SSE if `mimeType` starts with
        `text/event-stream`.
      - Use `id: -req.id`.
      - Exclude any URL that matches a `store.wsConns`/`store.sseConns` URL, with both resolved via
        `new URL(url, store.pageOrigin)` in a `try`/`catch` that falls back to the raw string.
      The helper returns plain objects and never writes to the store (data-model.md
      "Network-only connection"). Same file as US2's tasks, so it runs after T008.
- [ ] T010 [US3] In `renderWs()` (`src/panel/main.ts`), append the T009 rows after the frame-level
      ones, with State `frames not captured` (muted). Selecting one shows a detail pane with its URL
      and one line explaining why there are no frames: opened before Woodhouse's hook ran, or
      inside a worker or cross-origin frame. Selection compares by the negative id.
- [ ] T011 [US3] In `src/panel/main.ts`, include the T009 count in the WS/SSE tab badge
      (`renderTabs()`) and the toolbar's `N ws` text (`renderToolbar()`) (FR-005).
- [ ] T012 [US3] In `src/panel/main.ts`, replace the WS/SSE empty-state text. It should say
      connections appear once the page opens one, and that connections inside workers or
      cross-origin frames are listed from the network log without frames (FR-007). Keep the
      wry-but-specific tone of the other empty states.

**Checkpoint**: US3 is independently testable. Run quickstart.md Scenario 4.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T013 Run quickstart.md "Regression checks": the onboarding banner shows and dismisses, the
      filter keeps focus and caret during live capture, and the other tabs' empty states are
      unchanged.
- [ ] T014 Run `npm run typecheck`, `npm run build` and `npm test`. All must pass with no new
      errors. Re-check that `src/manifest.json` `permissions` still equals the T002 baseline
      (`["storage"]`) and that no dependency was added to `package.json` (SC-005).

---

## Dependencies

- Phase 1: T001 gates everything (root-cause confirmation). T002 is independent.
- Phase 2: none.
- Phase 3 (US1): T003 and T004 touch different files and can run in parallel. T005 depends on
  T003 (response and ready shapes). T006 depends on T005 (same file).
- Phase 4 (US2): T007 → T008 (same function). Independent of US1.
- Phase 5 (US3): T009 → T010 → T011 → T012, all in `src/panel/main.ts`, so sequential and after
  T008 to avoid clashing edits. Functionally independent of US1/US2.
- Final Phase: T013 and T014 depend on all of the above.

## Parallel Example

```
# US1: the service worker and the panel's port handling are separate files:
Task: "T003 sendResponse({ delivered }) + __whPanelReady in src/sw.ts"
Task: "T004 connectPort() + reconnect on onDisconnect in src/panel/capture.ts"

# Across stories: US1 (relay files) can run alongside US2 (src/panel/main.ts):
Task: "T005/T006 backlog in src/bridge.ts"
Task: "T007/T008 scroll preservation in src/panel/main.ts"
```

## Implementation Strategy

**MVP = Phase 1 + Phase 3 (US1)**: it fixes the reported "0 WS / 0 logs" bug and on its own makes
two dead tabs useful again. **US2** (scroll) is the second reported bug: small, all in `render()`,
and shippable right after. **US3** is a safety net for connections that can never be frame-captured.
It's worth shipping, but US1 + US2 already resolve both reported symptoms on pages where the hook
runs. Each checkpoint is a demoable stopping point. Commit after each story.
