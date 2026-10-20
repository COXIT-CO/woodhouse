## Purpose

Keeps the user's place in the panel's scrollable lists and detail views while the panel updates, so
selecting items and watching live traffic never throws the view back to the top.

## ADDED Requirements

### Requirement: List scroll position is preserved on selection
The system SHALL keep the scroll position of a tab's item list unchanged when the user selects an
item in that list.

#### Scenario: Selecting a request far down the list
- **WHEN** the user scrolls the Requests list down and clicks a request row that is not the first row
- **THEN** the list stays at the same scroll position, the clicked row is highlighted, and its details
  open in the detail pane

#### Scenario: Selecting a connection in the WS/SSE tab
- **WHEN** the user scrolls the WS/SSE connection list down and clicks a connection
- **THEN** the list stays at the same scroll position

### Requirement: Scroll position is preserved across live updates
The system SHALL keep the scroll position of both the item list and the detail pane unchanged when
new captured data causes the panel to update while the user remains on the same tab and selection.

#### Scenario: New requests arrive while reading details
- **WHEN** the user has scrolled the Requests list and the detail pane of a selected request, and new
  requests are captured
- **THEN** neither the list nor the detail pane jumps to the top

### Requirement: Detail pane starts at the top for a new selection
The system SHALL show the detail pane scrolled to the top when the user selects a different item
than the one currently shown.

#### Scenario: Switching to another request
- **WHEN** the user has scrolled the detail pane of one request and then clicks a different request
- **THEN** the detail pane shows the new request's details from the top

### Requirement: Per-tab scroll position
The system SHALL restore each tab's list scroll position when the user switches back to that tab
within the same panel session.

#### Scenario: Returning to the Requests tab
- **WHEN** the user scrolls the Requests list, switches to the Console tab, and switches back
- **THEN** the Requests list is at the position the user left it
