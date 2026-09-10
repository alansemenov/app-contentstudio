Specifications for Voice support in Content Studio branded as Juke


Goal
Voice assistant in Content Studio which understands and responds to specific voice commands in the browser by executing editorial actions already supported by the Content Studio.

Requirements:
Juke Operator (app-ai-content-operator) must be installed but voice analyser and mcp server should be located inside the Content Studio itself. This way we won’t have to solve communication between the Juke app and Content Studio. The Juke app will be used in later milestones for generation of sample input values in content edit mode.
No voice processing should happen if the Juke Operator is not installed.
Microphone should be enabled in the browser.

Milestone 1
Juke goes in and out of voice mode by reacting to fixed commands.
Juke goes to “dialog mode” after a specific command: “Hello, Juke”. This is visualised by the Juke icon appearing in the bottom right corner of Content Studio.
The Juke icon should animate when accepting voice commands and when answering, two different types of animation.
Juke closes the “dialog mode” after a specific command: “Goodbye, Juke”. The Juke icon then disappears.

Use case 1:
User: “Hello, Juke”
Juke: “Hello, <username>. What can I help you with today?”

Use case 2:
User: “Goodbye, Juke”.
Juke: “Goodbye, <username>. See you next time.”

Use case 3:
User: random command that Juke doesn’t understand
Juke: I’m not sure how to respond to this command. Please try again.

Milestone 2

Juke understands the Admin API in Content Studio and can perform specific editorial actions by reacting to voice commands:

Goal 1. Switching between projects

Command:
Go to “<project name>”

Sample answers:
If the project is not found: “I cannot find project <project name> in the system. Please try a different project.”
If the project is found: “Switching to “<project name>””

Expected action:
Juke switches to the required project, without opening the project selection dialog.

APIs:
Fetch the list of projects: project/list

Code to investigate: ProjectSelectionDialog.tsx

Goal 2. Create a new content

Command:
“Create a new <content type>”, for example “Create a new blog”.

Sample answers:
If the content type is found: “Creating a new <content type>” (if <content type> exists in the system - listed in the “New Content” dialog)
If the content type is not found: “I cannot find <content type> in the system”. Make sure it exists.

Expected action:
Juke creates a new content of the required type and opens a new browser tab for editing the new content.

APIs:
Fetch the list of content types: schema/filter/contentTypes
Create a new content: content/create

Code to investigate: ContentEventsProcessor.handleNew()

Milestone 3

Goal 1.	Perform search by applying the filter. This assumes that Juke studies current aggregations in the filter panel before producing a response. User can combine several filter parameters in the same command

Search mode will be triggered with the command “New Search”.
Juke should in this case reset the filter (if it’s applied) and answer “What are you looking for?”

Sample commands when the search mode is on:
“Content type <content type>” - select the requested type under “Content Type” parameter of the filter panel
“Last modified by me” or “Last modified by <user name>” - select user name under “Last modified by” parameter of the filter panel
“Last modified today” - select “< 1 day” under “Last modified” parameter of the filter panel
“Last modified this week” - select “< 1 week” under “Last modified” parameter of the filter panel
“In progress” - select “in progress” under “Workflow”
Any command that doesn’t start with “content type”, “last modified by”, “last modified today”, “last modified this week” or “in progress” should be considered keywords for the free text search.

Performing a search should automatically close the search mode so that the user can start working with the found content. To perform a new search the user should say “New Search” again.

Sample answer:
I couldn’t find any content items matching your criteria. Try a different search”
“I found <X> content items matching your criteria. Do you want to see them?”

If user answers “yes” to the “Do you want to see them” question, Juke should:
Open the filter panel
Fill in the filter parameters required by the user
Apply the filter
The search should produce exactly the same number of items as what Juke claimed he found.

Goal 2. Select or unselect content items currently displayed in the content list. This can be unfiltered or filtered list.

Sample commands:
“Select the top one”
“Select the first one”
“Select the bottom one”
“Select the last one”
“Select the third one”
“Select the third one from the bottom”
“Select all”
“Select <part of the display name>”
“Unselect”

Sample answer:
1 item selected. What do you want me to do with it?
<X> items selected. What do you want me to do with them?
All items are unselected.

APIs:
Get aggregations for the search: content/query, with aggregationQueries field provided
Perform search: content/query, with query field provided

Code to investigate: /v6/features/search

Milestone 4

Goal: Apply actions from the toolbar to items selected in the list.

Supported commands are:
Edit
Delete
Move
Duplicate
Preview

Edit
Will open selected item(s) for edit - one browser tab for each

Code to investigate: ContentEventsProcessor.handleEdit()

Delete
Juke should ask: “Are you sure you want to delete <display name>” (if 1 item is selected) or “Are you sure you want to delete <X> items” (if more than one selected)

If the user responds with “No” or “Cancel”, Juke won’t do anything.
If the user responds with “Yes”, Juke should delete the selected items and respond with “Selected content is deleted”.


Code to investigate: v6/features/delete


Move

Juke should ask: “Where do you want to move the selected content?”

Case 1:
User responds with part of or entire display name of the content which will be the new parent.
Juke should then perform free-text search based on the provided keyword to find the new parent in the current project.
If and only if one item is found, Juke should then move the selected item(s) under the new parent and respond with “Selected content is moved”.

Case 2:
User responds with “Cancel”. Juke doesn’t do anything.

Code to investigate: /v6/features/move


Duplicate

Juke should ask: “Do you want to include child items of the selected content when creating duplicates”

Case 1:
User responds with “Yes”.
Juke creates duplicates of all the selected items, including their children, then responds with “Selected content is duplicated with all the children”

Case 2:
User responds with “No”.
Juke creates duplicates of all the selected items, excluding their children, then responds with “Selected content is duplicated without the children”

Case 3:
User responds with “Cancel”.
Juke doesn’t do anything.

Code to investigate: /v6/features/duplicate



Preview

Juke opens a browser tab with a preview of each of the selected item, if this item can be previewed. If not, bypass that item.

Code to investigate: PreviewActionHelper.ts

