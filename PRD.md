# Juke Voice Assistant for Content Studio — PRD

Source spec: `SPECS.md`. This document turns the spec into decisions, architecture and an implementation plan.
It is the working reference for development; update it when a decision changes.

## 1. Summary

Juke is a voice assistant inside Content Studio's browse view. It listens continuously through the browser
microphone, wakes on "Hello, Juke", executes editorial actions the UI already supports (switch project, create
content, search, select, edit, delete, move, duplicate, preview) and answers by voice. It is only active when the
Juke Operator app (`com.enonic.app.ai.contentoperator`) is installed and running; in milestones 1–4 the operator
is not used functionally, only as a gate.

## 2. Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Speech to text / text to speech | Browser Web Speech API: `SpeechRecognition` (webkit-prefixed) and `speechSynthesis` | No backend, no credentials. Content Studio has no LLM access; the operator's Gemini config stays in the operator. |
| Command understanding | Deterministic command mapper inside Content Studio (`v6/features/juke`). No MCP, no LLM. | User clarification: "mcp server" meant a voice-command-to-action module living in CS. |
| Name matching | Case-insensitive, punctuation-normalized, best unique match (exact > prefix > containment). Ambiguity is reported as not found. | Tolerates recognition errors without picking wrong items. |
| Wake word | Always listening while the browse page is open. | Matches the spec. |
| Scope | Browse view only for milestones 1–4. Later milestones will add voice integration with Juke Operator and Juke Translator, so the command registry must be extensible and the widget must be mountable in wizard mode later. | User clarification. |
| Operator gate | `$config.aiEnabled && $config.browseMode` from `shared/config/config.store.ts`. On the browse page the server sets `aiEnabled` only from the operator's running state (`main.js` `getParams`). | No new server code; reflects "installed and running". The v6 boundary rules forbid `features/juke` importing `features/ai`, so the AI host's registered-plugins store cannot be used. |
| Create content | Follow the spec: POST `content/create`, then open the edit tab for the created id. Parent is the single selected item, otherwise project root. | Spec explicitly names `content/create`. The existing `NewContentEvent` flow only opens a `/new/<type>` tab without creating. |
| Icon | Reuse `v6/shared/ui/icons/JukeIcon.tsx` | Same branding as the operator toggle in the wizard toolbar. |
| Icon animations | Accepting commands: "breathe" (slow scale 1→1.06 with a green glow and a faint ring, 2.6 s loop). Answering: "bars" (four-bar equalizer pill to the left of the icon, icon bobs). Glow color is theme-aware: deep green on light, pale mint `#a2ffbd` on dark. Icon size 64 px, fixed bottom-right. | Chosen by the user on 2026-09-10 in the voice picker; pale mint alone was invisible on the light theme. |
| Language | English only (`en-US`) for recognition and synthesis. | Spec phrases are English; can be made configurable later. |
| Voice | `speechSynthesis` voice "Google UK English Male" (`en-GB`, online). Fallback: first `en-GB` voice, then first `en` voice. Rate and pitch 1.0 unless tuned later. | Chosen by the user on 2026-09-10 with the voice picker. |
| Delivery | Feature branch `juke-voice` off `master`, one or a few commits per milestone. Jar renamed to `hackathon.jar` (done). | User choice. |
| Code location | All new code under `modules/lib/src/main/resources/assets/js/v6/features/juke/` (Preact, strict TS, Tailwind, nanostores). Legacy `app/` is called into, never extended. | Project CLAUDE.md. |
| Localization | All spoken and displayed strings in `phrases.properties` under `juke.*` keys. | Project convention. |

## 3. Runtime and constraints

- Web Speech API availability: Chrome and Edge (cloud-backed recognition), Safari (on-device). Firefox has no
  `SpeechRecognition`; Juke stays fully hidden there and logs once to the console.
