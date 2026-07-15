# Woodhouse — Delivery Plan

Chrome DevTools extension that captures HTTP/WS traffic, console logs, and page sources, and explains problems with local, rule-based analysis. See `ARCHITECTURE.md` for design, `OPEN-QUESTIONS.md` for pending decisions.

## Scope recap

1. Capture all HTTP and WebSocket requests/responses
2. Summarize them; export JSON responses as .json files
3. Detect duplicate requests and responses, including partial duplicates
4. Analyze request headers: plain-language summary + unnecessary/privacy-hostile data collection
5. Capture and summarize console logs
6. Scan page sources and summarize

Decisions already made: Chrome/Chromium only, DevTools panel UI, local heuristics only (no LLM), no data leaves the browser.

## Milestones

### M0 — Skeleton (est. 2–3 days)
- Repo scaffolding: Vite + TypeScript + React, manifest v3, CI (lint, typecheck, unit tests)
- DevTools page registers an empty "Woodhouse" panel
- Message plumbing proven end-to-end: injected script → bridge → service worker → panel
- **Done when:** a `console.log` on any page appears as raw text in the panel

### M1 — HTTP capture & inspector (est. 1 week)
- `onRequestFinished` capture + `getHAR()` backfill, ring-buffer store
- Request table: method, URL, status, type, size, time; filter/search
- Detail view: headers, query, request/response body with JSON tree viewer
- Save any JSON response as a `.json` file (requirement 2)
- **Done when:** browsing any SPA shows a live, filterable request log with bodies

### M2 — WebSocket + console capture (est. 1 week)
- `WebSocket` proxy in MAIN world; connection list + frame timeline per connection
- Console capture with safe serialization; console tab with level filters
- Navigation handling: clear-on-navigate + "preserve log" toggle
- **Done when:** a WS echo test page and a noisy console page are fully captured

### M3 — Analysis engine (est. 1.5–2 weeks) ← the differentiator
- Web Worker + pure-function analysis modules, each unit-tested against fixtures:
  - JSON shape/schema summarizer
  - Exact + partial duplicate detector (normalization, Jaccard on structural fingerprints)
  - Header annotator + security-posture rules
  - Privacy rules: tracker-domain list, cookie audit, fingerprinting signals, secrets-in-URL
  - Console grouping + error↔request correlation
- "Insights" tab: ranked findings with severity, explanation, and link to offending request(s)
- **Done when:** fixture site with seeded problems yields all expected findings, zero false positives on a set of clean pages

### M4 — Sources scan + polish (est. 1 week)
- `getResources()` inventory, size/type/first-vs-third-party summary, secret-pattern scan
- Session export (full JSON / HAR), per-site summary report
- Performance pass: 5k+ requests without UI jank (virtualized lists)
- **Done when:** panel stays responsive on a heavy page (e.g. a news site) for 10 min of browsing

### M5 — Release (est. 3–4 days)
- Icons, onboarding empty-state, README, privacy policy ("all local")
- Chrome Web Store listing + review submission
- Playwright E2E suite green in CI

Total: roughly 5–6 weeks of focused work for v1.

## Suggested improvements beyond the original list

Included in plan (cheap, high value):
- **SSE (Server-Sent Events)** — the spec covers WS but not SSE, which many apps use for streaming; capture via the same `EventSource` patch. (M2)
- **Error↔request correlation** — console error near a failed request is the single most useful debugging hint. (M3)
- **Copy as cURL / fetch** on any request. (M1)
- **Secrets detection** in URLs and sources — tokens in query strings are a top real-world bug. (M3)

Deliberately out of v1 (see OPEN-QUESTIONS):
- Request modification/mocking (Requestly's territory — different product)
- `chrome.debugger` "deep mode" for worker traffic
- Optional LLM summaries
- Firefox port

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Page defines `WebSocket`/`console` wrappers before us | Missed WS/console data | `document_start` injection; detect double-wrap; document limitation |
| `getContent()` empty for some cached/redirected responses | Missing bodies | Show "body unavailable" state; backfill via re-fetch opt-in |
| Huge payloads (video, large JSON) blow memory | Panel crash | Size caps + truncation flags + lazy body fetch |
| Tracker list staleness | Weaker privacy findings | Bundle list snapshot; update with each extension release |
| Chrome Web Store review friction over `<all_urls>` | Launch delay | Minimal permissions, clear privacy policy, all-local processing |
