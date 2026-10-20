# Phase 0 Research: Fix WS/SSE & Console Capture and List Scroll Reset

No `NEEDS CLARIFICATION` remained in the Technical Context. Research here means confirming root
causes in the code and choosing between fix strategies.

## Finding: why WS/SSE and Console show 0

The code evidence (`src/sw.ts`, `src/panel/capture.ts`, `src/bridge.ts`):
- `sw.ts` keeps `panels = new Map<number, Port>()` in memory and drops a batch when no port is
  found (`if (!port) return;`).
- MV3 stops an idle service worker (~30 s without events). The map is lost and the panel's port
  disconnects.
- `capture.ts` calls `chrome.runtime.connect` once and sends `init` once. There is no
  `onDisconnect` handler, so after a SW restart the panel is never registered again.
- `bridge.ts` fire-and-forgets every 250 ms batch, so events posted before the panel opens are
  also dropped by the SW.
- The Console tab being 0 at the same time as WS/SSE (while Chrome reported 8 warnings and 1 error)
  points at the shared relay, not at the WebSocket wrapper.

**Still to confirm in the browser** (first task in tasks.md): reproduce with an idle panel and
watch `chrome://serviceworker-internals`. If the reported app's socket instead lives in a Web
Worker, the network-only rows decision below still makes the tab truthful.

## Decision: panel reconnects on port disconnect

**Rationale**: This is the smallest fix for FR-001, entirely inside the panel. A fixed
`RECONNECT_DELAY_MS` (~250 ms) with one attempt at a time, stopping once `chrome.runtime.id` is
undefined (the extension was reloaded), so there's no runaway loop (spec Edge Cases).

**Alternatives considered**:
- Keepalive pings every <30 s to stop the SW from idling. Rejected: it fights the browser's
  lifecycle, costs wakeups forever, and still needs reconnect for other termination causes.

## Decision: delivery acknowledgement + "panel ready" signal, buffered in the bridge

**Rationale**: The bridge (content script) lives as long as the page, unlike the SW. So:
- The SW replies to each batch with `{ delivered }`.
- On panel `init`, the SW sends `__whPanelReady` to the tab.
- The bridge stops sending after an undelivered batch, buffers, and flushes on ready.

This covers both "panel not open yet" and "SW restarted, panel not yet re-registered" (FR-002), and
tabs with no panel cause no repeated wakeups (FR-004).

**Alternatives considered**:
- Retry every tick until delivered. Rejected: every browser tab without a panel would wake the SW
  every 250 ms, violating FR-004.
- Buffer in the SW. Rejected: SW memory is exactly what gets lost, and it would add business
  logic to a deliberately stateless router.
- `chrome.storage.session` as a durable buffer. Rejected: write-heavy for frame-level traffic,
  and the bridge's lifetime already matches "same page load" in FR-002.

## Decision: priority-capped backlog

**Rationale**: FR-003. Keep the existing `MAX_QUEUE = 2000` for frames and log lines (drop oldest),
and add a separate `MAX_OPEN_EVENTS` (~200) list for `ws-open`/`sse-open`, flushed first. Every
discard is counted into the existing `dropped` field, which the toolbar already displays.

**Alternatives considered**: a single queue with "never evict open events". Rejected: eviction
becomes O(n) scanning and the cap is no longer a simple bound.

## Decision: network-only connections derived at render time

**Rationale**: FR-005/FR-006. Derive rows from `store.requests` (resourceType `websocket` or status
101 → WS; mime `text/event-stream` → SSE). Exclude URLs matching a frame-level connection, with both
sides resolved via `new URL(url, store.pageOrigin)` because injected URLs can be relative (spec Edge
Cases). Use negative ids (`-req.id`) for selection so they can't collide with injected ids.
Nothing is added to the store, so analysis input and exports are unchanged.

**Alternatives considered**: synthesize `WsConn` entries into the store on `onRequestFinished`.
Rejected: fake zero-frame connections would leak into analysis and exports and need their own
dedup when the real connection appears later.

## Decision: scroll save/restore inside `render()`

**Rationale**: FR-008–FR-011, all solved in one place, for all tabs.
- Before clearing `#app`, read the current `.list-pane` and `.detail-pane` `scrollTop` and store
  them under `renderedTab`. That's the tab the DOM currently shows; `activeTab` may already have
  changed on a tab click.
- After appending, restore the list for `activeTab`.
- Restore the detail scroll only if the selection key (`${tab}:${selected id}`) is unchanged.
- The store is a `Record<TabId, number>`, naturally bounded by the 5 tabs.

**Alternatives considered**:
- Keyed DOM diffing so panes aren't recreated. Rejected: a large rewrite against the project's
  deliberate clear-and-rebuild style (Constitution II/IV).
- `onscroll` listeners writing to state. Rejected: more wiring, and scroll events fire far more
  often than renders.

## Decision: no automated tests

**Rationale**: Same as feature 001. Tests cover `src/analysis/*` only, and every change here is
relay or panel code (Constitution, Additional Constraints). Validation is manual, via
`quickstart.md`.
