# Feature Specification: Fix WS/SSE & Console Capture and List Scroll Reset

**Feature Branch**: `speckit/second-task-spec`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "Fix two Woodhouse panel bugs. (1) The WS/SSE tab and the Console tab stay at 0 while the Requests tab shows `101 websocket` handshakes (observed on dev.archiscan.ai, NATS over wss://) and Chrome itself reports console warnings/errors. WebSocket/SSE/console activity from the page must reliably reach the panel, including after the browser stops/restarts the extension's background worker and for activity that happened before the panel was opened; connections visible in the network log must always appear in the WS/SSE tab (marked as frames not captured when frame data is unavailable); the WS/SSE empty-state text must be accurate. (2) Clicking a row in the Requests list scrolls the list back to the top; list and detail panes must keep their scroll position across selection and live updates, the detail pane starts at the top only for a different selection, and each tab remembers its scroll position when switching tabs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live socket and console activity always reaches the panel (Priority: P1)

A developer opens the Woodhouse panel on an app that talks over a WebSocket and logs to the
console. Whether they opened the panel before or after the page connected, and however long the
panel sits idle, the WS/SSE tab shows the connection with its messages and the Console tab shows
the page's log output.

**Why this priority**: This is the reported bug. Two of the panel's five tabs currently show
nothing on real apps, which defeats the tool's purpose (live traffic analysis) and makes the
Insights tab's console/request correlation useless.

**Independent Test**: On a page that opens a WebSocket and logs to the console, open the panel,
leave it idle for at least one minute, then trigger socket messages and log lines. Both tabs must
populate without reloading the page or reopening DevTools.

**Acceptance Scenarios**:

1. **Given** the panel is open and the page has been quiet for over a minute, **When** the page
   sends a WebSocket message and logs a warning, **Then** the message appears on its connection in
   the WS/SSE tab and the warning appears in the Console tab.
2. **Given** a page that already opened a WebSocket and logged several lines, **When** the user
   opens the Woodhouse panel afterwards (same page load), **Then** the connection and those log
   lines appear.
3. **Given** the page produced far more activity before the panel opened than can be kept, **When**
   the panel opens, **Then** the most recent activity is shown, every connection that was opened is
   still listed, and the toolbar shows how many events were dropped.

---

### User Story 2 - Keep my place in the list while inspecting (Priority: P2)

A developer scrolls down the Requests list and clicks a request to see its details. The list stays
exactly where it was, the clicked row is highlighted, and new traffic arriving in the background
doesn't throw the list or the detail view back to the top.

**Why this priority**: The second reported bug. It doesn't hide data, but it makes inspecting
anything below the first screen of rows nearly impossible, so it blocks the main drill-down
workflow.

**Independent Test**: With 50+ requests captured, scroll the Requests list to the middle and click
a row; then let more requests arrive. The list position and the detail pane position both hold.

**Acceptance Scenarios**:

1. **Given** the Requests list is scrolled down, **When** the user clicks a row that isn't the first,
   **Then** the list doesn't move, that row is highlighted, and its details open.
2. **Given** the user has scrolled both the list and a request's detail pane, **When** new requests
   are captured, **Then** neither pane jumps.
3. **Given** the detail pane of one request is scrolled down, **When** the user clicks a different
   request, **Then** the detail pane shows the new request from the top.
4. **Given** the Requests list is scrolled down, **When** the user switches to the Console tab and
   back, **Then** the Requests list is where they left it.
5. **Given** the WS/SSE list is scrolled down, **When** the user clicks a connection, **Then** that
   list doesn't move either.

---

### User Story 3 - WS/SSE tab never contradicts the network log (Priority: P3)

Even when message-level data for a connection couldn't be captured, a developer who sees a
`101 websocket` row in the Requests tab also sees that connection listed in the WS/SSE tab,
clearly labeled as having no captured messages, with a short explanation. When there truly are no
connections, the empty message tells the truth about what is and isn't captured.

**Why this priority**: A safety net. With User Story 1 in place most connections get full message
data, but some (connections inside background workers or embedded third-party frames, or opened
before Woodhouse could observe the page) never will. Showing them prevents the "0 while Requests
shows them" contradiction from ever recurring.

**Independent Test**: On a page whose socket handshake appears in Requests but whose messages
aren't captured, the WS/SSE tab badge is non-zero and the connection is listed once with a
"messages not captured" label.

**Acceptance Scenarios**:

1. **Given** the Requests tab shows a WebSocket handshake or an event-stream response with no
   message-level data captured for it, **When** the user opens the WS/SSE tab, **Then** that URL is
   listed with a "messages not captured" label and the tab's count includes it.
2. **Given** a connection was captured both in the network log and with full message data, **When**
   the user opens the WS/SSE tab, **Then** it is listed exactly once, with its messages.
