# Voice Support in Content Studio (branded as Juke)

## Goal

A voice assistant in Content Studio which understands and responds to specific voice commands in the browser
by executing editorial actions already supported by Content Studio.

## Requirements

- Juke Operator (`app-ai-content-operator`) must be installed, but the voice analyser and the command module
  should be located inside Content Studio itself. This way we won't have to solve communication between the
  Juke app and Content Studio. The Juke app will be used in later milestones for generation of sample input
  values in content edit mode.
- No voice processing should happen if the Juke Operator is not installed.
- Microphone should be enabled in the browser.

## Milestone 1 — Voice mode

Juke goes in and out of voice mode by reacting to fixed commands.

- Juke enters "dialog mode" after a specific command: **"Hello, Juke"**. This is visualised by the Juke icon
  appearing in the bottom right corner of Content Studio.
- The Juke icon should animate when accepting voice commands and when answering, with two different types of
  animation.
- Juke closes the "dialog mode" after a specific command: **"Goodbye, Juke"**. The Juke icon then disappears.

### Use cases

| # | User says | Juke answers |
|---|---|---|
| 1 | "Hello, Juke" | "Hello, <username>. What can I help you with today?" |
| 2 | "Goodbye, Juke" | "Goodbye, <username>. See you next time." |
| 3 | A random command Juke doesn't understand | "I'm not sure how to respond to this command. Please try again." |

## Milestone 2 — Admin API actions

Juke understands the Admin API in Content Studio and can perform specific editorial actions by reacting to
voice commands.

### Goal 1: Switching between projects

**Command:** "Go to <project name>"

**Sample answers:**

- Project not found: "I cannot find project <project name> in the system. Please try a different project."
- Project found: "Switching to <project name>"

**Expected action:** Juke switches to the required project, without opening the project selection dialog.

**APIs:**

- Fetch the list of projects: `project/list`

**Code to investigate:** `ProjectSelectionDialog.tsx`

### Goal 2: Create a new content

**Command:** "Create a new <content type>", for example "Create a new blog".

**Sample answers:**

- Content type found (listed in the "New Content" dialog): "Creating a new <content type>"
- Content type not found: "I cannot find <content type> in the system. Make sure it exists."

**Expected action:** Juke creates a new content of the required type and opens a new browser tab for editing
the new content.

**APIs:**

- Fetch the list of content types: `schema/filter/contentTypes`
- Create a new content: `content/create`

**Code to investigate:** `ContentEventsProcessor.handleNew()`

## Milestone 3 — Search and tree navigation

### Goal 1: Perform search by applying the filter

This assumes that Juke studies current aggregations in the filter panel before producing a response. The user
can combine several filter parameters in the same command.

Search mode is triggered with the command **"New Search"**. Juke should then reset the filter (if applied) and
answer "What are you looking for?"

**Sample commands when search mode is on:**

| Command | Filter panel action |
|---|---|
| "Content type <content type>" | Select the requested type under "Content Type" |
| "Last modified by me" or "Last modified by <user name>" | Select the user under "Last modified by" |
| "Last modified today" | Select "< 1 day" under "Last modified" |
| "Last modified this week" | Select "< 1 week" under "Last modified" |
| "In progress" | Select "in progress" under "Workflow" |

Any command that doesn't start with "content type", "last modified by", "last modified today", "last modified
this week" or "in progress" should be considered keywords for the free text search.

Performing a search should automatically close the search mode so that the user can start working with the
found content. To perform a new search the user should say "New Search" again.

**Sample answers:**

- "I couldn't find any content items matching your criteria. Try a different search."
- "I found <X> content items matching your criteria. Do you want to see them?"

If the user answers "yes" to the "Do you want to see them?" question, Juke should:

1. Open the filter panel.
2. Fill in the filter parameters required by the user.
3. Apply the filter.

The search should produce exactly the same number of items as what Juke claimed it found.

**APIs:**

- Get aggregations for the search: `content/query`, with the `aggregationQueries` field provided
- Perform search: `content/query`, with the `query` field provided

**Code to investigate:** `/v6/features/search`

### Goal 2: Expand and collapse items in the tree

**Commands:** "Expand <content name>", "Collapse <content name>"

**Requirement:** The item must already be loaded and visible in the tree structure.

**Sample answers:**

- Item found and state changes: "Expanding <name>" / "Collapsing <name>"
- Item already in the requested state: "<name> is already expanded" / "<name> is already collapsed"
- Item not visible in the tree: "I can't see <name> in the tree."

**APIs:** none. Expanding and collapsing is pure client-side tree state; Juke makes no REST calls for it.

**Code to investigate:** `v6/entities/content/model/content-tree.store.ts`

> Selecting items by voice was dropped from this milestone (2026-09-13). Its only purpose was to feed the
> toolbar actions, which now name their target directly (see Milestone 4).

## Milestone 4 — Toolbar actions on a spoken target

**Goal:** Apply actions from the toolbar to the item the user names in the command.

Supported actions: **Edit**, **Delete**, **Move**, **Duplicate**, **Preview**.

**Command form:** "<action> <target>", for example "Duplicate the top one", "Move the bottom one",
"Edit <content name>".

**Targets:**

| Target | Examples | Meaning |
|---|---|---|
| Position | "the top one", "the first one", "the third one", "the last one", "the bottom one", "the third one from the bottom" | The nth item of the list currently displayed (unfiltered or filtered) |
| Name | "<part of the display name>" | The item with that display name, first among the visible items, otherwise anywhere in the project |
| Implicit | "it", "them", "the selected", or the bare action | The items currently selected with the mouse |
| All | "all" | All items currently displayed (preview and edit; delete and duplicate ask for confirmation with the count) |

One target per command.

### Edit

Opens the target item(s) for editing, one browser tab for each.

**Code to investigate:** `ContentEventsProcessor.handleEdit()`

### Delete

Juke asks "Are you sure you want to delete <display name>?" for one item, or "Are you sure you want to delete
<X> items?" for several.

- User responds "No" or "Cancel": Juke does nothing.
- User responds "Yes": Juke deletes the item(s) and responds "Selected content is deleted."

**Code to investigate:** `v6/features/delete`

### Move

Juke asks "Where do you want to move <display name>?"

- **Case 1:** The user responds with part of or the entire display name of the content that will be the new
  parent. Juke performs a free-text search based on the provided keyword to find the new parent in the current
  project. If and only if one item is found, Juke moves the target item(s) under the new parent and responds
  "<display name> is moved under <parent name>."
- **Case 2:** The user responds "Cancel". Juke does nothing.

**Code to investigate:** `/v6/features/move`

### Duplicate

Juke asks "Do you want to include child items of <display name> when creating the duplicate?"

- **Case 1:** The user responds "Yes". Juke duplicates the item(s) including their children, then responds
  "<display name> is duplicated with all the children."
- **Case 2:** The user responds "No". Juke duplicates the item(s) excluding their children, then responds
  "<display name> is duplicated without the children."
- **Case 3:** The user responds "Cancel". Juke does nothing.

**Code to investigate:** `/v6/features/duplicate`

### Preview

Juke opens a browser tab with a preview of each target item that can be previewed. Items that cannot be
previewed are skipped.

**Code to investigate:** `PreviewActionHelper.ts`
