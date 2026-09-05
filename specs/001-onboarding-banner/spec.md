# Feature Specification: Onboarding Banner

**Feature Branch**: `001-onboarding-banner`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Add a first-run onboarding banner to the Woodhouse DevTools panel. It should explain the 5 tabs (Requests, WS/SSE, Console, Sources, Insights) and state that all analysis is local — nothing leaves the browser. Show it once per install, with a dismiss control that persists the dismissal."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-time orientation (Priority: P1)

A developer installs Woodhouse and opens the DevTools panel for the first time, seeing five
unfamiliar tabs with no explanation of what the tool does or whether it's safe to use on
sensitive traffic.

**Why this priority**: Without orientation, a first-time user doesn't know what the tabs do or
whether their data is safe — this is the single biggest first-impression risk for a privacy tool.

**Independent Test**: Open the Woodhouse panel for the first time on a fresh browser profile;
verify a banner appears above the tabs explaining what they do, before any dismissal action.

**Acceptance Scenarios**:

1. **Given** a fresh install where the panel has never been opened, **When** the user opens the
   Woodhouse DevTools panel, **Then** a banner appears above the tabs explaining the 5 tabs and
   stating that all analysis is local.
2. **Given** the banner is visible, **When** the user reads it, **Then** all 5 tab names
   (Requests, WS/SSE, Console, Sources, Insights) are referenced in plain language.

---

### User Story 2 - Dismiss and stay dismissed (Priority: P2)

A user who already understands the tool wants to get rid of the banner and not see it again.

**Why this priority**: Forcing a returning user to see the same orientation message every time
they open DevTools is an ongoing annoyance, not a one-time cost.

**Independent Test**: Dismiss the banner, then reopen the panel (new tab or new DevTools session)
and confirm it does not reappear.

**Acceptance Scenarios**:

1. **Given** the banner is visible, **When** the user activates the dismiss control, **Then** the
   banner disappears immediately.
2. **Given** the user has previously dismissed the banner, **When** they reopen the panel (new
   tab, or after closing and reopening DevTools), **Then** the banner does not reappear.

---

### User Story 3 - No regression to existing empty states (Priority: P3)

A user with the banner already dismissed still needs the existing per-tab "no data yet" messages
to work as before.

**Why this priority**: Lowest priority because it's a non-regression guarantee, not new value —
but a failure here would break existing, already-shipped behavior.

**Independent Test**: With the banner dismissed, open any tab with no captured data yet and
confirm its existing empty-state message still appears, unaffected by the banner feature.

**Acceptance Scenarios**:

1. **Given** the banner has been dismissed, **When** the user switches to a tab with no captured
   data, **Then** that tab's existing empty-state message still appears exactly as before.

---

### Edge Cases

- What happens if the user has the panel open in more than one DevTools window before dismissing
  in either? (Dismissal is per-install, not per-window — dismissing in one window should prevent
  the banner from appearing in future sessions, but a window already showing it before dismissal
  is not required to update live.)
- How does the system handle a user who clears extension storage or reinstalls the extension?
  (Dismissal state is lost along with all other extension storage, so the banner reappears — this
  is consistent with how a fresh install should behave.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST show an onboarding banner above the tab bar the first time the
  Woodhouse panel is opened after install.
- **FR-002**: The banner MUST explain, in plain language, what each of the 5 tabs (Requests,
  WS/SSE, Console, Sources, Insights) is for.
- **FR-003**: The banner MUST state that all analysis happens locally and no data ever leaves the
  browser.
- **FR-004**: Users MUST be able to dismiss the banner via a visible, clearly-labeled control.
- **FR-005**: Once dismissed, the system MUST NOT show the banner again for that install, across
  panel reopens and browser restarts.
- **FR-006**: Existing per-tab empty-state messages MUST continue to appear independently of the
  banner's presence or dismissal state.
- **FR-007**: The banner MUST NOT block or obscure access to the tab bar or toolbar controls.

### Key Entities

- **Onboarding dismissal state**: a single yes/no record of whether this install's user has
  dismissed the banner, persisted across browser sessions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can state, without leaving the panel or consulting external docs,
  what each of the 5 tabs is for and whether their data leaves the browser.
- **SC-002**: Once dismissed, the banner does not reappear in any subsequent panel open for that
  install.
- **SC-003**: The banner adds no perceptible delay to the panel's initial render.

## Assumptions

- "Per install" means per browser profile (extension storage is profile-scoped), not per-machine
  or per-Chrome-window.
- English-only text, matching all other existing UI copy — no localization requirement.
- No usage analytics or tracking of whether/when the banner is shown or dismissed — that would
  conflict with the project's local-only, no-telemetry principle.
- Visual style reuses the existing empty-state visual language already present in the panel,
  rather than introducing a new UI pattern.