- Chrome ends continuous recognition on silence, network hiccups and roughly every 60 s. The listener must
  restart automatically on `onend` unless stopped deliberately, with back-off after consecutive errors.
- The `not-allowed` error (microphone denied) must stop the restart loop and show a one-time warning via
  lib-admin-ui `showWarning`.
- Speaking while listening: recognition picks up Juke's own voice. Recognition is paused while `speechSynthesis`
  is speaking and resumed on `onend` of the utterance.
- The browse page runs a strict CSP (`main.js` `applySecurityPolicy`). Web Speech API needs no `connect-src`
  changes. No new outbound endpoints are added.
- Microphone permission requires a secure context (https or localhost).
- Vitest is the test runner (`pnpm -C ./modules/lib run test:run`). Web Speech objects are mocked in tests.

## 4. Architecture

```
v6/features/juke/
  index.ts                     public surface: startJukeService(), JukeWidget, read-only computed views,
                               registerCommands() and command types for later milestones
  model/
    juke.store.ts              $jukeMode ('off' | 'idle' | 'dialog'), $jukeActivity ('listening' | 'speaking'),
                               $jukePrompt (pending prompt, see below), $jukeTranscript (last phrase, diagnostic),
                               $jukeSpeechSupported, $jukeAvailable (computed: aiEnabled && browseMode && supported),
                               $isJukeVisible; getJukeContext() builds the JukeContext for commands
    juke.service.ts            start()/stop(); subscribes to $jukeAvailable, owns recognizer + speaker,
                               routes transcripts to the registry, speaks replies one at a time (queue),
                               pauses recognition while speaking; deps injectable for tests
  speech/
    support.ts                 minimal SpeechRecognition types, getRecognitionCtor(), getSynthesis(), isSpeechSupported()
    recognizer.ts              createRecognizer(handlers): continuous, final-only, 3 alternatives, auto-restart
                               with back-off on network errors, pause()/resume(), stops for good on not-allowed
    speaker.ts                 createSpeaker(): speak(text) -> Promise<void>, pickVoice() (Google UK English Male >
                               en-GB > en), safety timeout for utterances whose end never fires
    normalize.ts               lowercase, drop apostrophes, strip punctuation, collapse whitespace
  commands/
    command.types.ts           JukeMode, JukePrompt, JukeContext, JukeReply { say, mode?, prompt? },
                               JukeCommand { id, modes, prompts?, match(text, ctx) -> args | null, run(args, ctx) }
    command.registry.ts        ordered registry: registerCommands(), resolveCommand(alternatives, ctx)
    session.commands.ts        hello / goodbye (M1); JUKE_NAME_PATTERN with recognition variants
    matching.ts                (M2) bestUniqueMatch(candidates, spoken) with exact > prefix > containment
    project.commands.ts        (M2) "go to <project>"
    content.commands.ts        (M2) "create a new <content type>"
    search.commands.ts         (M3) "new search", filter phrases, keywords, "yes" to show results
    select.commands.ts         (M3) select/unselect by position, name, all
    toolbar.commands.ts        (M4) edit, delete, move, duplicate, preview with confirmation prompts
  ui/
    JukeWidget.tsx             fixed bottom-right icon; visible only in 'dialog' mode; "breathe" while listening,
                               equalizer "bars" pill while speaking; keyframes/utilities live in assets/styles/tailwind.css
```

Unknown phrases are handled by the service, not a command: in `dialog` mode they get the unknown reply, in
`idle` mode they are ignored.

### 4.1 State machine

```
off      microphone not started (operator missing, unsupported browser, permission denied)
idle     listening, only "hello juke" is recognized; no icon
dialog   icon visible; commands accepted; "goodbye juke" returns to idle
```

Within `dialog`, a `PendingPrompt` narrows what the next utterance means:

