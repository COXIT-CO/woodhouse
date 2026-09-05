## Context

See proposal.md - Why. Relevant constraints: no framework (`src/panel/dom.ts`'s `h()` helper is
the only UI primitive), zero new dependencies, and the `storage` manifest permission is already
granted but currently unused anywhere in `src/` (confirmed via `grep -rn "chrome.storage" src/`).

## Goals / Non-Goals

**Goals:**
- Decide where the dismissal flag lives and how the panel reads it before first render.
- Decide how the banner module fits the existing one-file-per-concern panel layout.

**Non-Goals:**
- No new automated test — this feature has no pure-function surface for
  `tests/analysis.test.ts`'s existing scope; validated manually instead.
- No localization, no analytics/tracking of banner shown/dismissed state.

## Decisions

**Storage: `chrome.storage.local`, key `wh_onboarding_dismissed` (boolean).**
Alternatives considered: `chrome.storage.sync` — rejected, since syncing a first-run flag across
devices could suppress the explanation on a device where the user never actually saw it.
`localStorage` in the panel page — rejected, since `chrome.storage` is the project's only
established persistence mechanism and introducing a second one for a single boolean isn't
justified.

**Module: new `src/panel/onboarding.ts`, not inline in `main.ts`.**
Matches the existing one-file-per-concern layout (`state.ts`, `capture.ts`, `dom.ts`, `main.ts`
each own one concern). Exports `getOnboardingDismissed()`, `setOnboardingDismissed()`, and
`renderOnboardingBanner()`; `main.ts` only calls these, it doesn't own the logic.

**Mounting: read-before-first-render, not reactive re-render.**
`main.ts` checks dismissal state once before its first `render()` call and conditionally includes
the banner in that initial output, rather than making banner visibility part of the reactive store
(`state.ts`) that re-renders on every `notify()`. The banner's own state never changes after mount
except via direct DOM removal on dismiss — it doesn't need to participate in the store's
rAF-throttled re-render cycle.

## Risks / Trade-offs

- [Storage read is asynchronous, so the very first paint could race ahead of the dismissal check]
  → Mitigation: await the `chrome.storage.local.get` before the first `render()` call rather than
  rendering optimistically then correcting; panel init is already async-tolerant (existing capture
  setup does the same).
- [A second DevTools window opened before dismissal in another window won't reflect a dismissal
  that happens elsewhere until its own next open] → Accepted per spec's documented edge case; not
  worth a `chrome.storage.onChanged` listener for a one-time banner.

## Migration Plan

Not applicable — purely additive, no existing behavior changes, no data migration.
