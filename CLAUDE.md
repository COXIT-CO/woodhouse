# Woodhouse

Chrome Manifest V3 DevTools extension. Captures HTTP/WS/SSE/console traffic
inside a "Woodhouse" DevTools panel and runs local, rule-based heuristic
analysis (duplicate/near-duplicate requests, missing security headers, secrets
in URLs, tracker/privacy issues, console-error/failed-request correlation).
**Nothing leaves the browser** — no LLM calls, no network egress. This is
enforced architecturally: manifest `permissions` is just `["storage"]`, no
`webRequest`/`debugger`/`tabs`.

Version 0.1.0. TypeScript, `esbuild`-bundled via `build.mjs`, zero runtime
dependencies (devDependencies only: `esbuild`, `typescript`, `@types/chrome`,
`@types/node`).

## Stack reality check

`docs/ARCHITECTURE.md §6` describes an intended React + Vite +
`@crxjs/vite-plugin` + Vitest + Playwright stack. **None of that is actually
implemented.** Treat that section as aspirational/stale, not current state.
The real UI (`src/panel/`) is vanilla DOM built on a tiny hand-rolled `h()`
hyperscript helper (`src/panel/dom.ts`), and tests run through a hand-rolled
`node:assert/strict` runner (`tests/analysis.test.ts`), not a framework. Don't
propose migrating to the documented stack unless asked — the divergence is
deliberate (dependency-minimalism), not an oversight.

## Directory map

- `src/analysis/` — pure-function rule engine, runs inside a Web Worker.
  Each file (`headers.ts`, `duplicates.ts`, `console-analysis.ts`,
  `sources-analysis.ts`, `json-summary.ts`) exports one `analyzeX`/`findX`
  function taking plain data, returning `Finding[]`. `worker.ts` is the thin
  orchestrator (compose + sort by severity). `privacy-lists.ts` holds static
  data tables (tracker domains, secret regexes) separate from logic.
  `util.ts` holds shared pure helpers (`normalizeUrl`, `canonicalJson`,
  `fnv1a`, `jaccard`, etc.).
- `src/panel/` — the panel UI, no framework. `state.ts` (single mutable
  store + `Set<Listener>` pub/sub, rAF-throttled `notify()`), `capture.ts`
  (Chrome API glue → normalizes events into the store), `dom.ts` (`h()` +
  small DOM utilities), `main.ts` (all rendering/event wiring, manual
  clear-and-rebuild `render()`).
- `src/shared/types.ts` — cross-boundary types (`ReqEntry`, `WsConn`,
  `Finding`, `AnalysisInput`/`Result`, `WhEvent`). File-local types that
  don't cross a boundary stay local to their file instead (e.g. `HarEntry`
  in `capture.ts`).
- Message-relay chain, each hop its own single-purpose file:
  `injected.ts` (MAIN world — monkey-patches `WebSocket`/`EventSource`/
  `console.*`) → `bridge.ts` (ISOLATED content script, batches/relays) →
  `sw.ts` (service worker, pure message router, zero business logic) →
  `panel/capture.ts` (receives over a `chrome.runtime.connect` port).
- `dist/` and `dist-tests/` are **build output but are checked into git** —
  load-unpacked target is `dist/`. Don't be surprised these exist; don't
  hand-edit them, run the build instead.

## Coding conventions

- **No classes anywhere** — pure functions operating on plain data/types.
  The only mutable shared state is the single store object in
  `panel/state.ts`.
- **`unknown` over `any`** — zero `any` in `src/`. Narrow with `as X` casts
  only at real boundary-mismatch points (DOM/Chrome API shapes), and only
  field-by-field, never as a blanket escape hatch.
- **String-literal unions instead of enums** (`Severity`, `ConsoleLevel`,
  `TabId`, etc.) — no enums anywhere in the codebase.
- **No `throw`, no custom Error classes.** Failures degrade to a fallback
  value (`try { ... } catch { return undefined }`) or become `Finding`
  objects (`{severity, category, title, detail}`) — even the analysis
  pipeline's own internal errors become a `Finding` (`worker.ts`) rather
  than propagating. Match this: don't introduce throwing code paths.
- **SCREAMING_SNAKE_CASE** for module-level tunables and static tables
  (`PARTIAL_THRESHOLD`, `MAX_BUCKET`, `TRACKER_DOMAINS`,
  `SECRET_VALUE_PATTERNS`, `CORRELATION_WINDOW_MS`).
- **Cap every collection that can grow unboundedly** — this is a recurring,
  deliberate habit (`CAPS` in `state.ts`; `MAX_QUEUE` in `bridge.ts`;
  `FRAME_CAP`/`BODY_CAP` in `injected.ts`/`capture.ts`; `MAX_BUCKET` in
  `duplicates.ts` to bound O(n²) comparisons). New unbounded-growth code
  needs a cap too.
- **Section-banner comments** to break up long functions instead of
  extracting sub-functions, e.g. `// ---- security posture: main document
  responses ----`. Used consistently in `headers.ts`, `duplicates.ts`,
  `capture.ts`, `panel/main.ts`.
- **Comments explain *why*, not *what*.** One-line `/** ... */` doc comments
  only above functions whose algorithm/tradeoff isn't obvious from the name
  (e.g. `util.ts`'s `normalizeUrl`, `fnv1a`). No `@param`/`@returns` tags, no
  multi-line docstrings. Trivial functions get no comment at all.
- **Formatting**: 2-space indent, double quotes, semicolons, explicit
  param/return types on every exported function (even `void`). `function`
  keyword for exported top-level API, arrow functions for callbacks/local
  helpers. No path aliases — relative imports only.
- **`Finding.detail` strings read like a code-review comment** (plain
  English, specific, sometimes wry) — not generic linter-speak. Match that
  tone when adding new analysis rules.

## Testing

No test framework. `tests/analysis.test.ts` is a single hand-rolled suite
(`node:assert/strict` + a local `test(name, fn)` helper) covering only the
pure `analysis/*` modules — panel UI, capture, bridge, and service worker are
untested by design. Run via `npm test` (`node build.mjs --tests && node
dist-tests/analysis.test.js`).

## No linter/formatter/CI

There's no ESLint/Prettier config and no CI pipeline in this repo — style
above is hand-maintained, not tool-enforced. Match it by hand when editing.
