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
| Hackathon branding | App key is `com.enonic.app.hackathon` (Gradle `app.name`), so it installs next to the original Content Studio. JAX-RS group `v2hackathon` and REST root `/admin/rest-v2/hackathon/` (server `ResourceConstants`, client `shared/lib/url/cms.ts` and legacy `UrlHelper`) avoid clashing with the original's `/admin/rest-v2/cs/`. `AdminSiteHandler`, `ContentIconUrlResolver` and `LiveEditInjection` use the new key. OSGi `configurationPid` stays `com.enonic.app.contentstudio` so the same `.cfg` applies; XP `app.config` reads `com.enonic.app.hackathon.cfg`. Display name is "AI Hackathon" (descriptors and all `phrases*.properties` locales). `main.svg` and `application.svg` show the tree with the Juke head as a bottom-right badge. Jar is `hackathon.jar`. Extensions owned by a sibling Content Studio installation (`entities/extension/lib/siblingExtensions.ts`, keys `com.enonic.app.contentstudio` / `com.enonic.app.hackathon` other than `config.appId`) are dropped in both extension fetch paths (v6 `fetchExtensions`, legacy `GetExtensionsByInterfaceRequest`), so previews, context widgets and settings from the other app never show up while third-party extensions do. The sidebar matches its own main and settings items by `config.appId`; the settings extension declares the private `hackathon.menuitem` interface (the main tool loads both) so the original app does not list it either. Custom XP event names still use the `com.enonic.app.contentstudio.*` prefix and are shared with the original app. | User request on 2026-09-10, to run this build side by side with the original Content Studio on the same XP. |
| Build tests | `hackathonTestsOnly=true` in `gradle.properties` disables all Java `Test` tasks in `modules/app` and limits the Gradle `pnpmTest` task to `features/juke`. Set to `false` to restore the full suite. | User request on 2026-09-10 to keep hackathon builds fast; temporary. |

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
    smalltalk.commands.ts      (M1) conversational replies in dialog mode: how are you, help, what can you do,
                               who are you, thanks, nice to meet you, good morning/afternoon/evening, bare hello
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

### Milestone 1 — Voice session (done, commits `322a99a`..`5e3d7c2` on `juke-voice`)

Phrases (`phrases.properties`). Greetings carry no comma before the name: speech synthesis turns a comma into
an audible pause.
- `juke.reply.hello=Hello {0}. What can I help you with today?`
- `juke.reply.goodbye=Goodbye {0}. See you next time.`
- `juke.reply.unknown=I'm not sure how to respond to this command. Please try again.`
- `juke.notify.micDenied=Juke cannot hear you: microphone access is blocked for this site.`
- `juke.widget.listening` / `juke.widget.speaking` (aria labels of the widget)
- Small talk (dialog mode only), each with the user's name as `{0}`:
  `juke.reply.smalltalk.howAreYou`, `.help`, `.capabilities`, `.whoAreYou`, `.thanks`, `.niceToMeetYou`,
  `.goodMorning`, `.goodAfternoon`, `.goodEvening`, `.greeting`

Behaviour:
- Availability: `$config.aiEnabled && $config.browseMode` and Web Speech API present. Otherwise no microphone
  access, no icon, and the service stays off.
- With the operator running and a supported browser, the microphone starts on browse page load (permission
  prompt shown once). If access is denied, Juke turns off and shows one lib-admin-ui warning.
- Idle mode listens for the wake phrase only. Accepted: "hello|hey|hi" + "juke|jukes|duke|jook|jude|jules|juno".
  Everything else is ignored silently.
- "Hello, Juke" switches to dialog mode, shows the icon bottom-right and speaks the hello reply with the user's
  display name. Saying it again in dialog mode greets again.
- In dialog mode a leading address is stripped before matching ("hey juke, how are you" → "how are you";
  "juke, select all" → "select all"), so a command spoken together with the name reaches the command. A bare
  wake phrase is left intact.
