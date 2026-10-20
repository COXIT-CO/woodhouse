# Quickstart: Validating the Onboarding Banner

## Prerequisites

- `npm install` (project deps already present)
- `npm run build` — builds the extension into `dist/`
- Chrome/Chromium with the extension loaded unpacked from `dist/` (see README)

## Scenario 1 — first-run banner appears (spec User Story 1)

1. Load the extension in a **fresh Chrome profile** (or after clearing the extension's storage
   via `chrome://extensions` → Woodhouse → "Clear storage", once that's exposed, or via
   `chrome.storage.local.clear()` in the extension's service worker console during manual testing).
2. Open DevTools on any page → switch to the "Woodhouse" panel.
3. **Expected**: a banner appears above the 5 tabs, mentioning all of Requests, WS/SSE, Console,
   Sources, Insights, and stating that analysis is local / nothing leaves the browser.

## Scenario 2 — dismiss persists (spec User Story 2)

1. From Scenario 1's state, click the banner's dismiss control.
2. **Expected**: banner disappears immediately.
3. Close DevTools entirely, reopen it on the same or a different page, switch to the Woodhouse
   panel again.
4. **Expected**: banner does not reappear.

## Scenario 3 — existing empty states unaffected (spec User Story 3)

1. With the banner already dismissed (Scenario 2's end state), open a page with no network
   activity yet and switch to the Requests tab.
2. **Expected**: the existing "No requests captured yet…" message still appears
   (`src/panel/main.ts` line ~207), unrelated to the banner feature.

## Manual verification of the underlying storage key

In the extension's service worker DevTools console (`chrome://extensions` → Woodhouse → "service
worker"):

```js
chrome.storage.local.get("wh_onboarding_dismissed", console.log);
```

Expect `{}` (or `{ wh_onboarding_dismissed: false }`) before dismissal, and
`{ wh_onboarding_dismissed: true }` after.

Refer to [data-model.md](./data-model.md) for the storage key's full lifecycle and
[plan.md](./plan.md) for which files implement each piece.
