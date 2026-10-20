# Contract: relay messages (bridge ↔ service worker ↔ panel)

This is internal to the extension, but it's the interface between 3 separately-loaded contexts, so
its shapes are pinned here. **New in this feature**: the `delivered` response, `__whPanelReady`, and
the panel re-sending `init` on reconnect. Unchanged: the `injected.ts → bridge.ts`
`window.postMessage({ __wh: 1, kind, ts, payload })` shape.

## 1. Bridge → SW: event batch (`chrome.runtime.sendMessage`)

```ts
{ __whBridge: 1, events: WhEvent[], dropped: number }
```

**Response (new)**: the SW calls `sendResponse` synchronously:

```ts
{ delivered: boolean } // true iff a panel port was registered for sender.tab.id and postMessage succeeded
```

The bridge treats a rejected promise or a missing response as `{ delivered: false }`.

## 2. Panel → SW: register (`chrome.runtime.connect({ name: "wh-panel" })`, then `port.postMessage`)

```ts
{ type: "init", tabId: number } // chrome.devtools.inspectedWindow.tabId
```

**Changed**: sent again on every reconnect after `port.onDisconnect` (after `RECONNECT_DELAY_MS`).
Not resent once `chrome.runtime.id` is undefined.

## 3. SW → bridge: panel ready (new, `chrome.tabs.sendMessage(tabId, …)`)

```ts
{ __whPanelReady: 1 }
```

Sent when an `init` registers a port. The bridge sets `attached = true` and flushes its backlog
(open events first). Rejections (no content script in that tab, e.g. `chrome://` pages) are
swallowed with `.catch(() => {})`.

## 4. SW → panel: forwarded batch (`port.postMessage`, unchanged)

```ts
{ type: "events", events: WhEvent[], dropped: number }
```

## Invariants

- The SW holds no event data. Its only state is still `panels: Map<tabId, Port>`.
- No message leaves the browser (Constitution III). No new manifest permission (Constitution V).
- A batch is either delivered or kept in the bridge's backlog, never silently discarded. The only
  discards are cap evictions, which are counted in `dropped`.