- Small talk in dialog mode: how are you, help requests ("I'd like some help with Content Studio", "can you help
  me"), what can you do, who are you, thanks, nice to meet you, good morning/afternoon/evening, bare hello.
  The capabilities reply lists the M2–M4 features ahead of their delivery.
- "Goodbye, Juke" (also "bye juke", "see you juke") speaks the goodbye reply, then hides the icon and returns to
  idle listening. Session commands win over small talk and over any pending prompt.
- Any other phrase in dialog mode gets the unknown reply.
- Replies are spoken one at a time through a queue. Recognition is paused while speaking and resumed 300 ms
  after the utterance ends, so Juke never transcribes itself.
- Voice: "Google UK English Male", falling back to the first `en-GB` voice, then the first `en` voice. Rate and
  pitch 1.0. Utterances resolve on `end`, `error`, or a safety timeout of max(3 s, 120 ms per character).
- Recognizer: continuous, final results only, 3 alternatives, `en-US`. Restarts on every `end` while active;
  backs off 1 s → 10 s after `network`/`audio-capture` errors, resets after a result; stops for good on
  `not-allowed`/`service-not-allowed`. Later alternatives are tried when the first does not match a command.
- Widget: 64 px Juke icon fixed bottom-right, mounted in `BrowseAppShell`, appears with a fade/zoom. Listening:
  "breathe" (scale 1→1.06 with a green glow and faint ring, 2.6 s loop). Speaking: "bars" equalizer pill left of
  the icon, icon bobs. Glow is deep green on light theme and pale mint on dark. Both respect
  `prefers-reduced-motion`. Keyframes and utilities live in `assets/styles/tailwind.css`.

Tests (88, `features/juke/**/*.test.ts`): normalization; wake, sleep and address patterns; session and small
talk commands through the registry; recognizer start/restart/back-off/pause/resume/denied with a fake
`SpeechRecognition`; voice picking and speaker resolution; service state machine end to end with injected
recognizer and speaker.

Not verified manually yet: needs an XP with the Juke Operator running and `hackathon.jar` deployed (see §8).

### Milestone 2 — Projects and content creation (done)

Phrases:
- `juke.reply.project.switching=Switching to {0}`
- `juke.reply.project.notFound=I cannot find project {0} in the system. Please try a different project.`
- `juke.reply.content.creating=Creating a new {0}`
- `juke.reply.content.creatingNamed=Creating a new {0} called {1}`
- `juke.reply.content.creatingUnder=Creating a new {0} under {1}`
- `juke.reply.content.creatingNamedUnder=Creating a new {0} called {1} under {2}`
- `juke.reply.content.typeNotFound=I cannot find {0} in the system. Make sure it exists.`
- `juke.reply.content.parentNotFound=I cannot find {0} in the current project. Please try a different parent.`
- `juke.reply.content.parentAmbiguous=I found several items matching {0}. Please be more specific.`
- `juke.reply.content.failed=I could not create a new {0}. Please try again.`

Behaviour:
- Matching (`commands/matching.ts`, `bestUniqueMatch`): labels and the spoken name are normalized; tiers are
  tried in order — exact, label starts with spoken, containment either way, every spoken word in the label —
  and the first tier with hits decides. More than one hit is ambiguous and reported as not found.
- Content lookup (`commands/content-lookup.ts`, `findContentByName`): runs the browse filter's free-text query
  (fulltext + ngram over `displayName^5`, `_name^3`, `_allText`, draft branch, current project, 50 hits) via
  `queryContent`, then applies `bestUniqueMatch` over display name and name. Shared with Move in M4.
- "Go to <name>" (also "switch to", "open", "change to", "navigate to"; optional leading "the" and trailing
  "project") matches against project display names and ids from `$projects`, calls `selectProject` without
  opening the dialog and answers with the project's display name.
- "Create a new <type> [called <name>] [under <parent>]" — verbs "create", "make", "add", each followed by
  "a"/"an"/"new"; clauses "called|named|titled <name>" and "under|inside|below <parent>" in either order ("in" is not a
  parent word so names like "life in the city" stay intact).
  - Parent: the named content when given (looked up with `findContentByName`; ambiguous or missing parent
    answers with the parent phrases and creates nothing), else the single selected item, else the project root.
  - Type: the content types the New Content dialog would show for that parent via
    `ContentTypesHelper.getAvailableContentTypes`, minus media types, matched against title and local name.
  - Name: the spoken name with its first letter capitalized becomes the display name; the path name stays
    unnamed so the wizard generates it from the display name on save.
  - Creates through the legacy `CreateContentRequest` (unnamed, workflow in progress) and opens
    `/edit/<id>?displayAsNew` in a new tab via `ContentUrlHelper.openEditContentTab`, then reveals the new item
    in the browse tree with `revealContentByPath` (expands the parent chain, selects and scrolls to it). The
    reply names the type and, when given, the display name and the parent's display name.
- The edit tab is opened outside a user gesture, so browsers may block it as a pop-up; Content Studio then
  shows its standard pop-up warning. Allow pop-ups for the admin origin when demoing.
- Both commands are dialog-mode only.

Tests: parser patterns including clause order, matcher tiers and ambiguity, content lookup query and
narrowing, project switch and not-found, content creation at root, under a selected parent, under a named
parent, with a display name, media exclusion, parent not found / ambiguous, creation failure.

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
- Move: asks where; a keyword answer uses `findContentByName` (M2) in the current project; a unique match
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
