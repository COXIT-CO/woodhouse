## Context

See proposal.md - Why for the two observed bugs and their root causes. Relevant current state:

- Relay chain: `injected.ts` (MAIN world, `window.postMessage`) → `bridge.ts` (ISOLATED, 250 ms batch,
  `MAX_QUEUE = 2000`, fire-and-forget `chrome.runtime.sendMessage`) → `sw.ts` (in-memory
  `panels: Map<tabId, Port>`, drops a batch when no port) → `panel/capture.ts` (one
  `chrome.runtime.connect`, `init` sent once, no `onDisconnect` handler).
- Content scripts run in the top frame only (no `all_frames`), so a tab has exactly one bridge.
- `panel/main.ts`'s `render()` clears `#app` and rebuilds every pane on each click and each
  rAF-throttled `notify()`. Every tab's list is a `.list-pane`, its detail a `.detail-pane`, both
  `overflow: auto`.
- Constraints: manifest permissions stay `["storage"]`; SW stays a router with no business logic;
  no classes/throws; every growable collection capped.

## Goals / Non-Goals

**Goals:**
- No silent loss of relay events for an open panel, regardless of SW lifecycle.
- Pre-open events reach the panel without the bridge waking the SW repeatedly from tabs that never
  get a panel.
- Scroll preservation as a property of `render()` itself, so every tab gets it with no per-tab code.

**Non-Goals:**
- Capturing sockets in Web Workers / cross-origin iframes, or frames of sockets opened before
  `injected.ts` ran — covered only by network-only rows.
- Replacing clear-and-rebuild rendering with keyed DOM diffing.
- Fixing the existing WS/SSE id-space overlap (both counters start at 1) beyond what selection of
  network-only rows needs.
- New automated tests — `tests/analysis.test.ts` covers `src/analysis/*` only, and nothing here lives
  there. Verified manually (see tasks.md group 5).

## Decisions

**1. Panel reconnects on port disconnect.**
`capture.ts` moves `connect` + `init` + `onMessage` into a local `connectPort()` and calls it again
from `port.onDisconnect` after a short delay (`RECONNECT_DELAY_MS`, ~250 ms). If the disconnect is
caused by the extension itself being reloaded (`chrome.runtime.id` becomes undefined), it stops — the
panel is dead anyway.
*Alternative:* periodic keepalive pings to stop the SW from idling. Rejected — fights the browser's
lifecycle, costs wakeups forever, and still needs reconnect logic for other termination causes.

**2. Delivery acknowledgement + "panel ready" handshake instead of blind retries.**
- `sw.ts` answers each bridge batch synchronously via `sendResponse({ delivered: boolean })`.
- On `init`, `sw.ts` sends `{ __whPanelReady: 1 }` to that tab with `chrome.tabs.sendMessage`
  (no `tabs` permission required for messaging).
- `bridge.ts` tracks `attached: boolean | undefined`. While `attached !== false` it sends batches as
  today; an undelivered (or rejected) batch is put back at the front of the queue and sets
  `attached = false`, after which the bridge only buffers. On `__whPanelReady` it sets
  `attached = true` and flushes.

Both "panel not open yet" and "SW just restarted, panel not re-registered yet" collapse into the same
path: buffer → panel (re)registers → ready → flush.
*Alternatives:* (a) retry every tick until delivered — rejected, every browser tab without a panel
would wake the SW every 250 ms; (b) buffer in the SW — rejected, the SW's memory is exactly what gets
lost on restart, and it would add state to a deliberately stateless router.

**3. Priority-aware backlog cap in the bridge.**
Keep `MAX_QUEUE` for frames/console lines (drop oldest when full) and keep `ws-open`/`sse-open` events
in a separate small capped list (`MAX_OPEN_EVENTS`, ~200) flushed first, so a chatty socket can't
evict the record that it exists. Discards are counted into the existing `dropped` field, which the
panel already shows as "N events dropped".

**4. Network-only connections are derived at render time, not stored.**
A local helper in `main.ts` derives rows from `store.requests` where the entry is a WebSocket
handshake (`resourceType === "websocket"` or `status === 101`) or an SSE response
(`mimeType` starts with `text/event-stream`), excluding any whose URL matches a frame-level
connection in `store.wsConns`/`store.sseConns`. URLs from `injected.ts` can be relative, so both sides
are resolved with `new URL(url, store.pageOrigin)` (fallback: raw string) before comparing.
The WS/SSE badge and toolbar count include these rows; their State column reads "frames not
captured"; selecting one shows the URL plus a one-line explanation. Selection uses a negative id
(`-req.id`) so it can't collide with injected ids.
*Alternative:* synthesize `WsConn` entries into the store from `onRequestFinished`. Rejected — they
would flow into analysis input and exports as fake zero-frame connections, and need their own dedup
when the real connection appears later.

**5. Scroll save/restore inside `render()`.**
Before clearing `#app`, read `scrollTop` of the current `.list-pane` and `.detail-pane` and store them
under the tab that is *currently rendered* (a `renderedTab` variable — not `activeTab`, which a tab
click has already changed). After appending, restore the list scroll for `activeTab`, and restore the
detail scroll only if the selection key (`${activeTab}:${selected id}`) equals the one rendered last
time; otherwise leave it at 0. Storage is a `Record<TabId, number>` — bounded by the 5 tabs. This
mirrors how `render()` already preserves the filter input's focus and caret.
*Alternative:* per-tab `onscroll` listeners writing to state. Rejected — more wiring for the same
result, and scroll events fire far more often than renders.

## Risks / Trade-offs

- [Requests list over `MAX_ROWS` (500) drops rows from the top on new arrivals, so a fixed `scrollTop`
  drifts by the height of the dropped rows] → Accepted; only affects sessions above 500 visible rows,
  and is still far better than snapping to top.
- [`tabs.sendMessage` to a tab whose bridge isn't loaded (e.g. `chrome://` page) rejects] → Swallow
  in `sw.ts` with `.catch(() => {})`; nothing to deliver there anyway.
- [Panel reconnect loop if the SW keeps failing] → One reconnect at a time, fixed delay; no unbounded
  timer growth.
- [Root cause not yet confirmed in-browser — the WS on the reported site could also be created in a
  worker] → Task 1.1 confirms it first; network-only rows (Decision 4) make the tab truthful either
  way.
- [URL dedup misses when the page connects via a different but equivalent URL] → Worst case a
  connection is shown twice (one network-only row); harmless and visible.

## Migration Plan

Not applicable — runtime behavior only, no stored data. Reload the unpacked extension to deploy;
revert the commit to roll back.
