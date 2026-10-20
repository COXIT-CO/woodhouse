## Why

On a real session (dev.archiscan.ai, NATS over `wss://`) the Requests tab listed two `101 websocket`
handshakes, but the WS/SSE tab and the Console tab both stayed at **0** — even though DevTools itself
reported 8 warnings and 1 error. Separately, clicking any row in the Requests list snaps the list
back to the first row, which makes inspecting anything below the fold nearly impossible. Both bugs
hit the panel's two core workflows (live traffic + drill-down), so they block real use.

Observed root causes (from reading the code, not yet confirmed in-browser):

- **Relay loses events silently.** WS/SSE/console events travel `injected.ts → bridge.ts → sw.ts →
  panel`. The service worker keeps panel ports in an in-memory `Map`; MV3 idle-terminates the SW
  (~30 s without events), which drops that map and disconnects the panel's port. `capture.ts` never
  handles `onDisconnect`, so it never re-registers, and from then on every bridge batch is discarded
  by the SW (`if (!port) return;`). The same discard happens for anything the page emitted *before*
  the panel was opened — contradicting the WS/SSE empty-state text, which claims early connections
  "are captured automatically".
- **Full re-render resets scroll.** `render()` in `src/panel/main.ts` clears `#app` and rebuilds it
  on every click and every store `notify()`, so each `.list-pane` / `.detail-pane` is a fresh element
  with `scrollTop = 0`. Only the filter input's focus/caret is preserved today.

## What Changes

- Panel re-registers with the service worker whenever its port disconnects, so a SW restart no longer
  silently ends live capture.
- Events the page emits while no panel is registered (panel not open yet, or SW restarting) are held
  in a capped backlog in the content script and delivered once a panel registers, instead of dropped.
- The WS/SSE tab also lists WebSocket / SSE connections seen only via the network log (HAR), marked as
  "frames not captured", so it can never show 0 while the Requests tab shows a `101 websocket` row.
- The WS/SSE empty-state message is corrected to describe actual behavior.
- List and detail panes keep their scroll position across re-renders (row clicks, streaming updates);
  the detail pane resets to top only when a *different* item is selected.

## Capabilities

### New Capabilities
- `live-event-capture`: delivery guarantees for WS/SSE/console events from the page to the panel
  (SW-restart recovery, pre-open backlog, network-log fallback for connections).
- `panel-scroll-preservation`: scroll position behavior of the panel's list and detail panes across
  re-renders and selection changes.

### Modified Capabilities
(none — `onboarding-banner` is unaffected)

## Impact

- **Code**: `src/panel/capture.ts` (port reconnect on disconnect), `src/bridge.ts`
  (capped backlog + delivery acknowledgement), `src/sw.ts` (reply whether a panel received the
  batch — still routing only, no business logic), `src/panel/main.ts` (scroll save/restore in
  `render()`, network-only connection rows derived from `store.requests`, empty-state copy). No
  shared-type or analysis-input changes — network-only rows are a render-time view, not stored.
- **Permissions / deps**: none added. `chrome.runtime.sendMessage` response callbacks need no new
  permission; manifest stays `["storage"]`.
- **Out of scope**: sockets opened inside Web Workers or cross-origin iframes (content scripts are not
  `all_frames`), and capturing frames for connections that were already open before `injected.ts`
  ran. These stay visible only as network-only rows.