| Pending prompt | Set by | Accepts |
|---|---|---|
| `search` | "New search" | filter phrases and keywords until a search is performed |
| `showResults` | search finished with hits | "yes" (apply filter and open panel) or anything else (dismiss) |
| `confirmDelete` | "Delete" | yes / no / cancel |
| `moveTarget` | "Move" | cancel or a display-name keyword |
| `duplicateChildren` | "Duplicate" | yes / no / cancel |

Session commands ("goodbye juke") always win over pending prompts. An unrecognized phrase in a pending prompt
cancels the prompt (except `search`, where it becomes free-text keywords) and answers with the fallback phrase.

### 4.2 Recognizer behaviour

- `continuous = true`, `interimResults = false`, `lang = 'en-US'`, `maxAlternatives = 3`.
- Wake word matching runs over all alternatives; commands use the first alternative, falling back to others
  if the first does not match any command.
- Wake and sleep phrases accept common recognition variants: "hello juke", "hello, juke", "hello duke",
  "hello jook", "hey juke"; "goodbye juke", "good bye juke", "bye juke".
- Recognition is paused while speaking; utterances recognized within 300 ms after speech ends are discarded.

### 4.3 Integration points (existing code, called not modified)

| Need | Existing API |
|---|---|
| Operator installed | `$aiRegisteredPlugins` in `features/ai/ai.store.ts` (export through `features/ai/index.ts` if not already) |
| Current user name | `$config.get().user?.getDisplayName()` (`shared/config/config.store.ts`) |
| Projects list, switch | `$projects`, `selectProject(project)` in `entities/project` (`projects.store.ts:395`); dialog stays closed |
| Content types for New Content | `fetchContentTypesByContent` / `fetchAllContentTypes` in `entities/schema/api/contentTypes.api.ts` |
| Create content | new v6 wrapper `createContent()` in `entities/content/api` calling `getCmsApiUrl('create')`, body as in legacy `app/resource/CreateContentRequest.ts` |
| Open edit tab | `ContentUrlHelper.openEditContentTab()` (`app/util/ContentUrlHelper.ts`) or `new EditContentEvent([summary]).fire()` |
| Filter panel | `setContentFilterOpen`, `setContentFilterValue`, `setContentFilterSelection`, `resetContentFilter` in `features/search/model/contentFilter.store.ts`; aggregation names in `app/browse/filter/ContentAggregation.ts` (`contentTypes`, `workflow`, `lastModified`, `modifier`) |
| Count hits without applying | `queryContent` in `entities/content/api/contentQuery.api.ts` with the same query the filter panel would build (`ContentBrowseFilterPanel.doSearch`) |
| Displayed list order | `$activeFlatNodes` in `entities/content/model/active-tree.store.ts` (`node.id`, `node.data.displayName`) |
| Selection | `setSelection(ids)`, `clearSelection()`, `selectAll()`, `getCurrentItems()`, `$selectionCount` in `entities/content/model/content-selection.store.ts` |
| Delete | `openDeleteDialog(items)` then `executeDeleteDialogAction()` after `$isDeleteDialogReady`, or `archiveContent`/`deleteContent` in `features/delete/api/delete.api.ts` |
| Move | `moveContent(contentIds, parentPath)` in `features/move/api/move.api.ts`; parent lookup via `queryContent` free-text search |
| Duplicate | `duplicateContent(params)` in `features/duplicate/api/duplicate.api.ts` with `includeChildren` |
| Preview | `PreviewActionHelper.openWindows(contents, $activeWidget.get())` (`app/action/PreviewActionHelper.ts`), skip items where `getUrl` is empty / not previewable |
| Widget mount | `pages/browse/BrowseAppShell.tsx` next to the app-level dialogs |
| Notifications | `showWarning` from `@enonic/lib-admin-ui/notify/MessageBus` |

Toolbar actions are executed through the same feature APIs the dialogs use so that task progress, events and
list refresh behave as if the user had clicked. Dialogs themselves are not opened; Juke's spoken confirmation
replaces the dialog confirmation step.

## 5. Milestones and acceptance criteria

