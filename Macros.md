# MACROS: Create New View Pages

Macros generate live filtered/organized task lists. Each macro is like creating a new page (similar to Due Page or Report Page) that displays queried tasks without modifying them.

## 1. Dynamic view macros

These generate a live list of tasks matching filters and sort rules.

Examples:

* Tasks due today assigned to Umar, excluding ignored items
* Overdue tasks not marked complete
* Tasks due in the next seven days grouped by assignee
* High-priority tasks with no due date
* Tasks tagged `release` but not tagged `tested`
* Tasks assigned to me that have not been updated in seven days
* Unassigned tasks under a particular parent
* Tasks blocked by incomplete dependencies
* Tasks containing unchecked sub-items
* Tasks created this week
* Tasks completed this month
* Tasks with attachments
* Tasks with comments mentioning me
* Tasks matching multiple tag groups:

  * tagged `bug` or `security` or (`option1` and `option2`)
  * and tagged `release-2026`
  * but not tagged `deferred`

Example:

```text
macro: My Today
filter:
  due: today
  assigned-to: Umar
  exclude-tag: ignore
  status: open
sort:
  priority desc
  due-time asc
```

When saved, this macro creates a new page in the sidebar that displays matching tasks in real time.

## 2. Workflow macros (View-focused)

These combine filtering, grouping, and navigation to display structured task views.

### Daily planning

```text
macro: Start My Day
type: view

sections:
  - title: "Overdue (assigned to me)"
    filter:
      status: open
      due: before today
      assigned-to: $current-user
    
  - title: "Due today"
    filter:
      status: open
      due: today
    sort: priority desc
    
  - title: "High priority, no due date"
    filter:
      status: open
      priority: high
      due: none
    sort: created desc
```

### Weekly review

```text
macro: Weekly Review
type: view

sections:
  - title: "Completed this week"
    filter:
      status: done
      completed: this-week
  
  - title: "Overdue"
    filter:
      status: open
      due: before today
  
  - title: "Due next week"
    filter:
      status: open
      due: next-week
  
  - title: "Waiting for others"
    filter:
      tag: waiting
      status: open
  
  - title: "Tasks with no owner"
    filter:
      assigned-to: none
      status: open
  
  - title: "Not updated in 14 days"
    filter:
      updated: before 14-days-ago
      status: open
```

### Release readiness

```text
macro: Release Readiness
type: view

filter:
  tag: release-2027

sections:
  - title: "Needs work"
    filter:
      status: open
  
  - title: "Testing incomplete"
    filter:
      tag: testing-incomplete
  
  - title: "Documentation missing"
    filter:
      tag: doc-missing
  
  - title: "Security review pending"
    filter:
      tag: security-pending
```

## 3. Reporting macros

These produce summaries and dashboards rather than just task lists.

Examples:

* Number of completed tasks by assignee
* Overdue tasks by project
* Tasks completed this week versus created this week
* Release tasks by status
* Workload by assignee
* Tasks without estimates
* Average task age
* Tags with the highest number of open tasks

Example output:

```text
Weekly Summary

Completed: 23
Created: 18
Overdue: 7
Blocked: 4

By owner:
Umar: 8 open
Jamie: 11 open
Conor: 6 open
```

---

# SHARED CONCEPTS

These features apply to macros and can be combined with any macro type.

## Date-aware expressions

Date expressions make macros especially powerful and flexible.

Examples:

```text
due: today
due: tomorrow
due: next-monday
due: end-of-week
due: 3-business-days-from-now
due: first-working-day-next-month
due: 2-days-before-parent
due: same-day-next-week
due: 7-days-from-now
due: before today
due: this-week
due: next-week
```

Practical examples in macros:

* Macro: Move unfinished Friday tasks to Monday
* Macro: Create a monthly review on the first working day
* Macro: Find tasks due during the current sprint
* Macro: Find tasks completed in the previous calendar month

## Relative and reusable variables

Variables make macros context-aware and reusable.

Useful variables:

