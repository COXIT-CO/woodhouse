## Purpose

Guarantees that WebSocket, Server-Sent-Events and console activity observed in the inspected page
reliably reaches the Woodhouse panel, and that the WS/SSE tab never contradicts the network log.

## ADDED Requirements

### Requirement: Capture survives service-worker restarts
The system SHALL keep delivering WS/SSE/console events to an open Woodhouse panel after the
extension's background service worker is stopped and restarted by the browser, without the user
reopening DevTools or reloading the page.

#### Scenario: Idle gap longer than the service-worker lifetime
- **WHEN** the panel is open, the page emits no events for longer than the browser's service-worker
  idle timeout, and the page then logs a console message and sends a WebSocket frame
- **THEN** the console message appears in the Console tab and the frame appears on its connection in
  the WS/SSE tab

### Requirement: Events emitted before the panel is open are delivered
The system SHALL retain WS/SSE/console events the page emits while no Woodhouse panel is registered
for that tab, and SHALL deliver them once a panel registers, subject to a fixed upper bound on how
many are retained.

#### Scenario: WebSocket opened before the panel
- **WHEN** a page opens a WebSocket and logs to the console, and the user opens the Woodhouse panel
  afterwards in the same page lifetime
- **THEN** the connection appears in the WS/SSE tab and the console entries appear in the Console tab

#### Scenario: Backlog bound is exceeded
- **WHEN** more events are emitted before the panel opens than the retention bound allows
- **THEN** the oldest excess events are discarded, connection-open events are kept in preference to
  frames and log lines, and the toolbar's "events dropped" counter reflects the discarded count

### Requirement: Network-observed connections are always listed
The system SHALL list in the WS/SSE tab every WebSocket or Server-Sent-Events connection present in
the captured network log, even when no frame-level data for it was observed, and SHALL mark such
entries as having no captured frames.

#### Scenario: Handshake visible only in the network log
- **WHEN** the Requests tab contains a `101` WebSocket handshake (or a `text/event-stream` response)
  for which no frame-level connection was observed
- **THEN** the WS/SSE tab lists that URL with a label indicating frames were not captured, and its
  count badge is non-zero

#### Scenario: No duplicate row when frames were captured
- **WHEN** a connection was observed both in the network log and with frame-level data
- **THEN** the WS/SSE tab shows it once, as the frame-level connection

### Requirement: Accurate WS/SSE empty state
The system SHALL, when the WS/SSE tab has no connections at all, show an empty-state message that
does not claim connections are captured in cases where they are not.

#### Scenario: Empty WS/SSE tab
- **WHEN** no WebSocket or SSE connection has been observed by any means
- **THEN** the empty-state message explains that connections appear once the page opens one, and
  that connections opened inside workers or cross-origin frames are not frame-captured
