# Woodhouse — Architecture

Chrome (Manifest V3) DevTools extension for inspecting HTTP/WS traffic, headers, console logs, and page sources, with local heuristic analysis. No data leaves the browser.

## 1. Constraints that drive the design

These are hard platform facts, not choices:

| Need | MV3 reality | Consequence |
|---|---|---|
| HTTP response bodies | `chrome.webRequest` **cannot** read bodies in MV3 | Must use `chrome.devtools.network.onRequestFinished` + `request.getContent()` — available only while DevTools is open |
| WebSocket frames | Not exposed by `chrome.devtools.network`; only via CDP (`chrome.debugger`) or page-world patching | Patch `window.WebSocket` in the MAIN world via content script |
| Console logs | No extension API; only CDP (`Runtime.consoleAPICalled`) or patching | Patch `console.*` + listen to `window.onerror` / `unhandledrejection` in MAIN world |
| `chrome.debugger` | Shows a persistent "…is debugging this browser" infobar; can conflict with open DevTools | Avoid in v1. Keep as optional "deep mode" later (captures workers/SSE frames the patch misses) |
| Page sources | `chrome.devtools.inspectedWindow.getResources()` + `getContent()` | Free while panel is open |

Accepting "capture only while DevTools is open" is fine — the target user is a developer with DevTools open anyway, and it's how React/Vue DevTools behave.

## 2. Component overview

```
┌─────────────────────────────  Browser tab  ─────────────────────────────┐
│  Page (MAIN world)                    Content script (ISOLATED world)    │
│  ┌───────────────────────┐  window     ┌──────────────────────────┐      │
│  │ injected.js           │──postMessage│ bridge.js                │      │
│  │ • wraps WebSocket     │────────────▶│ • validates & relays     │      │
│  │ • wraps console.*     │             │   via chrome.runtime     │      │
│  │ • onerror/rejection   │             └───────────┬──────────────┘      │
│  └───────────────────────┘                         │                     │
└────────────────────────────────────────────────────┼─────────────────────┘
                                                     ▼
                              ┌──────────────────────────────┐
                              │ Service worker (background)   │
                              │ • message router only         │
                              │ • maps tabId → panel port     │
                              └───────────┬──────────────────┘
                                          ▼
┌──────────────────────────── DevTools (per inspected tab) ───────────────┐
│ devtools_page ─ creates panel                                            │
│ ┌──────────────────────────────────────────────────────────────────┐    │
│ │ Panel UI (React + TypeScript)                                     │    │
│ │ • chrome.devtools.network.onRequestFinished → HTTP capture        │    │
│ │ • chrome.devtools.inspectedWindow.getResources → sources          │    │
│ │ • Store (in-memory ring buffer, cap ~5k entries)                  │    │
│ │ • Analysis engine (Web Worker):                                   │    │
│ │     headers / privacy / duplicates / JSON summary / sources       │    │
│ │ • Export: JSON / HAR via downloads                                │    │
│ └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

Data flow: WS frames and console events go page → bridge → service worker → panel port. HTTP and sources are captured directly in the panel (no round trip). All analysis runs in a Web Worker inside the panel so the UI never blocks.

## 3. Capture layer

**HTTP.** `onRequestFinished` yields a HAR entry (URL, method, status, headers, timings, sizes). Bodies fetched lazily via `getContent()` — immediately for JSON/text under a size cap (e.g. 1 MB), on-demand otherwise. `getHAR()` backfills requests made before the panel opened.

**WebSocket.** `injected.js` (declared `world: "MAIN"`, `run_at: document_start`) replaces `window.WebSocket` with a transparent proxy recording: connection open/close (URL, protocols, close code), sent/received frames with timestamps and direction, and errors. Payloads over a cap are truncated with a flag. Known blind spots: WS created inside Workers/SharedWorkers, and pages that capture the constructor before us (rare with `document_start`).

**Console.** Same injected script wraps `console.log/info/warn/error/debug/trace`, plus `window.onerror` and `unhandledrejection`. Arguments serialized with safe structured-clone fallback (circular refs → `"[Circular]"`, DOM nodes → selector string, depth cap).

**Sources.** On demand (not continuous): `getResources()` lists all loaded resources; contents pulled for scripts/HTML/CSS under a size cap.

## 4. Analysis engine (Web Worker, rule-based)

**JSON summary.** Detect JSON by content-type + sniffing. Produce: top-level shape, inferred schema (keys, types, array lengths), byte size, and one-click "save as .json file" via `chrome.downloads`.

**Duplicate detection (exact + partial).**
- Normalize request identity: method + origin+path + sorted query keys + body hash (JSON bodies canonicalized: sorted keys, volatile fields like `timestamp`/`nonce`/`requestId` optionally masked).
- Exact duplicates: identical normalized hash within a time window → flag "N identical calls, consider caching/dedup".
- Partial duplicates: same endpoint, similar body/response. Similarity via structural fingerprint (set of `path:type` pairs from flattened JSON) compared with Jaccard index; threshold ~0.8 flags "near-duplicate". Cheap (no LLM), works on responses too — near-identical responses from different endpoints often reveal over-fetching.

**Header analysis.** Rule tables produce a per-request and per-site summary:
- *Meaning*: annotate each header (cache, CORS, auth, security) in plain language.
- *Security posture*: missing CSP / HSTS / X-Content-Type-Options / Referrer-Policy; weak cache directives on private data; `Server`/`X-Powered-By` version disclosure.
- *Privacy / unnecessary data collection*: known tracking headers (`X-Client-Data`, extensive Client Hints, `ETag` used as identifier), cookie audit (3rd-party, missing `Secure`/`HttpOnly`/`SameSite`, lifetime), request destinations matched against a bundled tracker domain list (EasyPrivacy/DuckDuckGo tracker radar snapshot), high-entropy fingerprinting signals in query/body (screen size, canvas hashes, battery, fonts).
- *Secrets in the clear*: bearer tokens / API keys in URLs, credentials in query strings.

**Console summary.** Group by message signature (strip numbers/ids), count repeats, split errors/warnings/logs, highlight uncaught exceptions and failed-request correlations (console error within ±500 ms of a 4xx/5xx).

**Sources summary.** Inventory (count/size by type, first/third-party split), large or duplicated bundles, source-map availability, inline scripts count, and a light secret-pattern scan (API key regexes) over first-party JS.

## 5. Storage & lifecycle

In-memory ring buffer in the panel (per-tab, cleared on navigation unless "preserve log" is on). Optional IndexedDB persistence for named sessions. Settings in `chrome.storage.local`. Nothing is ever sent over the network — this is the core privacy promise and should be stated in the store listing.

## 6. Tech stack

TypeScript, React, Vite + `@crxjs/vite-plugin` (or plain Vite multi-entry), Vitest for the analysis engine (pure functions — highly testable), Playwright for E2E against a fixture site that emits known traffic/WS/console patterns.

## 7. Manifest sketch

```jsonc
{
  "manifest_version": 3,
  "name": "Woodhouse",
  "devtools_page": "devtools.html",
  "background": { "service_worker": "sw.js" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["bridge.js"], "run_at": "document_start" },
    { "matches": ["<all_urls>"], "js": ["injected.js"], "run_at": "document_start", "world": "MAIN" }
  ],
  "permissions": ["storage", "downloads"],
  "host_permissions": ["<all_urls>"]
}
```

Note the small permission set — no `webRequest`, no `debugger`, no `tabs`. Good for Chrome Web Store review and user trust.