### Milestone 1 — Voice session

Phrases (`phrases.properties`):
- `juke.reply.hello=Hello, {0}. What can I help you with today?`
- `juke.reply.goodbye=Goodbye, {0}. See you next time.`
- `juke.reply.unknown=I'm not sure how to respond to this command. Please try again.`

Acceptance:
- With operator running and a supported browser, the microphone starts on browse page load (permission prompt
  shown once). Without operator: no microphone access, no icon, no code runs beyond the availability check.
- "Hello, Juke" shows the Juke icon bottom-right and speaks the hello reply with the user's display name.
- While listening in dialog mode the icon uses the "breathe" animation; while speaking it shows the "bars"
  equalizer pill (see Decisions). Both respect `prefers-reduced-motion`.
- "Goodbye, Juke" speaks the goodbye reply, then hides the icon and returns to idle listening.
- Any other phrase in dialog mode gets the unknown reply. Phrases in idle mode are ignored.
- Unit tests for normalization, wake/sleep matching, state transitions, and recognizer restart logic with a
  mocked `SpeechRecognition`.

### Milestone 2 — Projects and content creation

Phrases:
- `juke.reply.project.switching=Switching to "{0}"`
- `juke.reply.project.notFound=I cannot find project {0} in the system. Please try a different project.`
- `juke.reply.content.creating=Creating a new {0}`
- `juke.reply.content.typeNotFound=I cannot find {0} in the system. Make sure it exists.`

Acceptance:
- "Go to <name>" matches against project display names (and project ids as a fallback) using best unique
  match, calls `selectProject` without opening the dialog, and speaks the switching reply with the resolved
  display name.
- "Create a new <type>" matches against the content types the New Content dialog would list for the current
  parent (selected item or root), POSTs `content/create` with generated name `__unnamed__`-style as the wizard
  does, opens a new browser tab for editing the created content, and speaks the creating reply with the type's
  display name.
- Both commands answer with the not-found phrase on no match or ambiguous match.
- Unit tests for the matcher and both commands with mocked stores and fetch.

### Milestone 3 — Search and selection

Phrases:
- `juke.reply.search.start=What are you looking for?`
- `juke.reply.search.none=I couldn't find any content items matching your criteria. Try a different search.`
- `juke.reply.search.found=I found {0} content items matching your criteria. Do you want to see them?`
- `juke.reply.select.one=1 item selected. What do you want me to do with it?`
- `juke.reply.select.many={0} items selected. What do you want me to do with them?`
- `juke.reply.select.none=All items are unselected.`

Search acceptance:
- "New search" resets the filter (if applied), enters `search` prompt and speaks the start reply.
- In `search` prompt, each utterance is parsed left to right into criteria; several may appear in one
  utterance: `content type <x>`, `last modified by me|<user>`, `last modified today`, `last modified this week`,
  `in progress`. Anything else becomes free-text keywords.
- After each utterance Juke runs `content/query` with the same query the filter panel would produce (keywords,
  content type bucket, modifier bucket, lastModified range, workflow bucket) and answers with none/found.
  "Found" enters the `showResults` prompt and leaves `search`.
- "Yes" to `showResults` opens the filter panel, writes value and selection into `$contentFilterState`, so the
  list applies the same filter. Hit count in the panel equals the spoken number. Any other answer dismisses.
- Aggregation bucket keys are resolved from a `content/query` with `aggregationQueries` so that content type,
  modifier and workflow buckets use the exact keys the panel expects (content type name, principal key,
  workflow state).

Selection acceptance:
- Positional commands operate on `$activeFlatNodes` order: first/top, last/bottom, ordinal (`second`, `third`,
  ... `tenth`, and digits), `<ordinal> from the bottom`.
- "Select all" calls `selectAll()`; "Unselect" calls `clearSelection()`.
- "Select <name>" uses best unique match against `displayName` of loaded nodes; ambiguous or no match answers
  with the unknown reply.
