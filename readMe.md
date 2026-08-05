Write a single HTML file using localStorage and JavaScript as a full-featured task manager and outliner app modelled after Checkvist (https://checkvist.com).

> **Scope note:** This document describes MonkeyGTD's actual behavior as implemented in `js/**` — not a wishlist. Checkvist (the app this one is modelled after) has a much larger feature set — multi-user sharing/collaboration, paid subscription tiers, file attachments, calendar sync, bookmarks, print preview, and more — that MonkeyGTD does **not** implement; those sections have been removed here rather than left in as unimplemented aspirational text. For genuinely forward-looking, not-yet-built proposals, see [Macros.md](Macros.md) and [Scripts.md](Scripts.md), which are explicitly marked as design docs.

## GitHub Pages Hosting

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml` that publishes `monkeygtd-standalone.html` as the site `index.html` on pushes to `master`.

![Deploy GitHub Pages](https://github.com/umarinam/monkeygtdCP/actions/workflows/pages.yml/badge.svg)

Live URL: https://umarinam.github.io/monkeygtdCP/

One-time setup in GitHub repository settings:
1. Open Settings > Pages.
2. Under Build and deployment, set Source to GitHub Actions.

After that, every push to `master` deploys the latest standalone app.

## CLI Task Capture via Gist Queue

If you already have Gist sync configured in the app, you can enqueue a child task from command line by parent task id.

One-time environment setup (Windows cmd):

```bat
set MGTD_GIST_ID=your_gist_id
set MGTD_GIST_TOKEN=your_github_token
```

Quick command (from repo root):

```bat
scripts\send-task.cmd PARENT_TASK_ID Your new child task text
```

PowerShell equivalent:

```powershell
./scripts/send-task.ps1 PARENT_TASK_ID Your new child task text
```

Then click "Sync now" in the app (or wait for auto-sync) to apply queued tasks. See `Inbox.html` for a mobile-friendly capture form that queues into the same mechanism.


---

## Core Architecture

The app manages one or more named **lists**. Each list contains a hierarchy of **tasks** (list items) with unlimited nesting depth. All data is persisted to localStorage. The app has two interaction modes:

1. **Command mode** — navigate, select, and act on tasks with keyboard shortcuts.
2. **Edit mode** — type task content; smart syntax applies attributes on the fly.

On first run with no data, populate a default list with sample tasks demonstrating the hierarchy and features.


---

## Lists

- Support **multiple named lists**. A **Lists home page** (shortcut `gh` or `ll`) shows all lists with item counts.
- From the home page the user can **create**, **rename**, **archive**, **delete**, and **tag** lists (tags are set in the same Create/Rename List dialog as the name, not via a separate inline interaction).
- Every list and every task has a unique **permalink** id (`#task-<id>`) that never changes even if the item is moved or renamed; `tc` / `lc` copies it to the clipboard.
- A list can be **extracted** from a branch: select the top task of a branch and press `xx` — it becomes a new standalone list.
- **List styles** can be set per list: None (default), Numbered, Boxes (checkboxes before every item), Bullets. Individual items can override with smart-syntax prefixes `[]` (checkbox), `[*]` (bullet), `[1]` (numbered children).


---

## Task Hierarchy & Display

Sub-tasks render indented under their parent, one row per task, with a visual tree connector:

```
|-Tasks:
|---Task 1
|-----Task a
|-----Task B
|-------Task C
|-------Task D
|-----Task E
|---Task 2
```

Parent tasks auto-close when all their children are closed or invalidated (configurable in Settings).


---

## Task Status

Each task has one of three statuses:

- `0` — **open**
- `1` — **closed / completed** — toggled with `Spacebar` or the checkbox
- `2` — **invalidated** — toggled with `Shift+Spacebar`

Once marked done a task retains its `completed_at` timestamp. Closed/invalidated tasks can be shown or hidden (shortcut `hc`). The "Move completed down" option pushes them to the bottom of their branch without hiding them.

**Wipe** (`wipe` command): permanently delete all completed tasks in the current list or under the selected branch.

**Reset** (`reset` command): re-open all completed tasks in the list or under the selected branch (useful to recycle checklists).


---

## Adding & Editing Tasks

- **Enter** while a task is selected → add a new task below and enter edit mode on it.
- **Alt+Enter** → add a task above the selected one.
- **Shift+Enter** (in command mode) → add a child task (sub-task) below.
- Double-click a task **or** press `ee` / `F2` to enter inline edit mode.
  - `ei` enters edit mode with cursor at the start; `ea` at the end.
- While editing, **Enter** saves and adds a new task immediately below, entering edit mode on it.
- While editing, **Escape** cancels and discards unsaved changes.
- While editing, **Ctrl+Enter** submits multi-line text.
- While editing, **Shift+Enter** inserts a line break within the task content.
- **Alt+Enter** while editing splits the task at the cursor position into two tasks.
- Smart syntax (see **Smart Syntax** section) applies tags, due dates, priorities, and assignees while typing.
- Touch-only quick add: tap the toolbar's **➕** button for a single-field "Quick Add Task" modal — works even on a brand-new list with zero existing tasks.


---

## Selection & Navigation

- **Single click** selects a task; a second click within ~320ms enters edit mode (works as double-tap on touch).
- **Arrow keys** (↑ / ↓ or `j` / `k`) navigate up and down.
- **← / →** collapse or expand the selected branch.
- **Home** / **End** jump to the first / last task in the list.
- **PgUp** / **PgDn** scroll one page.
- **`ll`** opens the Lists & Locations palette — type to jump to any list or task across all lists.
- **`gg`** / **`gl`** — jump to the selected task within the current list (scrolls it into view and re-selects it).
- **`gh`** opens the Lists home page; **`gd`** opens the Due page; **`gt`** opens the Tags page.
- **Shift+Shift** opens the **command palette** — type to find and apply any action without memorising shortcuts.

### Multi-selection
- **Shift+↑/↓** — extend selection to adjacent tasks.
- **Ctrl+click** or **`st`** — "sticky" select sparse tasks from the keyboard.
- **Ctrl+A** — select all visible (expanded) tasks; when a filter is active, selects only matching tasks.
- Bulk actions available on a multi-selection: re-order, indent/un-indent, copy/cut/paste, move to another list, set colors, apply/clear tags, set/clear due dates, assign/clear assignees, export.


---

## Moving & Reordering

- **Ctrl+↑ / Ctrl+↓** — move selected task(s) up or down within the same hierarchical level (jump mode, skipping past siblings' children).
- **Ctrl+Alt+↑ / Ctrl+Alt+↓** (or Shift+Alt+↑/↓) — move one position at a time (crawl mode).
- **Tab** / **Shift+Tab** — indent (make sub-task of previous sibling) / un-indent.
- **Hold Shift + drag** — drag-and-drop reorder.
- **Ctrl+Home** / **Ctrl+End** — move selected task to the very top / bottom of the list.
- **Alt+PgUp** / **Alt+PgDn** — move to top / bottom position under the current parent.
- **`mm`** — open a move dialog to send selected task(s) to any location in any list. Choosing a list moves it to the top of that list; choosing a task moves it as a child of that task.


---

## Hoist / Focus

- Press **Shift+→** on a selected task to **hoist** (focus) — all other tasks hide, only this branch is visible.
- **Shift+←** un-focuses and moves focus to the parent.
- While hoisted, parent tasks appear as **breadcrumbs** above the list.
- `ec0` collapses the list and removes the current focus.

A Settings toggle controls whether breadcrumbs are shown while hoisted.

Separately, a **Focus Treatment** display setting ("Selected Path", `focusMode`) dims tasks outside the selected task's ancestor/descendant path and immediate siblings while you have something selected — this is a visual emphasis setting, independent of hoisting.


---

## Expand & Collapse

- **← / →** arrows collapse/expand individual branches.
- **`ec`** toggles the whole current list between fully expanded and fully collapsed.
- **Ctrl+Shift+→** — expand all branches; **Ctrl+Shift+←** — collapse all.


---

## Due Dates

### Setting Due Dates
- **`dd`** opens the Due Date dialog (calendar picker).
- **`td`** — set due today; **`tm`** — set due tomorrow.
- **`as`** — mark due ASAP (no definite date, but flagged as urgent).
- **`cd`** — clear the due date (press twice to also remove a repeating pattern).
- While editing a task, use the `^` smart syntax to attach a due date inline.

### Due Date Smart Syntax

| Syntax | Meaning |
|---|---|
| `^asap` or `^shortlist` | ASAP — no definite date |
| `^today` / `^tod` | Due today |
| `^tomorrow` / `^tom` | Due tomorrow |
| `^nextweek` | Due next Monday |
| `^2026-04-25` | April 25, 2026 (ISO `YYYY-MM-DD`) |
| `^25/04/2026` | April 25, 2026 (`DD/MM/YYYY` — day first, then month) |

Weekday names (`^friday`), month names (`^25 Apr`), and natural-language date recognition are **not** supported — only the exact tokens above are parsed.

### Due Date Display
- Toggle between **relative** ("in 2 days", "overdue 3 days") and **exact** date formats with **`df`**. Overdue dates appear in red.
- All tasks with a due date appear on the **Due page** (shortcut `gd`), grouped into sections (Overdue, ASAP, Today, Tomorrow, This Week, Next Week, This Month, Upcoming). The search box filters the Due page the same way it filters the main list.

### Repeating Tasks
- Press **`dr`** or click "Repeat…" in the Due dialog to set a repeating pattern.
- Repeat modes: **daily**, **weekly** (choose specific day(s)), **monthly**, **yearly**.
- **Repeat from** options: *Due date* (next occurrence always calculated from the scheduled date) or *Actual completion date* (next occurrence calculated from when it was actually completed).
- Set a **Start date** to control when the first recurrence appears.
- **Pause** a repeating task (it will not generate until unpaused).
- Press **`cd`** twice to delete the repeating pattern.
- Repeating tasks are marked with a special icon and included in OPML import/export.


---

## Tags

- While editing, type `#tagname` at the end of the content to attach a tag. Multi-word tags use hyphens or underscores: `#my-tag`.
- Press **`tt`** on a selected task to open the Tags dialog with autocompletion of existing tags.
- `#one, #two` — add multiple tags in one go.
- **`ct`** — clear all tags from the selected task(s).
- **`gt`** — open the Tags map page showing all tags across all lists; click any tag there to filter by it.
- Click any tag on a task to filter the list by that tag. Press `/` and type `#` or `tag:` to filter with autocompletion.
- List-level tags are set in the same Create/Rename List dialog as the list name (a `#tag1 #tag2`-style Tags field), not via a separate per-item interaction.


---

## Colors / Priority

- With a task selected in command mode, press **`1`–`9`** to apply a priority color. Press **`0`** to remove it.
- While editing, use `!1`–`!9` smart syntax at the start or end of content.
- Search/filter by color: `color:1` or `priority:1`.


---

## Notes / Comments

- Press **`nn`** on a selected task to add a note (comment). Notes support Markdown formatting.
- Double-click a note or press **`ee`** while a note is focused to edit it.
- **`cn`** — remove all notes from the selected task(s).
- **`sn`** — show / hide all notes on the page.
- Notes appear indented under their parent task. They cannot have sub-tasks, tags, or due dates.


---

## Assignees

- Press **`ae`** on a selected task to open the Assign dialog and delegate to one or more people (free-text names — there is no user/account system).
- While editing, type `@username` as smart syntax to assign inline.
- **`ca`** — clear all assignees from the selected task(s).
- Search `@username` in the search bar to see everything assigned to a person.


---

## Linking

### Internal Links
- While editing, type `[[` to open a completion popup of tasks and lists — select a target to insert a Markdown-style link `[text](#task-<id>)`.
- Edit a link with **Ctrl+K** (also used for external links).
- Filter: `has:hyperlink` finds tasks with any external `https://` link in their content.
- Shortcut `tc` / `lc` copies the task's permalink to the clipboard.

### External Links
- Press **Ctrl+K** while editing to add or edit a hyperlink (`[text](URL)`).
- Plain URLs typed in content (e.g. `https://example.com`) are auto-converted to hyperlinks.


---

## Search & Filter

- Press **`/`** or **`ff`** to focus the search field. The list (and, separately, the Due page) filters as you type.
- Press **Enter twice** to search across all lists globally.
- **Esc Esc** — clear the filter.
- Press **`?`** in the search field to see the full syntax reference.

### Search Syntax

| Pattern | Meaning |
|---|---|
| `#tag` or `tag:word` | Tasks tagged with that tag |
| `@name` or `assignee:name` | Tasks assigned to that person |
| `^overdue` / `due:overdue` | All overdue tasks |
| `^asap` | Tasks marked ASAP |
| `^now` | Overdue + ASAP + today |
| `^today` | Tasks due today (excludes overdue/ASAP) |
| `^tomorrow` | Tasks due tomorrow |
| `^week` | Tasks due this week (Mon–Sun) |
| `^next week` | Tasks due next week |
| `^last week` | Tasks due last week |
| `^month` | Tasks due this calendar month |
| `^next month` | Tasks due next calendar month |
| `^last month` | Tasks due last month |
| `^any` | All tasks with a due date |
| `^none` | Tasks without a due date |
| `in:open` | Open tasks only (default when due filter is active) |
| `in:closed` | Closed tasks only |
| `in:all` | All tasks regardless of status |
| `color:N` / `priority:N` | Tasks with color/priority N (1–9) |
| `color:any` | Tasks with any color |
| `color:none` | Tasks without color |
| `has:attachment` | Tasks with attached files (schema field exists but nothing currently writes to it, so this will not match anything) |
| `has:note` | Tasks with notes |
| `has:hyperlink` | Tasks with external hyperlinks |
| `created:today` | Tasks created today |
| `changed:3h` / `updated:2d` | Tasks updated in the last 3 hours / 2 days |


---

## Sort

Press **`ss`** to open the Sort menu. Sort the whole list or only the branch under the selected task:

- By **priority** (color)
- **Alphabetically**
- By **due date**
- By **time created** (newest first)
- By **time updated** (most recent first)
- **Shallow sort**: sort only the top level of the target scope, leaving deeper levels untouched.
- **Reverse order** checkbox for Z→A / oldest-first / etc.


---

## Progress Tracking

- Press **`pc`** on a branch to show a **progress counter** — a toast showing "X/Y done" for that branch.
- Enable a progress counter for the **whole list** via the Options (`oo`) menu.
- Progress counter also appears on the Lists home page.


---

## View Options

All toggleable via the Options menu (`oo`) or dedicated shortcuts:

| Shortcut | Effect |
|---|---|
| `hc` | Hide / show completed and invalidated tasks |
| `hf` | Hide tasks due after tomorrow (show only overdue, ASAP, today, tomorrow) |
| `sd` | Show / hide item details (creation/update timestamps) |
| `pc` | Show / hide progress counter |
| `df` | Toggle relative vs. exact due date display |
| `sn` | Show / hide all notes |
| `om` | Zen / distraction-free mode (hides navigation, search bar, toolbar; all shortcuts still work) |

**Dark UI**: toggle in Settings (`oo`).

**List style**: set per list — None, Numbered, Boxes, Bullets. Individual items can override with `[]`, `[*]`, `[1]` prefixes.


---

## Formatting — Smart Syntax

Smart syntax works while editing a task; use autocompletion to select tag/assignee/wiki-link values.

| Syntax | Effect |
|---|---|
| `#tagname` | Add a tag |
| `^due-date` | Set a due date (see Due Date Smart Syntax table) |
| `!1`–`!9` | Set color/priority |
| `@username` | Assign to a person |
| `[[` | Create an internal link to another task |
| `[text](URL)` | External hyperlink (Markdown) |
| `[]` | Prefix to show a checkbox for this item and sub-items |
| `[*]` | Prefix to show bullets for this item and sub-items |
| `[1]` | Prefix to enable numbering for sub-items |

Attributes (`#`, `^`, `!`, `@`) should be placed at the end of the task content.


---

## Formatting — Markdown

The app supports **GitHub Flavored Markdown** for rich text in task content and notes (always on — there is no per-list Markdown toggle).

### Text Formatting

| Syntax | Result |
|---|---|
| `**bold**` or Ctrl+B | **Bold** |
| `*italic*` or Ctrl+I | *Italic* |
| `~~deleted~~` | ~~Strikethrough~~ |
| `` `inline code` `` | `inline code` |
| ` ``` code block ``` ` | Fenced code block with syntax highlighting |
| `> blockquote` | Blockquote |
| `* item` | Unordered list item |
| `1. item` | Ordered list item |
| `[text](URL)` | Hyperlink |
| `\| col \| col \|` | Table (GitHub table syntax) |

### Dates & Time Insertion

- **Ctrl+;** — insert the current date.
- **Ctrl+:** — insert the current time.


---

## Export

Press **`ex`** or use the Actions menu. Export scope depends on current selection:
- A selected branch → export that branch.
- No selection → export the whole list.
- Focused (hoisted) list → export the focused portion.

### Export Formats

| Format | Notes |
|---|---|
| **JSON** | Raw list + tasks payload |
| **Markdown** | Hierarchy exported as headings; notes exported as plain text |
| **OPML** | Preserves task attributes including repeating due dates; compatible with other outline tools |
| **Plain Text** | No formatting; sub-tasks indented |

Each format has its own options (e.g. include/exclude notes, tags, due dates).


---

## Import

Press **`im`** or select Import from the Actions menu. Choose insertion point: **top of list**, **bottom of list**, **under the selected task**, or **replace list contents** (destructive — use with caution).

Pasting multi-line text with **Ctrl+V** into the list prompts the import dialog automatically.

### Import Formats

| Format | Notes |
|---|---|
| **JSON** | Round-trips the app's own export payload |
| **Indented text / Markdown** | Relative indentation determines hierarchy |
| **OPML** | Full round-trip with all task attributes |


---

## Deleted Items & Undo

- **Del** — delete the selected task(s) and all their sub-tasks. Works with multi-selection.
- **Ctrl+Z** or **`uu`** — one-step undo of the last action.
- **`rd`** — open the "Restore deleted" dialog showing items deleted in the last **24 hours**. Select items and press "Restore selected" to place them at the top of the list. Bulk and sticky selection work here.


---

## Word Count

Press **`wc`** or open the Actions menu → Word count. Shows word count and character count (with and without spaces) for the selected branch (including all its children) or the whole list.


---

## Copy Operations

- **Ctrl+C** — copy selected task(s) and their full branch.
- **Ctrl+X** — cut.
- **Ctrl+V** — paste.
- **Ctrl+D** — duplicate in place.
- **Ctrl+Shift+C** — copy the task text **plus its unique permalink URL** (formatted in Markdown). If the task has children, copies the entire branch. Also available in the `ll` palette.


---

## Settings Panel

A Settings / Options panel (accessible via `oo` or a toolbar gear icon) exposes:

- Show / hide completed tasks
- Move completed tasks to bottom of branch
- Show breadcrumbs while hoisted
- Close parent task when last child is closed (on/off)
- Relative vs. exact due date display
- List style (None / Numbered / Boxes / Bullets)
- Show / hide progress counter for the whole list
- Dark UI theme toggle
- Zen mode (`om`)
- Task list layout: density, parent emphasis, indent-guide style, branch spacing, Focus Treatment mode, content width
- Gist / repo sync provider and credentials


---

## Keyboard Shortcuts Reference

### Basic

| Shortcut | Action |
|---|---|
| `Enter` | Add task below; confirm edit |
| `Alt+Enter` | Add task above; split task at cursor while editing |
| `Shift+Enter` | Add child task; insert line break while editing |
| `Tab` / `Shift+Tab` | Indent / un-indent |
| `ee` / `F2` | Edit selected task |
| `ei` / `ea` | Edit: cursor at start / end |
| `Esc` | Cancel edit; close popup; clear selection |
| `Ctrl+C/X/V/D` | Copy / Cut / Paste / Duplicate |
| `Ctrl+Shift+C` | Copy with permalink URL |
| `Del` | Delete task(s) |
| `Ctrl+Z` / `uu` | Undo |
| `Shift+↑/↓` | Extend multi-selection |
| `Ctrl+A` | Select all visible tasks |
| `st` / `Ctrl+click` | Sticky / sparse multi-select |
| `Shift+Shift` | Open command palette |

### Navigation

| Shortcut | Action |
|---|---|
| `↑/↓` or `j/k` | Move cursor up / down |
| `←/→` | Collapse / expand branch |
| `Home` / `End` | First / last task |
| `PgUp` / `PgDn` | Page up / down |
| `ll` | Lists & Locations palette |
| `gh` | Lists home page |
| `gd` | Due page |
| `gt` | Tags page |
| `gg` / `gl` | Jump to selected task within the list |

### Move & Reorder

| Shortcut | Action |
|---|---|
| `Ctrl+↑/↓` | Move up/down (jump mode) |
| `Ctrl+Alt+↑/↓` | Move up/down (crawl mode) |
| `Ctrl+Home/End` | Move to top / bottom of list |
| `Alt+PgUp/PgDn` | Move to top / bottom under parent |
| `mm` | Move to another list |
| Hold `Shift` + drag | Drag-and-drop |

### Hoist & Expand

| Shortcut | Action |
|---|---|
| `Shift+→` | Hoist (focus) selected task |
| `Shift+←` | Un-focus / focus parent |
| `ec` | Toggle expand-all / collapse-all |
| `ec0` | Collapse all + un-focus |
| `Ctrl+Shift+→` | Expand all |
| `Ctrl+Shift+←` | Collapse all |

### Task Status & Priority

| Shortcut | Action |
|---|---|
| `Spacebar` | Toggle open / closed |
| `Shift+Spacebar` | Invalidate task |
| `1`–`9` | Set priority color |
| `0` | Remove priority color |
| `reset` | Re-open all completed tasks |
| `wipe` | Delete all completed tasks |

### Due Dates

| Shortcut | Action |
|---|---|
| `dd` | Open Due Date dialog |
| `td` | Set due today |
| `tm` | Set due tomorrow |
| `as` | Set ASAP |
| `dr` | Set repeating pattern |
| `df` | Toggle relative/exact date display |
| `cd` | Clear due date (×2 to delete repeating) |

### Tags, Notes, Assignees

| Shortcut | Action |
|---|---|
| `tt` | Tags dialog |
| `ct` | Clear tags |
| `gt` | Open Tags page |
| `nn` | Add note |
| `cn` | Clear notes |
| `sn` | Show/hide all notes |
| `ae` | Assign task |
| `ca` | Clear assignees |

### View & Display

| Shortcut | Action |
|---|---|
| `hc` | Hide/show completed |
| `hf` | Hide future due tasks |
| `sd` | Show/hide item details |
| `pc` | Show/hide progress counter |
| `sn` | Show/hide all notes |
| `om` | Zen / distraction-free mode |
| `oo` | Options/Settings menu |

### List Operations

| Shortcut | Action |
|---|---|
| `ss` | Sort |
| `rd` | Restore deleted items |
| `wc` | Word count |
| `xx` | Extract branch as new list |
| `ex` | Export |
| `im` | Import |

### Formatting

| Shortcut | Action |
|---|---|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Add / edit hyperlink |
| `tc` / `lc` | Copy task permalink to clipboard |
| `Ctrl+;` | Insert current date |
| `Ctrl+:` | Insert current time |

### Search

| Shortcut | Action |
|---|---|
| `/` or `ff` | Focus search field |
| `Enter Enter` | Search all lists |
| `Esc Esc` | Clear filter |
| `?` | Show search syntax help |


---

## JSON Data Schema

Use the following structure for each task/list-item (matches `mkTask` in `js/core/utils.js`):

```json
{
  "id": "",
  "content": "",
  "status": 0,
  "checklist_id": "",
  "parent_id": "",
  "position": 0,
  "deleted": false,
  "tasks": [],
  "tags": {},
  "tags_as_text": "",
  "color": 0,
  "due": "",
  "due_asap": false,
  "repeating_due": null,
  "assignees": [],
  "attachments": [],
  "links": [],
  "notes": [],
  "comments_count": 0,
  "history": [],
  "update_line": "",
  "updated_at": "",
  "created_at": "",
  "completed_at": "",
  "_collapsed": false,
  "overdue_ack_due": ""
}
```

### Field Explanations

| Field | Description |
|---|---|
| `id` | Unique ID of the task |
| `content` | Task text; may include Markdown and smart-syntax attributes |
| `status` | `0` = open, `1` = closed/completed, `2` = invalidated |
| `checklist_id` | ID of the list containing this task |
| `parent_id` | ID of the parent task; empty string if root-level |
| `position` | 1-based position among siblings under the same parent |
| `deleted` | `true` if the task has been deleted (soft-delete for restore) |
| `tasks` | Ordered array of child task IDs |
| `tags` | Object mapping tag name → `{ isPrivate: boolean }` (the `isPrivate` flag is always `false` — there is no UI to toggle it) |
| `tags_as_text` | Comma-separated list of tag names (derived field) |
| `color` | Priority color 1–9; `0` means no color |
| `due` | ISO date string for due date; empty if none |
| `due_asap` | `true` if marked ASAP (no specific date) |
| `repeating_due` | Object describing repeating pattern: `{ freq, interval, weekdays, startDate, repeatFrom, reopenDays, paused }` (`reopenDays` is always written as `0` — there is no UI to set it) |
| `assignees` | Array of assignee names (free text, no user accounts) |
| `attachments` | Array field exists but nothing in the app currently writes to it |
| `links` | Array field exists but internal task links are actually embedded inline in `content` as `[label](#task-id)` markdown, not stored here |
| `notes` | Array of note objects: `{ id, author, content, created_at, updated_at }` |
| `comments_count` | Number of notes attached to this task |
| `history` | Array of change-log entries: `{ at, type, changes }`, capped at the most recent 200 |
| `update_line` | Reserved field; not actively populated |
| `updated_at` | ISO timestamp of last update |
| `created_at` | ISO timestamp of creation |
| `completed_at` | ISO timestamp when status was set to closed; retained after re-opening |
| `_collapsed` | `true` if the task's children are hidden in the tree view |
| `overdue_ack_due` | Tracks which due date the user has acknowledged as overdue, to avoid re-flagging the same date |


---

## Edit Behaviour Summary

- **Enter** while editing → save and add a new task immediately below; enter edit mode on the new task.
- **Escape** while editing → discard changes and return to command mode.
- **Ctrl+Enter** → save multi-line content.
- **Shift+Enter** → insert a line break within the task (first one activates multi-line mode; subsequent Enter keys also insert breaks until Ctrl+Enter saves).
- **Alt+Enter** → split the task at the cursor into two tasks.


---

## Remote Capture (Inbox.html + Gist/Repo Sync)

There is no per-list email address or backend mailbox. The one real remote-capture path is `Inbox.html` — a standalone page (e.g. bookmarked on a phone) that queues a new-task request as a line in a GitHub Gist or repo file. The next time the main app syncs (auto-sync interval, manual "Sync now", or on refresh), it reads that queue, creates the corresponding task(s) locally, and marks the request processed. See the "CLI Task Capture via Gist Queue" section above for the equivalent command-line path.


---

## First-Run Defaults

On first launch with no data, create a default list named "My Tasks" pre-populated with sample tasks that demonstrate:
- Multi-level nesting (at least 3 levels deep)
- A completed task (to show the completed state)
- A task with a due date (today or tomorrow)
- A task with a tag
- A task with a note
- A task with a priority color
