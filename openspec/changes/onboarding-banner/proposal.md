## Why

First-time users open the Woodhouse panel and see five unfamiliar tabs with no explanation of
what the tool does or whether it's safe to point at sensitive traffic. For a privacy-focused tool,
that first impression matters: users should know immediately that everything stays local before
they start capturing anything.

## What Changes

- Add a dismissible banner shown above the tab bar the first time the panel is opened, explaining
  the 5 tabs (Requests, WS/SSE, Console, Sources, Insights) and stating that all analysis is local.
- Persist the dismissal via `chrome.storage.local` so the banner never reappears for that install
  once dismissed.
- No changes to any existing tab's behavior or empty-state messaging.

## Capabilities

### New Capabilities
- `onboarding-banner`: first-run panel banner explaining the tool's tabs and local-only privacy
  guarantee, with a persistent dismiss control.

### Modified Capabilities
(none — this is purely additive; no existing spec-level behavior changes)

## Impact

- **Affected code**: `src/panel/main.ts` (mount point above the tab bar), a new
  `src/panel/onboarding.ts` module, `src/styles.css` (banner styling).
- **Affected APIs**: first real use of the already-granted `chrome.storage.local` permission
  (currently declared in the manifest but unused anywhere in `src/`).
- **Dependencies**: none added.
- **No network egress, no new Chrome permission.**
