# Implementation Plan: Fix WS/SSE & Console Capture and List Scroll Reset

**Branch**: `speckit/second-task-spec` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-fix-ws-capture-scroll/spec.md`

## Summary

Two bug fixes in the panel, both with root causes found by reading the code.

1. **Capture**: The page's events travel injected script → content-script bridge → service worker
   → panel. The service worker keeps open panels in an in-memory map, which is lost when MV3 stops
   it after about 30 s idle. The panel's port has no `onDisconnect` handling, so it never
   re-registers, and the SW drops every later batch. Events from before the panel opens are dropped
   the same way.
   Fix: the panel reconnects; the SW acknowledges each delivery and announces "panel ready" to the
   tab; the bridge holds a priority-capped backlog until a panel is attached. The WS/SSE tab also
   lists network-log-only connections, derived at render time.
2. **Scroll**: `render()` clears `#app` and rebuilds every pane, so `scrollTop` resets to 0.
   Fix: save and restore list/detail scroll inside `render()`, per tab, keyed by selection, the
   same way `render()` already preserves the filter input's caret.

## Technical Context

**Language/Version**: TypeScript (ES2022 target), bundled by `esbuild` via `build.mjs`.

**Primary Dependencies**: None at runtime; this feature adds none.

**Storage**: None persistent. The backlog lives in the content script's memory (per page load),
and scroll positions in the panel's memory (per panel session).

**Testing**: The hand-rolled `node:assert/strict` runner covers `src/analysis/*` only. Nothing here
touches `src/analysis/`, so validation is manual via `quickstart.md`.

**Target Platform**: Chrome MV3 DevTools extension, `minimum_chrome_version: "111"`.

**Project Type**: Single project (browser extension), using the relay chain's 4 contexts: MAIN
world, ISOLATED content script, service worker, DevTools panel.

**Performance Goals**: Events reach the panel within 2 s of page activity (spec SC-001). No added
background wakeups from tabs without a panel (FR-004).

**Constraints**:
- No new permissions: `chrome.tabs.sendMessage` and `sendMessage` response callbacks need none.
- The SW stays a pure router.
- Every new collection is capped.
- No throws.

**Scale/Scope**: 4 source files (`src/bridge.ts`, `src/sw.ts`, `src/panel/capture.ts`,
`src/panel/main.ts`), plus rebuilt `dist/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Dependency Bias | PASS | Hand-written reconnect, backlog and scroll logic; no new dependency. |
| II. No Framework | PASS | Scroll preservation stays inside the existing clear-and-rebuild `render()`. Keyed DOM diffing was rejected (research.md). |
| III. Local-Only Processing | PASS | Only extension-internal messaging (`runtime`/`tabs` messages inside the browser). No network calls. |
| IV. Match House Style | PASS | Tunables `RECONNECT_DELAY_MS`, `MAX_OPEN_EVENTS` in SCREAMING_SNAKE_CASE; the new backlog list is capped; failures degrade silently (`.catch(() => {})`); no classes. |
| V. Minimal Chrome Permissions | PASS | `permissions` stays `["storage"]`. `chrome.tabs.sendMessage` doesn't require the `tabs` permission. |

**Post-design re-check (after Phase 1)**: still PASS on all 5. The relay message contract
([contracts/relay-messages.md](./contracts/relay-messages.md)) adds only acknowledgement and
`__whPanelReady` messages, and the SW gains no business logic (it answers "was a port found" and
forwards a ready signal).

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-ws-capture-scroll/
├── plan.md                    # This file
├── research.md                # Phase 0: root causes + decisions
├── data-model.md              # Phase 1: backlog, network-only connection, view position
├── contracts/
│   └── relay-messages.md      # Phase 1: bridge ↔ SW ↔ panel message shapes
├── quickstart.md              # Phase 1: manual validation scenarios
├── checklists/requirements.md # from /speckit-specify
└── tasks.md                   # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── injected.ts          # unchanged: still wraps WebSocket/EventSource/console
├── bridge.ts            # CHANGED: attached state, delivery ack handling, priority-capped backlog
├── sw.ts                # CHANGED: sendResponse({ delivered }), __whPanelReady on init
├── manifest.json        # unchanged: permissions stay ["storage"]
├── shared/types.ts      # unchanged: network-only rows are a render-time view
└── panel/
    ├── capture.ts       # CHANGED: connectPort() + reconnect on onDisconnect
    ├── main.ts          # CHANGED: scroll save/restore in render(); network-only WS/SSE rows; badge/toolbar counts; empty-state copy
    ├── state.ts         # unchanged
    └── dom.ts           # unchanged
```

**Structure Decision**: Single project. Changes touch each hop of the existing relay chain plus the
panel renderer. `src/analysis/` and `src/shared/` are untouched, so analysis input and exports
never see network-only rows.

## Complexity Tracking

*(Not applicable. No Constitution Check violations.)*
