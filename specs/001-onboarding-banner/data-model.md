# Phase 1 Data Model: Onboarding Banner

This feature introduces one small piece of persisted state; there is no data model in the sense
of `src/shared/types.ts` entities, since the state never crosses a message boundary between the
page/content-script/service-worker/panel contexts (see `plan.md`'s Project Structure).

## Onboarding dismissal state

| Field | Type | Location | Notes |
|---|---|---|---|
| `wh_onboarding_dismissed` | `boolean` | `chrome.storage.local` | Absent/`false` = banner shows on next panel open; `true` = banner permanently suppressed for this install. |

**Validation rules**: none beyond the boolean type itself — this is a single flag with no
relationships, no state transitions beyond `false → true` (one-way; there is no in-product way to
"undo" a dismissal, matching FR-005's "MUST NOT show again" requirement).

**Lifecycle**:
1. Panel bootstrap reads the key via `chrome.storage.local.get("wh_onboarding_dismissed")` before
   the first `render()` call.
2. If falsy, the banner renders as part of `render()`'s output.
3. The banner's dismiss control writes `{ wh_onboarding_dismissed: true }` via
   `chrome.storage.local.set` and removes the banner element from the live DOM (no full re-render
   required).

No other entity is introduced by this feature.
