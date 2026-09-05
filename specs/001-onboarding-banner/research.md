# Phase 0 Research: Onboarding Banner

No `NEEDS CLARIFICATION` markers remained in the Technical Context — this feature is small enough,
and the project's conventions (`CLAUDE.md`) documented enough, that the only real decision was
*which storage API and key naming to use*, resolved below.

## Decision: Persist dismissal via `chrome.storage.local`, key `wh_onboarding_dismissed`

**Rationale**:
- The manifest already grants the `storage` permission (unused elsewhere in `src/` today — see
  Technical Context), so no permission change is needed, satisfying Constitution Principle V.
- `wh_`-prefixing matches the project's existing cross-boundary marker convention (`__wh`,
  `__whBridge` in `injected.ts`/`bridge.ts`/`sw.ts`), even though this key never crosses a
  postMessage boundary — kept for naming consistency, not because it's technically required here.
- `local` (not `sync`) is deliberate: a first-run flag syncing across a user's devices means
  dismissing it on one machine could hide the onboarding explanation on another machine where the
  user has never actually seen it — undesirable for a one-time explanation.

**Alternatives considered**:
- `chrome.storage.sync` — rejected per the cross-device inconsistency above, and it carries a
  stricter storage quota than `local` for no benefit here.
- `localStorage` inside the DevTools panel page — rejected: panel pages are not guaranteed stable
  storage partitioning the way `chrome.storage` is, and `chrome.storage` is the project's only
  established persistence mechanism (declared in the manifest from day one), so introducing a
  second storage mechanism for one boolean would be inconsistent for no gain.

## Decision: No automated test added for this feature

**Rationale**: `tests/analysis.test.ts` covers only `src/analysis/*` pure functions by existing,
documented convention (`CLAUDE.md`). This feature is UI + storage wiring with no pure-function
surface to test against fixtures the same way the analysis engine is tested.

**Alternatives considered**: Introducing a DOM-testing framework (e.g. jsdom) — rejected as
disproportionate to a single small feature and a direct violation of Constitution Principle I
(zero-dependency bias); would need to be a separate, explicitly-justified decision, not a side
effect of this feature.
