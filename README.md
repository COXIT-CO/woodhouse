# Woodhouse

Chrome DevTools extension for developers: captures HTTP/WS/SSE traffic, console logs and page sources, then explains problems with local, rule-based analysis. Nothing ever leaves your browser.

## Features

- **Requests tab** — live HTTP capture with headers, query params, bodies; JSON responses get a shape summary and one-click "Save as .json"; copy any request as cURL.
- **WS/SSE tab** — WebSocket and Server-Sent-Events connections with a full frame timeline.
- **Console tab** — page console output (including uncaught errors and unhandled rejections) with level filters.
- **Sources tab** — inventory of loaded resources: type, size, first/third-party.
- **Insights tab** (press **Analyze**) — ranked findings:
  - exact & partial duplicate requests, near-identical responses across endpoints (over-fetching)
  - missing security headers, insecure cookies, CORS misconfig, version disclosure
  - privacy: known trackers contacted, third-party cookies, fingerprinting client hints, tracking headers
  - secrets/tokens in URLs and page sources
  - console errors correlated with failed requests, noisy logging
  - failed and slow requests, large/duplicate bundles
- **Export session** — one JSON file with everything (Claude-friendly: drop it into a Claude chat to debug together).

## Install (dev mode)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Open DevTools on any page → **Woodhouse** panel

Reload the inspected page after opening the panel to capture everything from the start.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit tests for the analysis engine
npm run build       # bundle to dist/
```

## Notes & known limitations

- Response bodies are only available while the panel is open (MV3 limitation); requests captured before opening are backfilled without bodies.
- WebSockets created inside Workers aren't visible to the page-world wrapper.
- Binary payloads are recorded as size-only placeholders.
- Analysis is heuristic — treat findings as leads, not verdicts.

See `docs/ARCHITECTURE.md`, `docs/PLAN.md` and `docs/OPEN-QUESTIONS.md` for design and roadmap.
