# Quickstart: Validating the capture and scroll fixes

## Prerequisites

- `npm ci` (if `esbuild` complains about a platform binary), then `npm run build`.
- Load `dist/` unpacked in Chrome (see README). After every rebuild, click reload on the extension card.
- A test page that opens a WebSocket and logs to the console. The originally reported app
  (dev.archiscan.ai, NATS over `wss://`) works, or a local page with:
  `new WebSocket("wss://echo.websocket.org"); setInterval(() => console.log("tick"), 2000);`
- `chrome://serviceworker-internals` open in another tab, to watch and stop the Woodhouse worker.

## Scenario 1: capture survives a worker restart (User Story 1, FR-001)

1. Open the test page, open DevTools, and switch to Woodhouse.
2. Wait more than 30 s with no page activity, or click **Stop** on the Woodhouse worker in
   `chrome://serviceworker-internals`.
3. Trigger a socket message and a `console.warn("after restart")`.
4. **Expected**: the message appears on its connection in WS/SSE, and `after restart` appears in
   Console, without reopening DevTools.

## Scenario 2: activity before the panel opens (User Story 1, FR-002)

1. Open the test page with DevTools **closed**, and let it connect and log for ~10 s.
2. Open DevTools, then Woodhouse.
3. **Expected**: the connection is listed in WS/SSE and the earlier `tick` lines are in Console.

## Scenario 3: backlog cap (FR-003)

1. With DevTools closed, run `for (let i = 0; i < 5000; i++) console.log(i)` in the page.
2. Open Woodhouse.
3. **Expected**: Console shows the most recent lines, WS/SSE still lists the connection, and the
   toolbar shows a non-zero "events dropped".

## Scenario 4: network-only rows (User Story 3, FR-005–FR-007)

1. Open Woodhouse **after** a page has already connected its socket (the handshake is backfilled
   into Requests, but its frames predate the hook). Alternatively, use a page whose socket lives in
   a Web Worker.
2. **Expected**: WS/SSE lists the URL once, labeled "frames not captured", and both the tab badge
   and the toolbar `ws` count are non-zero.
3. On a page with no sockets: **Expected**: the WS/SSE empty message mentions that workers and
   embedded third-party frames aren't frame-captured.

## Scenario 5: scroll is preserved (User Story 2, FR-008–FR-011)

1. Capture 100+ requests (reload a busy page). Scroll the Requests list to the middle.
2. Click a row. **Expected**: the list doesn't move and the row is highlighted.
3. Scroll the detail pane down and let more requests arrive. **Expected**: neither pane jumps.
4. Click a different row. **Expected**: the detail pane starts at the top.
5. Switch to Console, then back to Requests. **Expected**: the list is where you left it.
6. Repeat step 2 in the WS/SSE tab with several connections.

## Regression checks

- The onboarding banner still appears and dismisses (feature 001's quickstart).
- Typing in the filter box during live capture keeps focus and caret.
- `npm run typecheck`, `npm run build` and `npm test` all pass.
- `src/manifest.json` permissions are still exactly `["storage"]`.

See [data-model.md](./data-model.md) for state details and
[contracts/relay-messages.md](./contracts/relay-messages.md) for message shapes.
