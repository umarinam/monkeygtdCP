# SCRIPTS: Run Operations on Tasks

Scripts are templates and bulk operations that run on selected tasks to modify or enhance them. After selecting a task (or multiple tasks), the user can run a script to apply changes.

## 1. Task-template scripts

These create a task, or a hierarchy of tasks, from reusable templates. After selecting a task, run the script to populate subtasks or apply a standard structure.

### Bug template

```text
script: Add Bug Details
run-on: selected-task
create-subtasks:
  - Title: [Bug title] (edit this)
  - Steps to reproduce
  - Expected result
  - Actual result
  - Logs / screenshots
  - Regression risk assessment
  - Test coverage plan

apply:
  tags:
    - bug
    - needs-triage
  priority: high
```

Usage: Select a task, then run `/script add-bug-details` to add the template subtasks and tags.

### Meeting template

```text
script: Structure as Meeting
run-on: selected-task
create-subtasks:
  - Agenda
  - Decisions
  - Action items
  - Follow-up

apply:
  tags:
    - meeting
  due: today
```

### Pull-request review checklist

```text
script: Add PR Review Checklist
run-on: selected-task
create-subtasks:
  - Review implementation
  - Check regression risk
  - Verify unit tests
  - Verify automation coverage
  - Check logging
  - Check security impact
  - Review documentation

apply:
  tags:
    - code-review
    - quality
```

### Parameterised script example

```text
script: Create Release Task
parameters:
  - release (text)
  - owner (assignee)
  - due-date (date)
  - component (text)

task:
  title: "Validate {component} for {release}"
  assigned-to: {owner}
  due: {due-date}
  tags:
    - release
    - "{release}"
    - "{component}"
```

Usage: `script create-release-task release="OPM 2027" owner="Jamie" due-date="2026-08-15" component="routing"`

## 2. Bulk-action scripts

These operate on selected tasks or filtered task lists and apply batch modifications. Before execution, show a preview.

Examples:

* Add a tag to all selected tasks
* Remove an obsolete tag from multiple tasks
* Assign selected tasks to a person
* Move due dates by three days
* Mark all selected tasks as reviewed
* Archive completed tasks older than 30 days
* Increase priority for overdue tasks
* Move tasks under a different parent
* Convert selected tasks into subtasks
* Add a standard comment to each
* Prefix task titles with a release name
* Replace one assignee with another
* Add `stale` tag to tasks not updated recently
* Remove due dates from completed tasks

Example:

```text
script: Escalate Overdue
run-on: selected-tasks

actions:
  add-tag: escalated
  set-priority: high
  add-comment: "Automatically escalated because the task is overdue."
```

When run, display a preview:

```text
This script will update 17 selected tasks:
- Add tag "escalated"
- Set priority to high
- Add comment: "Automatically escalated because the task is overdue."

[Run] [Cancel]
```

## 3. Context-sensitive scripts

These scripts adapt their behavior based on the current context (task, selection, page).

Examples:

* Run on current task: create a standard set of subtasks (Definition of Done)
* Run on selected task: show a template to populate
* Run on selected tasks: batch assign, batch tag, batch reschedule
* Run from macro results: apply actions to all tasks in the filtered view
* Run on a completed task: create a follow-up task for next month
* Run on a recurring task: mark the current occurrence done and create the next one

Example:

```text
script: Add Definition of Done
run-on: current-task
create-subtasks:
  - Implementation complete
  - Unit tests added
  - Regression testing complete
  - Documentation updated
  - Code reviewed

apply:
  tags:
    - definition-of-done-pending
```

Another example (context-aware):

```text
script: Quick Follow Up
run-on: current-task

if task.status == done:
  create-task:
    title: "Follow up: {task.title}"
    due: 7-days-from-now
    assigned-to: $current-user
    tags: [follow-up]

else if task.status == open:
  add-comment: "Creating follow-up task when this is complete"
```

---

# SHARED CONCEPTS

These features apply to scripts and can be combined with any script type.

## Date-aware expressions

Date expressions make scripts especially powerful and flexible.

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

Practical examples in scripts:

* Script: Create follow-ups seven days after completion
* Script: Set task due date to end-of-week
* Script: Find tasks not updated in 30 days and tag them stale
* Script: Move overdue tasks to next Monday

## Relative and reusable variables

Variables make scripts context-aware and reusable.

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

Example in a script:

```text
script: Create Follow Up
run-on: current-task

create-task:
  title: "Follow up: {$current-task.title}"
  due: 7-days-from-now
  assigned-to: $current-user
  tags:
    - follow-up
    - "{$current-task.tags}"
```

## Parameterised scripts

Scripts become much more reusable when they accept parameters and prompt the user for input.

Example:

```text
script: Create Release Task
parameters:
  - release (text, required)
  - owner (assignee, required)
  - due-date (date, required)
  - component (text, required)

run-on: selected-task

create-subtask:
  title: "Validate {component} for {release}"
  assigned-to: {owner}
  due: {due-date}
  tags:
    - release
    - "{release}"
    - "{component}"
```

## Conditional logic in scripts

Conditions make scripts powerful without requiring full programming.

Example:

```text
script: Auto Triage Bug
run-on: selected-task

if status == open:
  if priority == none:
    set-priority: medium
    add-tag: needs-prioritization
  
  if assigned-to == none:
    add-tag: needs-owner
  
  if due == none:
    add-tag: needs-scheduling
```

---

# IMPLEMENTATION NOTES

## Script Architecture

Scripts should be stored as `.script` files in a `.scripts/` folder at the workspace root. Scripts are invoked from the context menu or command palette after selecting task(s).

Example file structure:
```
.scripts/
  add-bug-details.script
  add-definition-of-done.script
  structure-as-meeting.script
  escalate-overdue.script
  auto-triage-bug.script
```

Each script file contains a definition of parameters, context, actions, and conditions.

## Script UI/UX

- **Invocation**: Scripts accessible from right-click context menu on selected task(s)
- **Previews**: For bulk scripts, show a confirmation preview before execution
- **Feedback**: Show success/error messages after script execution
- **History**: Log script executions in task history or activity feed
- **Parameters**: For scripts with parameters, show a small form/dialog when invoked
- **Defaults**: Save parameter values as defaults for repeated use