- Replies use the resulting `$selectionCount`.

### Milestone 4 — Toolbar actions on the selection

Phrases:
- `juke.reply.delete.confirmOne=Are you sure you want to delete {0}?`
- `juke.reply.delete.confirmMany=Are you sure you want to delete {0} items?`
- `juke.reply.delete.done=Selected content is deleted.`
- `juke.reply.move.where=Where do you want to move the selected content?`
- `juke.reply.move.done=Selected content is moved.`
- `juke.reply.duplicate.children=Do you want to include child items of the selected content when creating duplicates?`
- `juke.reply.duplicate.doneWith=Selected content is duplicated with all the children.`
- `juke.reply.duplicate.doneWithout=Selected content is duplicated without the children.`
- `juke.reply.noSelection=No content is selected.` (defensive, not in spec)

Acceptance:
- All five commands require a non-empty selection; otherwise the no-selection reply.
- Edit: one edit tab per selected item.
- Delete: confirmation prompt with display name or count; "yes" executes delete/archive through the delete
  feature API and speaks done; "no"/"cancel" does nothing.
- Move: asks where; a keyword answer runs free-text `content/query` in the current project; exactly one hit
  moves the selection under it and speaks done; zero or several hits answer with the unknown reply; "cancel"
  does nothing. Selected items themselves are excluded from parent candidates.
- Duplicate: asks about children; yes/no duplicates with or without children and speaks the matching reply;
  "cancel" does nothing.
- Preview: opens one tab per previewable item via `PreviewActionHelper.openWindows`, skipping non-previewable
  items silently.

## 6. Non-goals (milestones 1–4)

- No LLM, no MCP, no server-side speech processing, no new server endpoints.
- No wizard/editor tab support.
- No multi-language recognition.
- No functional use of the Juke Operator or Juke Translator.
- No settings UI for enabling/disabling Juke.

## 7. Risks

- Continuous recognition reliability in Chrome (auto-stop, network dependency). Mitigated by restart loop and
  back-off; a visible fallback is a click on the icon area to restart listening.
- Recognition of "Juke" as "Duke"/"Jook"; mitigated by wake-word variants and alternatives.
- Spec phrasing "Creating a new X" implies `content/create`; creating unnamed content leaves an empty item if the
  user closes the tab without saving, which the wizard flow avoids. Accepted per spec.
- Hit count parity between Juke's `content/query` and the filter panel depends on building an identical query;
  covered by reusing the panel's query builder where possible.

## 8. Implementation plan

Branch: `juke-voice`. Verify each step with `pnpm -C ./modules/lib run check` and `test:run`; deploy with
`./gradlew deploy -x test -Penv=dev` to the `juke` sandbox for manual voice testing in Chrome.

1. **Milestone 1** (commit "Add Juke voice session with wake and sleep commands")
   - `features/juke` skeleton: store, recognizer, speaker, normalize, registry, session commands, widget.
   - Mount `JukeWidget` in `BrowseAppShell.tsx`; start `startJukeService()` from `App.tsx` service startup.
   - Export operator-registered flag from `features/ai/index.ts` if missing.
   - Phrases for M1; unit tests.
2. **Milestone 2** (commit "Add Juke commands for project switching and content creation")
   - `matching.ts`; project command; v6 `createContent` API wrapper; content-type command; phrases; tests.
3. **Milestone 3** (commit "Add Juke search and selection commands")
   - Search prompt parser, query builder shared with filter panel, aggregation key resolution, show-results
     flow; selection commands over `$activeFlatNodes`; phrases; tests.
4. **Milestone 4** (commit "Add Juke toolbar commands: edit, delete, move, duplicate, preview")
   - Confirmation prompts, five toolbar commands via feature APIs, preview via `PreviewActionHelper`; phrases;
     tests.
5. After each milestone: manual verification checklist in Chrome on the `juke` sandbox, then pause for review.
