# Woodhouse — Open Questions

Decisions needed from you, roughly in order of urgency. Each has a recommendation so a "go with defaults" answer works.

## Q1. Is capture-only-while-DevTools-is-open acceptable?

The clean MV3 way to get response bodies (`chrome.devtools.network`) only works while the panel is open. Capturing *everything in the background* (like an adblocker does) would require `chrome.debugger` — permanent warning bar, scarier permissions, store-review friction — and still wouldn't give bodies via `webRequest`.

**Recommendation:** yes, accept it. Target user has DevTools open anyway. Revisit with an optional "deep mode" later.

## Q2. What does "scan sources" mean exactly?

Requirement 6 is the vaguest. Options, cheapest first:
a) Inventory only — count/size/type, first- vs third-party, largest files
b) a + secret/API-key pattern scan and source-map availability
c) b + dependency detection (library fingerprints, known-vulnerable versions à la retire.js)
d) c + static analysis for code smells — big scope, arguably a different product

**Recommendation:** (b) for v1, (c) as fast-follow. Confirm what problem you wanted solved here.

## Q3. Duplicate detection — what counts as "partial"?

Proposed: same normalized endpoint + structural similarity of JSON bodies ≥ 0.8 (Jaccard over flattened `path:type` pairs), with volatile fields (`timestamp`, `nonce`, ids) masked. Tunables: threshold, time window (whole session vs last N minutes), and whether responses from *different* endpoints are compared (catches over-fetching, costs more CPU).

**Recommendation:** threshold 0.8, whole-session window, cross-endpoint comparison for responses ON but capped to same content-type and size bucket. Needs your confirmation because it defines the feature's signal/noise ratio.

## Q4. How aggressive should privacy findings be?

Flagging "unnecessary data collection" is judgment-heavy. A strict mode flags every third-party cookie and every Client Hint; a lenient mode only flags known trackers and clear fingerprinting. Strict = noisy on almost every commercial site.

**Recommendation:** three severity tiers (info / warning / issue) with lenient defaults and a strictness slider in settings.

## Q5. Persistence

In-memory only (lost when DevTools closes) vs opt-in saved sessions in IndexedDB (compare two sessions, share exports with teammates).

**Recommendation:** in-memory for v1 + full-session JSON export, IndexedDB sessions in v1.1. Cheap to defer, expensive to build well now.

## Q6. Name check

"Woodhouse" — is this the intended product name for the store listing, or a codename? (Trademark/collision check needed before store submission either way.)

## Q7. Later: optional LLM layer?

You chose local heuristics — right call for v1. But a "explain this request/error in plain language" button using a user-supplied API key is a natural v2 differentiator vs Requestly/HTTP-tracker style tools. Park it, but the analysis-engine API will be designed so a second backend can plug in.

## Q8. Distribution — DECIDED

Dev-mode load for the team first. Public listing deferred.

Additional requirement: usable "via the Claude app". Plan:
- **v1 (free):** session JSON export is designed to be Claude-friendly (self-describing, findings included) — drop it into a Claude chat or Cowork folder for analysis.
- **v2:** Woodhouse MCP server — extension exposes captured traffic + analysis findings through a local MCP endpoint (native messaging host or localhost server) added to the Claude desktop app as a custom connector. Claude can then query live sessions ("why did this request fail?", "list duplicate calls").
- Prior art to study: [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) (Google) already exposes raw DevTools network/console to agents via CDP. Woodhouse's MCP value is the *analysis layer* (duplicates, privacy findings, correlations), not raw frames — expose findings as first-class MCP tools.

**New open sub-question (Q8a):** MCP transport — native messaging host (no open port, but requires per-machine host install) vs localhost WebSocket/HTTP server (simpler, but an open port serving captured traffic needs auth). Recommendation: native messaging host.