3. **Given** no connection has been observed in any way, **When** the user opens the WS/SSE tab,
   **Then** the empty message says connections appear once the page opens one, and that
   connections inside workers or embedded third-party frames aren't message-captured.

---

### Edge Cases

- The extension is reloaded or updated while the panel is open: the panel stops receiving events
  (it belongs to the old extension instance). It must not loop or freeze. Reopening DevTools
  restores capture.
- Many browser tabs are open without the panel: tabs that never get a panel must not cause
  ongoing background activity just because they buffered events.
- A page connects via a relative URL (e.g. `/ws`): it must still be recognized as the same
  connection as its network-log handshake, so it isn't listed twice.
- The Requests list exceeds its visible-row limit and old rows drop off the top as new ones arrive:
  the list may drift by the height of the removed rows. That's acceptable, but it must never snap
  to the top.
- "Preserve log" is off and the page navigates: lists clear as today; scroll positions reset with
  them.
- The selected request is cleared (the "Clear" button): the detail pane closes, and the list's
  scroll resets, since the list is now empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The panel MUST keep receiving WebSocket, SSE and console activity from the inspected
  page after the extension's background process is stopped and restarted by the browser, with no
  user action.
- **FR-002**: Activity the page produces while no Woodhouse panel is open for that tab MUST be
  retained, up to a fixed limit, and shown once the panel opens during the same page load.
- **FR-003**: When the retention limit is exceeded, the oldest messages and log lines MUST be
  discarded first. Connection-opened records MUST be kept in preference to messages, and the number
  discarded MUST appear in the existing "events dropped" indicator.
- **FR-004**: Tabs with no Woodhouse panel open MUST NOT cause repeated background activity while
  holding retained events.
- **FR-005**: The WS/SSE tab MUST list every WebSocket or SSE connection present in the captured
  network log, labeled "messages not captured" when no message-level data exists for it, and its
  tab count and the toolbar connection count MUST include such entries.
- **FR-006**: A connection present both in the network log and with message-level data MUST be
  listed only once.
- **FR-007**: The WS/SSE empty-state message MUST accurately describe when connections appear and
  which kinds aren't message-captured (workers, embedded third-party frames).
- **FR-008**: Selecting an item in any tab's list MUST NOT change that list's scroll position.
- **FR-009**: Live updates MUST NOT change the scroll position of the list or the detail pane while
  the user stays on the same tab and selection.
- **FR-010**: Selecting a different item MUST show its detail pane from the top.
- **FR-011**: Each tab MUST restore its list scroll position when the user returns to it within the
  same panel session.
- **FR-012**: The fix MUST NOT add browser permissions, dependencies, or any network
  communication. All capture stays local.

### Key Entities

- **Retained event backlog**: per inspected page, the socket/SSE/console activity held while no
  panel is listening. It has a size limit, a priority rule (connection-opened records first) and a
  dropped count.
- **Network-only connection**: a WebSocket/SSE connection known only from the network log. It has
  a URL, a kind (WS/SSE) and a timestamp, and no messages. It is derived from captured requests, not
  stored separately.
- **Per-tab view position**: for each of the 5 tabs, the list's scroll offset. For the detail pane,
  the scroll offset plus which item it belongs to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the originally reported app (NATS over WebSocket), the WS/SSE and Console tab
  counts are non-zero within 2 seconds of page activity, both when the panel was opened before the
  page loaded and when it was opened after.
- **SC-002**: After 5 minutes of panel idle time, 100% of new socket messages and log lines
  triggered by the user appear in the panel.
- **SC-003**: The WS/SSE count is never 0 while the Requests tab contains a WebSocket handshake
  (0 occurrences across the manual test scenarios).
- **SC-004**: With 100+ captured requests, clicking any of 10 rows spread across the list causes 0
  scroll jumps. Over 1 minute of live traffic while reading a request's details, the panes jump 0
  times.
- **SC-005**: Zero change in the extension's declared permissions and dependency list.

## Assumptions

- Root causes are identified by code reading (the background process forgets the open panel when
  the browser stops it, and the panel never re-registers; the full redraw recreates every scrollable
  pane). They still need confirmation in the browser before implementation starts.
- Capturing messages from sockets created inside background workers or cross-origin embedded
  frames is out of scope. Those appear only as network-only entries (User Story 3).
- Messages of a connection opened before Woodhouse's page hook ran can't be recovered. Only its
  network-log entry is shown.
- The retention limit reuses the panel's existing order of magnitude for event caps (a few thousand
  events), not a new user setting.
- Scroll positions are kept in memory for the panel session only. Reopening DevTools starts at the
  top.
- English-only UI copy, as everywhere else in the panel.
