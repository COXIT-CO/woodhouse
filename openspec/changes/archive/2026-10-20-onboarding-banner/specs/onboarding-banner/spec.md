## Purpose

Gives first-time users of the Woodhouse DevTools panel a one-time explanation of what its 5 tabs
do and a statement that all analysis happens locally, with a persistent way to dismiss it.

## ADDED Requirements

### Requirement: First-run banner display
The system SHALL show a banner above the tab bar the first time the Woodhouse panel is opened for
an install, explaining the purpose of each of the 5 tabs (Requests, WS/SSE, Console, Sources,
Insights) and stating that all analysis is local and no data leaves the browser.

#### Scenario: Fresh install, first panel open
- **WHEN** a user opens the Woodhouse DevTools panel for the first time on a given install
- **THEN** a banner appears above the tab bar naming all 5 tabs and stating that analysis is local

#### Scenario: Banner does not block interaction
- **WHEN** the banner is visible
- **THEN** the tab bar and toolbar controls remain fully visible and usable

### Requirement: Persistent dismissal
The system SHALL let the user dismiss the banner via a visible control, and SHALL NOT show the
banner again for that install once dismissed, across panel reopens and browser restarts.

#### Scenario: User dismisses the banner
- **WHEN** the user activates the banner's dismiss control
- **THEN** the banner disappears immediately from the current panel view

#### Scenario: Dismissal persists across sessions
- **WHEN** the user has previously dismissed the banner and reopens the Woodhouse panel (new tab
  or new DevTools session)
- **THEN** the banner does not reappear

### Requirement: No regression to existing empty states
The system SHALL continue to show each tab's existing empty-state message (e.g. "No requests
captured yet…") independently of the onboarding banner's presence or dismissal state.

#### Scenario: Empty tab after banner is dismissed
- **WHEN** the banner has been dismissed and the user switches to a tab with no captured data
- **THEN** that tab's existing empty-state message still appears exactly as before this feature
