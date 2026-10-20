## 1. Confirm root cause

- [ ] 1.1 Reproduce on a WebSocket-using page: open the panel, wait more than 30 s idle, then trigger
      traffic. Check `chrome://serviceworker-internals` (or the SW's DevTools) for a stopped/restarted
      worker and confirm the WS/SSE and Console tabs stay at 0. Verify by recording the observation in
      this task's note. If the cause turns out to be different (e.g. the socket lives in a worker),
      pause and update design.md before continuing.

## 2. Relay reliability

- [ ] 2.1 In `src/panel/capture.ts`, extract `connect`/`init`/`onMessage` into a local `connectPort()`
      and re-invoke it from `port.onDisconnect` after `RECONNECT_DELAY_MS`, stopping once
      `chrome.runtime.id` is undefined. Verify by stopping the SW from `chrome://serviceworker-internals`
      with the panel open, then logging from the page: the entry appears in the Console tab.
- [ ] 2.2 In `src/sw.ts`, reply to each bridge batch with `sendResponse({ delivered })` and, on panel
      `init`, send `{ __whPanelReady: 1 }` to that tab via `chrome.tabs.sendMessage` (rejections
      swallowed). Verify with `npm run typecheck`, and confirm `src/manifest.json` permissions are
      still exactly `["storage"]`.
- [ ] 2.3 In `src/bridge.ts`, add the `attached` state: requeue undelivered/rejected batches at the
      front, stop sending while `attached === false`, flush on `__whPanelReady`. Verify by loading a
      page that opens a WebSocket and logs, *then* opening the panel: the connection and log lines
      appear.
- [ ] 2.4 In `src/bridge.ts`, keep `ws-open`/`sse-open` events in a separate `MAX_OPEN_EVENTS`-capped
      list flushed ahead of the main queue, and count every discard into `dropped`. Verify by flooding
      `console.log` well over `MAX_QUEUE` times before opening the panel: the WS/SSE tab still lists
      the connection and the toolbar shows a non-zero "events dropped".

## 3. Network-only connections in the WS/SSE tab

- [ ] 3.1 In `src/panel/main.ts`, add a helper that derives network-only connections from
      `store.requests` (WebSocket handshake or `text/event-stream`), deduplicated against
      `store.wsConns`/`store.sseConns` by URL resolved against `store.pageOrigin`. Verify with
      `npm run typecheck`.
- [ ] 3.2 Render those rows in `renderWs()` with State "frames not captured" and a detail view
      explaining why, using negative ids for selection; include them in the WS/SSE tab badge and the
      toolbar `ws` count. Verify on the originally reported page (or any page whose socket opened
      before the panel) that the badge is non-zero and the row is listed once.
- [ ] 3.3 Replace the WS/SSE empty-state text with copy that matches actual behavior (appears once the
      page opens a connection; workers/cross-origin frames aren't frame-captured). Verify by opening
      the tab on a page with no sockets and reading the message.

## 4. Scroll preservation

- [ ] 4.1 In `render()` (`src/panel/main.ts`), save `.list-pane` scroll per `renderedTab` and
      `.detail-pane` scroll plus the selection key before clearing `#app`, then restore after append
      (detail scroll only when the selection key is unchanged). Verify: in the Requests tab, scroll down,
      click a lower row → the list doesn't move and that row is highlighted.
- [ ] 4.2 Verify the remaining spec scenarios manually: scrolled list and detail stay put while new
      requests stream in; clicking a different request opens its detail at the top; the Requests
      scroll position survives switching to Console and back; WS/SSE list selection keeps scroll.

## 5. Regression check and polish

- [ ] 5.1 Confirm the onboarding banner and the per-tab empty states still render, and that filter
      input focus/caret is still preserved while typing during live capture.
- [ ] 5.2 Run `npm run typecheck`, `npm run build` and `npm test`; verify all succeed with no new
      errors.