```text
$current-user          — logged-in user name
$today                 — today's date
$tomorrow              — tomorrow's date
$current-list          — current list being viewed
$current-task          — currently selected task
$selected-tasks        — all currently selected tasks
$parent-task           — parent of the current task
$current-week          — start and end of current week
$clipboard             — clipboard content
```

Example in a macro:

```text
macro: My Assigned Tasks
filter:
  assigned-to: $current-user
  status: open
sort:
  due asc
```

## Parameterised macros

Macros become much more reusable when they accept parameters and prompt the user for input.

Example:

```text
macro: Release Burndown
parameters:
  - release (text, required)
  - start-date (date, required)
  - end-date (date, optional)

filter:
  tag: "{release}"
  created: between {start-date} and {end-date}

sections:
  - title: "Open tasks"
    filter: status: open
  
  - title: "Completed"
    filter: status: done
```

Usage: `macro release-burndown release="OPM 2027" start-date="2026-08-01" end-date="2026-08-31"`

## Conditional logic in macros

Conditions make macros powerful without requiring full programming.

Example:

```text
macro: Triage By Status

sections:
  - title: "Open (no priority)"
    filter:
      status: open
      priority: none
    marker: "Needs prioritization"
  
  - title: "Open (high priority, no assignee)"
    filter:
      status: open
      priority: high
      assigned-to: none
    marker: "Needs owner"
  
  - title: "Open (overdue)"
    filter:
      status: open
      due: before-today
    marker: "URGENT"
```

---

# IMPLEMENTATION NOTES

## Macro Architecture

Macros should be stored as `.macro` files in a `.macros/` folder at the workspace root. Each macro is similar to a saved query that creates a new page in the sidebar.

Example file structure:
```
.macros/
  my-today.macro
  weekly-review.macro
  release-readiness.macro
  backlog-by-owner.macro
```

Each macro file contains YAML/structured definition that the app parses and renders as a dynamic page.

## Pages and Macros

- **One Macro = One Page**: Each macro file creates one page in the sidebar
- **Multi-Section Pages**: A single macro can have multiple sections (as in the Weekly Review example above), displaying different filtered views on one page
- **Combining Macros**: A page cannot directly combine multiple macro definitions, but users can create a new macro with multiple sections to achieve that effect

Example: If a user wants a page showing both "My Tasks" and "Team Tasks", they would create one macro file with two sections:

```text
macro: My Dashboard
type: view

sections:
  - title: "My Tasks"
    filter:
      assigned-to: $current-user
      status: open
    sort: due asc
  
  - title: "Team Tasks"
    filter:
      tag: team-project
      status: open
    sort: priority desc
```

## How Users Add a New Page

Users can add a new page/macro by:

1. **Via Settings UI**: 
   - Open Settings
   - Navigate to "Macros" section
   - Click "Create New Macro"
   - Fill in macro name, filter rules, sections
   - Save → macro file created in `.macros/` folder
   - New page appears in sidebar

2. **Manually (Advanced)**:
   - Create a new `.macro` file in the `.macros/` folder
   - Write YAML/macro definition (see examples above)
   - Save file
   - App detects new macro and creates sidebar page
   - No app restart needed

3. **Import**:
   - Users can share macro files via git or copy-paste
   - Drop `.macro` file into `.macros/` folder
   - New page appears immediately

## Example Workflow: User Creates "Blocked Tasks" Page

User opens Settings → Macros → Create New Macro:

```yaml
Name: Blocked Tasks
Type: View

Sections:
  - Title: Waiting for others
    Filter: tag:blocked status:open
    Sort: due asc
  
  - Title: Blocked by dependencies
    Filter: has:blocking-task status:open
    Sort: created desc
```

Result: New "Blocked Tasks" page appears in sidebar, showing tasks tagged "blocked" and tasks with unresolved dependencies, real-time updated.

## Macro UI/UX

- **Sidebar Integration**: Macros appear as new tabs/pages in the sidebar, similar to "Due" and "Report" pages
- **Real-time Updates**: Each macro page refreshes in real time as tasks are modified
- **Management**: Users can create, edit, delete, and reorder macros from settings
- **Sharing**: Macro definitions can be checked into git for team use
- **Discoverability**: Users browse example macros in settings or docs
