# Phase 1 Data Model: Fix WS/SSE & Console Capture and List Scroll Reset

None of this is persisted, and none of it crosses into `src/shared/types.ts` or the analysis
worker. All three entities are local to one context.

## Retained event backlog (content script, `src/bridge.ts`)

| Field | Type | Notes |
|---|---|---|
| `openEvents` | `WhEvent[]` | `ws-open`/`sse-open` only. Capped at `MAX_OPEN_EVENTS` (~200), oldest dropped. Flushed first. |
| `queue` | `WhEvent[]` | Everything else (frames, SSE messages, console, close/error). Capped at the existing `MAX_QUEUE` (2000), oldest dropped. |
| `dropped` | `number` | Existing counter. Every discard from either list is added, and it's sent with the next delivered batch. |
| `attached` | `boolean \| undefined` | `undefined` = unknown (send optimistically); `true` = panel confirmed; `false` = last batch undelivered, buffer only. |

**State transitions** (`attached`):
- `undefined` → `true`: a batch is acknowledged `{ delivered: true }`, or `__whPanelReady` arrives.
- `undefined`/`true` → `false`: a batch comes back `{ delivered: false }` or the send rejects. The
  batch is put back at the front of the queue (it still counts against the caps).
- `false` → `true`: `__whPanelReady` arrives, which triggers an immediate flush.
- While `false`, the 250 ms tick does not send (FR-004).

**Lifetime**: the page load. A navigation destroys the content script and its backlog, matching
"same page load" in FR-002.

## Network-only connection (panel, derived in `src/panel/main.ts`)

| Field | Source | Notes |
|---|---|---|
| `id` | `-req.id` | Negative, so it never collides with injected connection ids. |
| `kind` | `"WS"` / `"SSE"` | WS if `resourceType === "websocket"` or `status === 101`; SSE if `mimeType` starts with `text/event-stream`. |
| `url` | `req.url` | Compared to frame-level connections after resolving both with `new URL(url, store.pageOrigin)` (fallback: raw string). |
| `openedAt` | `req.startedAt` | For display order. |

**Validation rules**: excluded whenever a frame-level connection in `store.wsConns`/`store.sseConns`
has the same resolved URL (FR-006). Recomputed on every render and never stored. Its size is bounded
by `CAPS.requests`.

## Per-tab view position (panel, `src/panel/main.ts`)

| Field | Type | Notes |
|---|---|---|
| `listScroll` | `Record<TabId, number>` | Saved under `renderedTab` before each rebuild, restored for `activeTab` after. Bounded by the 5 tabs. |
| `detailScroll` | `number` | The scroll of the currently rendered detail pane. |
| `detailKey` | `string` | `${tab}:${selected id}` at the last render. Detail scroll is restored only if the new key matches (FR-010). |
| `renderedTab` | `TabId` | The tab the current DOM shows, needed because a tab click changes `activeTab` before `render()` runs. |

**Lifetime**: the panel session. Closing DevTools discards it (spec Assumptions). "Clear" and a
non-preserved navigation empty the lists, and the browser clamps the restored scroll to 0.
