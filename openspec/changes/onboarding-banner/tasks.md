## 1. Storage helpers

- [ ] 1.1 Create `src/panel/onboarding.ts` with `getOnboardingDismissed(): Promise<boolean>` and
      `setOnboardingDismissed(): Promise<void>` wrapping `chrome.storage.local` reads/writes of the
      `wh_onboarding_dismissed` key; verify by calling both from the DevTools console against a
      built extension and confirming the key round-trips.

## 2. Banner rendering

- [ ] 2.1 Implement `renderOnboardingBanner(): HTMLElement` in `src/panel/onboarding.ts` using the
      existing `h()` helper (`src/panel/dom.ts`), with copy covering all 5 tabs (Requests, WS/SSE,
      Console, Sources, Insights) and the local-only statement; verify by rendering the panel with
      dismissal cleared and visually confirming the banner text mentions all 5 tabs.
- [ ] 2.2 Add `.onboarding-banner` styles in `src/styles.css` matching the existing `.empty` visual
      language; verify visually that the banner is legible and doesn't overlap the tab bar.

## 3. Wiring and dismissal

- [ ] 3.1 In `src/panel/main.ts`, call `getOnboardingDismissed()` before the first `render()` and,
      if falsy, mount `renderOnboardingBanner()` above the tab bar; verify by loading the panel on
      a fresh profile and confirming the banner appears before any other interaction.
- [ ] 3.2 Add a dismiss control to `renderOnboardingBanner()` that calls
      `setOnboardingDismissed()` and removes the banner element from the live DOM; verify by
      dismissing the banner, then reopening the panel and confirming it does not reappear.

## 4. Regression check and polish

- [ ] 4.1 Manually verify each of the 4 existing per-tab empty-state messages in
      `src/panel/main.ts` (Requests, WS/SSE, Console, Sources) still renders correctly with the
      banner feature present and dismissed; no code change expected unless a regression is found.
- [ ] 4.2 Run `npm run typecheck` and `npm run build`; verify both succeed with no new errors.
- [ ] 4.3 Update `README.md`'s feature list to mention the first-run onboarding banner; verify by
      re-reading the rendered list for accuracy.
