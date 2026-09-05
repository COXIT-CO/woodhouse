# Implementation Plan: Onboarding Banner

**Branch**: `001-onboarding-banner` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-onboarding-banner/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Show a dismissible, one-time banner above the Woodhouse panel's tab bar on first open,
explaining the 5 tabs and the local-only privacy guarantee. Persist dismissal via
`chrome.storage.local`. Purely additive UI change using the panel's existing hand-rolled
render/`h()` pattern — no new dependencies, no framework, no network calls.

## Technical Context

**Language/Version**: TypeScript (ES2022 target), bundled via `esbuild` (`build.mjs`) — no
runtime framework.

**Primary Dependencies**: None (project has zero runtime dependencies; this feature adds none).

**Storage**: `chrome.storage.local`, a single new boolean key `wh_onboarding_dismissed`. This is
the **first actual use** of the `storage` permission — it's declared in the manifest today but
currently unused anywhere in `src/` (confirmed via `grep -rn "chrome.storage" src/`).

**Testing**: Project's hand-rolled `node:assert/strict` runner (`tests/analysis.test.ts`) — scope
is limited to `src/analysis/*` pure functions by existing convention. This feature has no
pure-function surface (it's storage + DOM wiring), so no new automated test is added; this
matches the same conclusion reached independently on the OpenSpec trial branch.

**Target Platform**: Chrome/Chromium MV3 DevTools extension, `minimum_chrome_version: "111"`.

**Project Type**: Single project — browser extension (not a web-service/mobile split; the
template's default "Option 1" below is adapted to the project's real layout).

**Performance Goals**: No perceptible added render delay (target <100ms), per spec SC-003.

**Constraints**: No new dependencies, no framework, no network egress, no new Chrome permission
(reuses the already-granted `storage` permission).

**Scale/Scope**: One boolean storage key, one small render function, ~3 files touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Dependency Bias | PASS | No new runtime or dev dependency. |
| II. No Framework | PASS | Built with the existing `h()` hyperscript helper (`src/panel/dom.ts`); no framework introduced. |
| III. Local-Only Processing | PASS | `chrome.storage.local` only; no network call of any kind. |
| IV. Match House Style | PASS | See Project Structure below — new module follows one-file-per-concern layout, `wh_`-prefixed storage key matches existing naming convention, no classes, explicit types. |
| V. Minimal Chrome Permissions | PASS | Uses the `storage` permission already declared in the manifest; no new permission requested. |

No violations — Complexity Tracking table is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-onboarding-banner/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

(No `contracts/` — this feature has no external interface; it's an internal panel UI addition.)

### Source Code (repository root)

```text
src/
├── analysis/             # pure-function rule engine — unaffected by this feature
├── panel/
│   ├── main.ts           # top-level render(); mounts the banner above the tab bar
│   ├── state.ts          # existing store — unaffected; banner state lives outside it
│   ├── dom.ts             # existing h() helper — reused, no changes
│   └── onboarding.ts      # NEW: renderOnboardingBanner() + chrome.storage.local read/write
├── shared/types.ts        # no changes — banner state is panel-local, not cross-boundary
└── styles.css             # NEW .onboarding-banner rules, matching existing .empty visual language
```

**Structure Decision**: Single project (Chrome extension), matching the template's "Option 1"
adapted to woodhouse's real directories. Only `src/panel/` and `src/styles.css` are touched;
`src/analysis/` and `src/shared/` are untouched by this feature.

## Complexity Tracking

*(Not applicable — no Constitution Check violations.)*
