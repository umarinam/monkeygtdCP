Write a single HTML file using localStorage and JavaScript as a full-featured task manager and outliner app modelled after Checkvist (https://checkvist.com). The app must support all of the following capabilities.

## GitHub Pages Hosting

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml` that publishes `monkeygtd-standalone.html` as the site `index.html` on pushes to `master`.

![Deploy GitHub Pages](https://github.com/umarinam/monkeygtdCP/actions/workflows/pages.yml/badge.svg)

Live URL: https://umarinam.github.io/monkeygtdCP/

One-time setup in GitHub repository settings:
1. Open Settings > Pages.
2. Under Build and deployment, set Source to GitHub Actions.

After that, every push to `master` deploys the latest standalone app.


---

## Core Architecture

The app manages one or more named **lists**. Each list contains a hierarchy of **tasks** (list items) with unlimited nesting depth. All data is persisted to localStorage. The app has two interaction modes:

1. **Command mode** — navigate, select, and act on tasks with keyboard shortcuts.
2. **Edit mode** — type task content; smart syntax applies attributes on the fly.

On first run with no data, populate a default list with sample tasks demonstrating the hierarchy and features.


---

## Lists

- Support **multiple named lists**. A **Lists home page** (shortcut `gh` or `ll`) shows all lists with item counts.
- From the home page the user can **create**, **rename**, **archive**, **delete**, and **tag** lists. Only the list owner may delete; others may only archive or un-share.
- Each list has a **unique email address** so tasks can be emailed in (subject → task content, body → note).
- Every list and every task has an unguessable **permalink** that never changes even if the item is moved or renamed.
- A list can be **extracted** from a branch: select the top task of a branch and press `xx` — it becomes a new standalone list linked back to the original.
- **List styles** can be set per list: None (default), Numbered, Boxes (checkboxes before every item), Bullets. Individual items can override with smart-syntax prefixes `[]` (checkbox), `[*]` (bullet), `[1]` (numbered children).
- **Copy list** duplicates the whole list (optionally with or without statuses, tags, due dates). Selecting "As a single node" inlines the entire list as one branch inside another list.


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


---

## Selection & Navigation

- **Single click** selects a task.
- **Arrow keys** (↑ / ↓ or `j` / `k`) navigate up and down.
- **← / →** collapse or expand the selected branch.
- **Home** / **End** jump to the first / last task in the list.
- **PgUp** / **PgDn** scroll one page.
- **g←** / **g→** navigate back and forward through recent locations (history).
- **`ll`** opens the Lists & Locations palette — type to jump to any list or task across all lists.
- **`gg`** opens a hyperlink on the selected task in the same tab; **Shift+`gg`** opens in a new tab.
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
- **`mb`** — move selected task(s) to a bookmarked location (see **Bookmarks**).


---

## Hoist / Focus

- Press **Shift+→** on a selected task to **hoist** (focus) — all other tasks hide, only this branch is visible.
- **Shift+←** un-focuses and moves focus to the parent.
- While hoisted, parent tasks appear as **breadcrumbs** above the list. Arrow-navigate breadcrumbs and press **Enter** to hoist a parent. Clicking the leading `>>` icon hides breadcrumbs entirely.
- `ec0` collapses the list and removes the current focus.

A Settings toggle controls whether breadcrumbs are shown while hoisted.


---

## Expand & Collapse

- **← / →** arrows collapse/expand individual branches.
- **`ec`** opens the Expand/Collapse options panel:
  - Expand all / Collapse all
  - Show all notes
  - Collapse to a specific depth level
- **`ec1`–`ec9`** — collapse the list to depth 1–9.
- **Ctrl+Shift+→** — expand all branches; **Ctrl+Shift+←** — collapse all.
- **Ctrl+Alt+.** — expand selected branch; **Ctrl+Alt+,** — collapse selected branch.


---

## Due Dates

### Setting Due Dates
- **`dd`** opens the Due Date dialog (calendar picker).
- **`td`** — set due today; **`tm`** — set due tomorrow.
- **`as`** — mark due ASAP (no definite date, but flagged as urgent).
- **`cd`** — clear the due date (press twice to also remove a repeating pattern).
- While editing a task, use the `^` smart syntax with autocompletion to attach a due date inline.
- Checkvist also recognises natural-language dates placed at the end of task text (e.g. "Call John tomorrow") and converts them to due dates automatically.

### Due Date Smart Syntax

| Syntax | Meaning |
|---|---|
| `^asap` or `^shortlist` | ASAP — no definite date |
| `^today` / `^tod` | Due today |
| `^tomorrow` / `^tom` | Due tomorrow |
| `^friday` / `^fri` | Next Friday to occur |
| `^next friday` | The second Friday from now |
| `^25 Apr` or `^Apr 25` | April 25 this year (next year if passed) |
| `^04/25/2026` | April 25, 2026 (MM/DD/YYYY) |
| `^2026-04-25` | April 25, 2026 (ISO) |
| `^any` | Filter: tasks with any due date |
| `^none` | Filter: tasks without a due date |

### Due Date Display
- Toggle between **relative** ("in 2 days", "overdue 3 days") and **exact** date formats with **`df`**. Overdue dates appear in red.
- All tasks with a due date appear on the **Due page** (shortcut `gd`). The Due page shows overdue, ASAP, today, tomorrow, and future tasks in separate sections. A "Repeating" tab lists all recurring tasks.

### Repeating Tasks *(PRO)*
- Press **`dr`** or click "Repeat…" in the Due dialog to set a repeating pattern.
- Repeat modes: **daily**, **weekly** (choose specific day(s)), **monthly**, **yearly**.
- **Repeat from** options: *Due date* (next occurrence always calculated from the scheduled date) or *Actual completion date* (next occurrence calculated from when it was actually completed).
- Set a **Start date** to control when the first recurrence appears.
- Set a **Re-open** delay so the task only reappears N days before it is due.
- **Pause** a repeating task (it will not generate until unpaused).
- Press **`cd`** twice to delete the repeating pattern.
- Repeating tasks are marked with a special icon. Their data is included in OPML import/export and in calendar sync.
- Configurable: whether missing a due date marks the task overdue or silently moves to the next occurrence.

### Calendar Integration *(PRO)*
- **Google Calendar**: 2-way sync — Checkvist tasks appear as events, changes sync in both directions. Deleting a calendar event removes the due date but keeps the task.
- **iCalendar feed**: a read-only iCal URL for any app that supports iCal subscriptions (Apple Calendar, Outlook, etc.).


---

## Tags

- While editing, type `#tagname` at the end of the content to attach a tag. Multi-word tags use hyphens or underscores: `#my-tag`.
- Press **`tt`** on a selected task to open the Tags dialog with autocompletion of existing tags.
- `#one, #two` — add multiple tags in one go.
- **`ct`** — clear all tags from the selected task(s).
- **`gt`** — open the Tags map page showing all tags across all lists.
- Click any tag in the list to filter tasks by that tag. Press `/` and type `#` or `tag:` to filter with autocompletion.
- **Tag lists**: double-click a list title and append `#tag` to tag the whole list.

### Tag Management *(PRO)*
- **Change tag color** — makes important tags more visually prominent (visible only to you).
- **Rename or merge** — rename a tag across all lists, or merge similar tags into one.
- **Private tags** — make a tag invisible to other collaborators (only you see it).
- **Delete** — remove all usages of a tag from all lists (irreversible).


---

## Colors / Priority

- With a task selected in command mode, press **`1`–`9`** to apply a priority color. Press **`0`** to remove it.
- While editing, use `!1`–`!9` smart syntax at the start or end of content.
- Color is a shared property — all collaborators see the same colors.
- Search/filter by color: `color:1` or `priority:1`.
- *(PRO)* Customize the 9-color palette in Profile → Settings; the customization applies to the whole account.


---

## Notes / Comments

- Press **`nn`** on a selected task to add a note (comment). Notes support Markdown formatting.
- Double-click a note or press **`ee`** while a note is focused to edit it. Only the note's author can edit their own notes.
- **`cn`** — remove all notes from the selected task(s).
- **`sn`** — show / hide all notes on the page.
- Notes appear indented under their parent task. They cannot have sub-tasks, tags, or due dates.
- Note activity (additions) appears in email notifications.


---

## Assignees *(PRO)*

- Press **`ae`** on a selected task to open the Assign dialog and delegate to one or more people.
- While editing, type `@username` as smart syntax to assign inline.
- **`ca`** — clear all assignees from the selected task(s).
- Assignees are notified by email when assigned and whenever the task or its sub-tasks change.
- A read-only collaborator can still edit, change status, add notes, and attach files to tasks assigned to them.
- Search `@username` in the search bar to see everything assigned to a person.


---

## Attachments *(PRO)*

- Press **`at`** on a selected task to open the Attach dialog — upload from local disk or a URL.
- **Drag-and-drop** a file onto a task to attach it.
- While editing, type `img:` to embed an image directly into task content; after upload the image can be resized to 100%, 75%, or 50%.
- Use arrow keys to navigate between attached files; press **Enter** to preview an attached image.
- Each user has up to **2 GB** of attachment storage.


---

## Linking

### Internal Links
- While editing, type `[[` to open a completion popup of all lists and tasks — select a target to insert a Markdown-style link `[text](permalink)`.
- A link to another task shows a task icon; a link to a list shows the Checkvist logo icon.
- **Backlinks**: when a link is created, the target task automatically shows a backlink badge with the source's list and content. Hover to preview. Backlinks reflect the current status of the source task (struck-through if done).
- **Link preview**: hover any internal link to see the target task's content, tags, due date, and sub-tasks.
- Edit a link with **Ctrl+K** (also used for external links).
- Pre-select text before typing `[[` to wrap the selection as the link label automatically.
- Filter: `has:link` finds tasks that contain links; `has:backlink` finds tasks linked from elsewhere.
- Shortcut `tc` / `lc` copies the task's permalink to the clipboard.

### External Links
- Press **Ctrl+K** while editing to add or edit a hyperlink (`[text](URL)`).
- Plain URLs typed in content (e.g. `https://example.com`) are auto-converted to hyperlinks.
- Paste a YouTube URL → the app offers to embed the video inline or keep it as a link.
- Issue tracker links: `[jira: ISSUE-ID|URL]` and `[youtrack: ISSUE-ID|URL]`.


---

## Search & Filter

- Press **`/`** or **`ff`** to focus the search field. The list filters as you type.
- Press **Enter twice** to search across all lists globally.
- **`cf`** or **Esc Esc** — clear the filter.
- **`rf`** — refresh the filter (re-apply after changes).
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
| `in:todo` | Items with a checkbox prefix |
| `color:N` / `priority:N` | Tasks with color/priority N (1–9) |
| `color:any` | Tasks with any color |
| `color:none` | Tasks without color |
| `has:attachment` | Tasks with attached files |
| `has:note` | Tasks with notes |
| `has:hyperlink` | Tasks with external hyperlinks |
| `has:backlink` | Tasks linked from other tasks |
| `created:today` | Tasks created today |
| `changed:3h` / `updated:2d` | Tasks updated in the last 3 hours / 2 days |
| `updated:Jan 8, 2026` | Tasks changed on a specific date |
| `changed:current week` | Tasks changed this week |
| `updated:current month` | Tasks changed this month |


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

- Press **`pc`** on a branch to show a **progress counter** for that branch — displays open task count; hover for details.
- Enable a progress counter for the **whole list** via the Options (`oo`) menu.
- **Time estimation tags**: add `#15m`, `#3h`, or `#8d` to a task. Checkvist sums time across children and displays remaining time beside the parent. `#60m` = `#1h`; `#8h` = `#1d`. The counter grays out completed tasks.
- Progress counter also appears on the Lists home page (showing open task count if progress counter is on, otherwise total item count).


---

## View Options

All toggleable via the Options menu (`oo`) or dedicated shortcuts:

| Shortcut | Effect |
|---|---|
| `hc` | Hide / show completed and invalidated tasks |
| `hf` | Hide tasks due after tomorrow (show only overdue, ASAP, today, tomorrow) |
| `sd` | Show / hide item details (creation/update timestamp; the timestamp is the item's permalink) |
| `sc` | Show / hide parent context as breadcrumbs on Due and Search results pages |
| `pc` | Show / hide progress counter |
| `df` | Toggle relative vs. exact due date display |
| `sn` | Show / hide all notes |
| `om` | Zen / distraction-free mode (hides navigation, search bar, toolbar; all shortcuts still work) |

**Dark / Darcula UI**: toggle in Settings (`oo` → Settings) or on the Profile → Settings page.

**List style**: set per list — None, Numbered, Boxes, Bullets. Individual items can override with `[]`, `[*]`, `[1]` prefixes.


---

## Bookmarks *(PRO)*

- **`ab`** — bookmark the selected task or list item; optionally assign a name and a digit shortcut.
- **`cb`** — remove the bookmark from the selected task.
- **`bb`** — open the Bookmarks palette; type to filter, arrow keys to navigate, Enter to jump.
- **`b` + digit (0–9)** — jump directly to a shortcut-assigned bookmark.
- A **filter/search bookmark** can be created by clicking the bookmark icon in the search bar after typing a filter; it saves that filter (including global search, focus, and Due page filters).
- **`mb`** — move selected task(s) to a bookmarked destination; `mb0`–`mb9` moves directly using digit shortcuts.
- Bookmarks persist across sessions and remember their context (filtered list, focused node, Due page filter).


---

## Formatting — Smart Syntax

Smart syntax works while editing a task; use autocompletion to select values.

| Syntax | Effect |
|---|---|
| `#tagname` | Add a tag |
| `^due-date` | Set a due date (see Due Date Smart Syntax table) |
| `!1`–`!9` | Set color/priority |
| `@username` | Assign to a person |
| `img:` | Upload and embed an image |
| `[[` | Create an internal link to another task or list |
| `[text](URL)` | External hyperlink (Markdown) |
| `----` | List separator (4+ hyphens on their own line) |
| `[]` | Prefix to show a checkbox for this item and sub-items |
| `[*]` | Prefix to show bullets for this item and sub-items |
| `[1]` | Prefix to enable numbering for sub-items |
| `todo` or `do` | Toggle a `[ ]` / `[x]` checkbox prefix |

Attributes (`#`, `^`, `!`, `@`) should be placed at the end of the task content.


---

## Formatting — Markdown

The app supports **GitHub Flavored Markdown** for rich text in task content and notes.

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
| `\#` | Escape a special character |

### Headings

Press **`mh`** to add/remove Markdown heading markup. Based on the item's depth in the hierarchy, the heading level is H2–H6. To force H2 deep in the hierarchy, hoist that item first then apply `mh`.

| `#` | H1 (reserved for list title in exports) |
|---|---|
| `##` | H2 |
| `######` | H6 (smallest) |

### Dates & Time Insertion

- **Ctrl+;** — insert the current date (like Google Sheets).
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
| **Rich Text** | Preserves bold, italic, headers; paste into email or Google Docs/Word/Pages |
| **Markdown** | Hierarchy exported as headings (depth-controlled with "Generate headers from" option); notes exported as plain text with author attribution; embedded images and attached file links included |
| **OPML** | OPML 2.0 with Checkvist extensions; preserves all task attributes including repeating due dates; compatible with OmniOutliner and other outline tools |
| **Plain Text** | No formatting; sub-tasks indented with tabs; status and last-update shown in parentheses; notes share the same indentation |

Each format has its own options (e.g. include/exclude notes, tags, due dates, attachments).


---

## Import

Press **`im`** or select Import from the Actions menu. Choose insertion point: **top of list**, **bottom of list**, **under the selected task**, or **replace list contents** (destructive — use with caution).

Pasting multi-line text with **Ctrl+V** into the list prompts the import dialog automatically.

### Import Formats

| Format | Notes |
|---|---|
| **Plain text (indented)** | Relative indentation determines hierarchy; dashes and spaces as indent markers; option to treat blank lines as item separators (for multi-line items) |
| **OPML** | Full round-trip with all Checkvist task attributes; compatible with exports from OmniOutliner and other OPML-compatible tools |


---

## Deleted Items & Undo

- **Del** — delete the selected task(s) and all their sub-tasks. Works with multi-selection.
- **Ctrl+Z** or **`uu`** — one-step undo of the last action. Also restores the last deleted item immediately after deletion.
- **`rd`** — open the "Restore deleted" dialog showing items deleted in the last **24 hours** (free) / **10 days** (PRO). Select items and press "Restore selected" to place them at the top of the list. Bulk and sticky selection work here.


---

## Word Count

Press **`wc`** or open the Actions menu → Word count. Shows word count, character count (with and without spaces) for the selected branch or whole list. Uncheck "With children" to count only the selected item's text.


---

## Print

Open Print preview from the Actions menu. Options:
- Hide/show tags, due dates, assignees.
- Show/hide notes.
- Print checkboxes (useful for paper checklists).
- Scope to the current filter or focus before printing to print only a subset.


---

## Copy Operations

- **Ctrl+C** — copy selected task(s) and their full branch.
- **Ctrl+X** — cut.
- **Ctrl+V** — paste.
- **Ctrl+D** — duplicate in place.
- **Ctrl+Shift+C** — copy the task text **plus its unique permalink URL** (formatted in Markdown). If the task has children, copies the entire branch. Also available in the `ll` palette.


---

## Sharing & Collaboration

### Public Sharing
- Share a list publicly with an **unguessable link**. Set permissions: **read-only** or **writer** (writer needs a Checkvist account).
- *(PRO)* Set an **expiry time** — the public link stops working after that time; the list becomes private again automatically.
- *(PRO)* Set a **password** on the public link.
- *(PRO)* Allow **search engine indexing** of the public list.
- **Embed** a list in a webpage with an `<iframe>` code snippet (available in the Share dialog).
- **Share a filtered or focused list** — check "Keep filter and focus" in the Share dialog so visitors open the list pre-filtered. The filter/focus can be updated without changing the share link.

### Private Sharing
- Invite collaborators by **email**. They receive an invitation link.
- Set permissions per invite: **Writer** (full edit access, can re-share) or **Reader** (view only; can still edit tasks assigned to them).
- Select existing collaborators from other shared lists ("Select existing users") for instant access without a new invitation.
- The list owner can change permissions or un-share anyone from the Share dialog.
- **Bulk sharing**: on the home page select multiple lists and click Share to share all with the same people at once.

### Permissions Model
| Role | Capabilities |
|---|---|
| **Owner** | Create, delete, configure, enable Markdown, share, transfer ownership |
| **Writer** | Edit/delete tasks, share, send notifications; cannot delete the list |
| **Reader** | View only; can edit tasks assigned to them, add notes and attachments to those tasks |


---

## Notifications

### Manual
- Click the notification icon in the toolbar to send an email to selected collaborators summarising changes made in the current session (~30-min window). Preview changes before sending.

### Automatic *(PRO)*
- **Watch a list**: receive emails when anyone makes changes (~every 5 min, changes within the window are merged), or a **daily digest** at a configurable time.
- **Due reminders**: daily email at a configurable time listing tasks that are overdue, due today, due tomorrow, or ASAP.
- An automatic notification is sent when a task is **assigned** to you.
- Pause / resume notifications per list or globally from Profile → Notifications.


---

## Settings Panel

A Settings / Options panel (accessible via `oo` or a toolbar gear icon) exposes:

- Show / hide completed tasks
- Move completed tasks to bottom of branch
- Show breadcrumbs while in zoom (hoist) mode
- Close parent task when last child is closed (on/off)
- Relative vs. exact due date display
- Automatic due date recognition from natural language
- List style (None / Numbered / Boxes / Bullets)
- Show / hide progress counter for the whole list
- Enable / disable Markdown for this list
- Dark / Darcula UI theme toggle
- Zen mode (`om`)
- *(PRO)* Custom priority color palette (9 colors mapped to keys 1–9)
- *(PRO)* Custom CSS for logo, navigation, UI colors, tag icons


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
| `g←` / `g→` | Navigate back / forward in history |
| `ll` | Lists & Locations palette |
| `gh` | Lists home page |
| `gd` | Due page |
| `gt` | Tags page |
| `gg` | Open hyperlink on task |
| `Shift+gg` | Open hyperlink in new tab |

### Move & Reorder

| Shortcut | Action |
|---|---|
| `Ctrl+↑/↓` | Move up/down (jump mode) |
| `Ctrl+Alt+↑/↓` | Move up/down (crawl mode) |
| `Ctrl+Home/End` | Move to top / bottom of list |
| `Alt+PgUp/PgDn` | Move to top / bottom under parent |
| `mm` | Move to another list |
| `mb` | Move to a bookmarked location |
| Hold `Shift` + drag | Drag-and-drop |

### Hoist & Expand

| Shortcut | Action |
|---|---|
| `Shift+→` | Hoist (focus) selected task |
| `Shift+←` | Un-focus / focus parent |
| `ec` | Expand/Collapse options |
| `ec0` | Collapse all + un-focus |
| `ec1`–`ec9` | Collapse to depth 1–9 |
| `Ctrl+Shift+→` | Expand all |
| `Ctrl+Shift+←` | Collapse all |
| `Ctrl+Alt+.` | Expand selected branch |
| `Ctrl+Alt+,` | Collapse selected branch |

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

### Tags, Notes, Assignees, Attachments

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
| `at` | Attach file |

### View & Display

| Shortcut | Action |
|---|---|
| `hc` | Hide/show completed |
| `hf` | Hide future due tasks |
| `sd` | Show/hide item details |
| `sc` | Show/hide context breadcrumbs |
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
| `ab` | Add bookmark |
| `cb` | Clear bookmark |
| `bb` | Open Bookmarks palette |
| `b` + digit | Jump to shortcut bookmark |

### Formatting

| Shortcut | Action |
|---|---|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Add / edit hyperlink |
| `mh` | Toggle Markdown heading |
| `tc` / `lc` | Copy task permalink to clipboard |
| `todo` / `do` | Toggle checkbox prefix |
| `Ctrl+;` | Insert current date |
| `Ctrl+:` | Insert current time |

### Search

| Shortcut | Action |
|---|---|
| `/` or `ff` | Focus search field |
| `Enter Enter` | Search all lists |
| `Esc Esc` or `cf` | Clear filter |
| `rf` | Refresh filter |
| `?` | Show search syntax help |


---

## JSON Data Schema

Use the following structure for each task/list-item:

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
  "update_line": "",
  "updated_at": "",
  "created_at": "",
  "completed_at": ""
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
| `tags` | Object mapping tag name → `{ isPrivate: boolean }` |
| `tags_as_text` | Comma-separated list of tag names (derived field) |
| `color` | Priority color 1–9; `0` means no color |
| `due` | ISO date string for due date; empty if none |
| `due_asap` | `true` if marked ASAP (no specific date) |
| `repeating_due` | Object describing repeating pattern: `{ freq, interval, days, startDate, repeatFrom, reopenDays, paused }` |
| `assignees` | Array of assignee usernames/IDs |
| `attachments` | Array of attachment objects: `{ id, filename, url, size, type }` |
| `links` | Array of internal link objects: `{ targetId, text }` |
| `notes` | Array of note objects: `{ id, author, content, created_at, updated_at }` |
| `comments_count` | Number of notes attached to this task |
| `update_line` | Human-readable string of the last change (e.g. "updated by user") |
| `updated_at` | ISO timestamp of last update |
| `created_at` | ISO timestamp of creation |
| `completed_at` | ISO timestamp when status was set to closed; retained after re-opening |


---

## Edit Behaviour Summary

- **Enter** while editing → save and add a new task immediately below; enter edit mode on the new task.
- **Escape** while editing → discard changes and return to command mode.
- **Ctrl+Enter** → save multi-line content.
- **Shift+Enter** → insert a line break within the task (first one activates multi-line mode; subsequent Enter keys also insert breaks until Ctrl+Enter saves).
- **Alt+Enter** → split the task at the cursor into two tasks.


---

## Integrations (reference; require backend or browser extension)

| Integration | Description |
|---|---|
| **Email-to-list** | Every list has a unique email address; emailing it creates a task (subject → content, body → note, attachments → attached files) |
| **Web Clipper** | Chrome/Firefox extension to clip web pages, Gmail, Jira, YouTrack, Zendesk, GitHub into a list |
| **Slack** *(PRO)* | "Save for Later" Slack messages automatically appear as tasks in a designated list |
| **Zapier** | Connect Checkvist to hundreds of services via Zapier recipes/zaps |
| **Google Calendar** *(PRO)* | 2-way sync of due-dated tasks as calendar events |
| **iCalendar feed** *(PRO)* | Read-only iCal subscription for Apple Calendar, Outlook, etc. |
| **Chrome extension** | Checkvist as a browser popup window (no dedicated tab required) |
| **Firefox extension** | Checkvist as a browser popup or sidebar |
| **Mobile PWA** | Progressive web app at m.checkvist.com for on-the-go access (online/offline) |
| **Open API** | Fully documented REST API for custom integrations |
| **Voice / Note to self** | Android "Note to self" forwarded via Gmail filter to a list's email address |


---

## First-Run Defaults

On first launch with no data, create a default list named "My Tasks" pre-populated with sample tasks that demonstrate:
- Multi-level nesting (at least 3 levels deep)
- A completed task (to show the completed state)
- A task with a due date (today or tomorrow)
- A task with a tag
- A task with a note
- A task with a priority color
