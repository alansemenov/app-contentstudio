# Juke Voice Assistant for Content Studio — PRD

Source spec: `SPECS.md`. This document turns the spec into decisions, architecture and an implementation plan.
It is the working reference for development; update it when a decision changes.

## 1. Summary

Juke is a voice assistant inside Content Studio's browse view. It listens continuously through the browser
microphone, wakes on "Hello, Juke", executes editorial actions the UI already supports (switch project, create
content, search, select, edit, delete, move, duplicate, preview) and answers by voice. It is only active when the
Juke Operator app (`com.enonic.app.ai.contentoperator`) is installed and running; in milestones 1–4 the operator
is not used functionally, only as a gate. Milestone 8 moves the voice assistant out of Content Studio into its
own application, "Juke Voice Assistant", which then becomes the gate.

## 2. Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Speech to text / text to speech | Browser Web Speech API: `SpeechRecognition` (webkit-prefixed) and `speechSynthesis` | No backend, no credentials. Content Studio has no LLM access; the operator's Gemini config stays in the operator. |
| Command understanding | Deterministic command mapper inside Content Studio (`v6/features/juke`). No MCP, no LLM. | User clarification: "mcp server" meant a voice-command-to-action module living in CS. In M8 the mapper moves to the Juke Voice Assistant app; CS keeps a typed action surface. |
| Name matching | Case-insensitive, punctuation-normalized, best unique match (exact > prefix > containment). Ambiguity is reported as not found. | Tolerates recognition errors without picking wrong items. |
| Wake word | Always listening while the browse page is open. | Matches the spec. |
| Scope | Browse view only for milestones 1–4. Later milestones will add voice integration with Juke Operator and Juke Translator, so the command registry must be extensible and the widget must be mountable in wizard mode later. | User clarification. |
| Operator gate | `$config.aiEnabled && $config.browseMode` from `shared/config/config.store.ts`. On the browse page the server sets `aiEnabled` only from the operator's running state (`main.js` `getParams`). | No new server code; reflects "installed and running". The v6 boundary rules forbid `features/juke` importing `features/ai`, so the AI host's registered-plugins store cannot be used. |
| Create content | Follow the spec: POST `content/create`, then open the edit tab for the created id. Parent is the single selected item, otherwise project root. | Spec explicitly names `content/create`. The existing `NewContentEvent` flow only opens a `/new/<type>` tab without creating. |
| Icon | Reuse `v6/shared/ui/icons/JukeIcon.tsx` | Same branding as the operator toggle in the wizard toolbar. |
| Icon animations | Accepting commands: "breathe" (slow scale 1→1.06 with a green glow and a faint ring, 2.6 s loop). Answering: "bars" (four-bar equalizer pill to the left of the icon, icon bobs). Glow color is theme-aware: deep green on light, pale mint `#a2ffbd` on dark. Icon size 64 px, fixed bottom-right. | Chosen by the user on 2026-09-10 in the voice picker; pale mint alone was invisible on the light theme. |
| Language | English only (`en-US`) for recognition and synthesis. | Spec phrases are English; can be made configurable later. |
| Voice | `speechSynthesis` voice "Google UK English Male" (`en-GB`, online). Fallback: first `en-GB` voice, then first `en` voice. Rate and pitch 1.0 unless tuned later. Recognition is `en-US`. | Chosen on 2026-09-10 with the voice picker; briefly switched to "Google US English" on 2026-09-14 and rolled back the same day (the US Google voice is female only). |
| Delivery | Feature branch `juke-voice` off `master`, one or a few commits per milestone. Jar renamed to `hackathon.jar` (done). | User choice. |
| Code location | All new code under `modules/lib/src/main/resources/assets/js/v6/features/juke/` (Preact, strict TS, Tailwind, nanostores). Legacy `app/` is called into, never extended. | Project CLAUDE.md. |
| Localization | All spoken and displayed strings in `phrases.properties` under `juke.*` keys. | Project convention. |
| Plugin repos | `/Users/ase/dev/app-ai-content-operator` and `/Users/ase/dev/app-ai-translator` may be modified for M6/M7 (protocol commands, headless generation/translation). Their `shared/ai-protocol.ts` mirrors must stay byte-identical to CS's. | User permission 2026-09-15. |
| Hackathon branding | App key is `com.enonic.app.hackathon` (Gradle `app.name`), so it installs next to the original Content Studio. JAX-RS group `v2hackathon` and REST root `/admin/rest-v2/hackathon/` (server `ResourceConstants`, client `shared/lib/url/cms.ts` and legacy `UrlHelper`) avoid clashing with the original's `/admin/rest-v2/cs/`. `AdminSiteHandler`, `ContentIconUrlResolver` and `LiveEditInjection` use the new key. OSGi `configurationPid` stays `com.enonic.app.contentstudio` so the same `.cfg` applies; XP `app.config` reads `com.enonic.app.hackathon.cfg`. Display name is "AI Hackathon" (descriptors and all `phrases*.properties` locales). `main.svg` and `application.svg` show the tree with the Juke head as a bottom-right badge. Jar is `hackathon.jar`. Extensions owned by a sibling Content Studio installation (`entities/extension/lib/siblingExtensions.ts`, keys `com.enonic.app.contentstudio` / `com.enonic.app.hackathon` other than `config.appId`) are dropped in both extension fetch paths (v6 `fetchExtensions`, legacy `GetExtensionsByInterfaceRequest`), so previews, context widgets and settings from the other app never show up while third-party extensions do. The sidebar matches its own main and settings items by `config.appId`; the settings extension declares the private `hackathon.menuitem` interface (the main tool loads both) so the original app does not list it either. Custom XP event names still use the `com.enonic.app.contentstudio.*` prefix and are shared with the original app. | User request on 2026-09-10, to run this build side by side with the original Content Studio on the same XP. |
| Build tests | `hackathonTestsOnly=true` in `gradle.properties` disables all Java `Test` tasks in `modules/app` and limits the Gradle `pnpmTest` task to `features/juke`. Set to `false` to restore the full suite. | User request on 2026-09-10 to keep hackathon builds fast; temporary. |

## 3. Runtime and constraints

- Web Speech API availability: Chrome and Edge (cloud-backed recognition), Safari (on-device). Firefox has no
  `SpeechRecognition`; Juke stays fully hidden there and logs once to the console.
- Chrome ends continuous recognition on silence, network hiccups and roughly every 60 s. The listener must
  restart automatically on `onend` unless stopped deliberately, with back-off after consecutive errors.
- The `not-allowed` error (microphone denied) must stop the restart loop and show a one-time warning via
  lib-admin-ui `showWarning`.
- Speaking while listening: recognition picks up Juke's own voice. Recognition stays on and the echo is filtered
  out by timing and by word overlap with the last reply.
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
    all.commands.ts            registration order: session, small talk, search, tree, project, create (fixed
                               phrases before open-ended ones, so "new search" is not a content type)
    session.commands.ts        hello / goodbye (M1); JUKE_NAME_PATTERN with recognition variants
    smalltalk.commands.ts      (M1) conversational replies in dialog mode: how are you, help, what can you do,
                               who are you, thanks, nice to meet you, good morning/afternoon/evening, bare hello
    matching.ts                (M2) bestUniqueMatch(candidates, spoken) with exact > prefix > containment
    project.commands.ts        (M2) "go to <project>"
    content.commands.ts        (M2) "create a new <content type>"
    search.commands.ts         (M3) "new search", criteria parser, "yes" to show results; state in model/searchFlow.store.ts
    search-query.ts            (M3) criteria -> SearchInputValues, hit count via ContentAggregationsFetcher, apply to panel
    tree.commands.ts           (M3) expand / collapse a visible tree item by name
    target.ts                  (M4) resolves a spoken target: position in the visible list, name, implicit
                               selection, or "all"
    toolbar.commands.ts        (M4) edit, delete, move, duplicate, preview on a spoken target, with
                               confirmation prompts
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
| `createParent` | "Create a <type>" | root phrases, "let's try again", or a parent display name |
| `createName` | parent accepted | "let's try again", or any phrase as the new display name |
| `closeTab` | "close the tab" with unsaved changes (M5) | yes (save and close) / no (close without saving) / cancel |
| `search` | "New search" | filter phrases and keywords until a search is performed |
| `showResults` | search finished with hits | "yes" (apply filter and open panel) or anything else (dismiss) |
| `confirmDelete` | "Delete <target>" | yes / no / cancel |
| `moveTarget` | "Move <target>" | cancel or a display-name keyword for the new parent |
| `duplicateChildren` | "Duplicate <target>" | yes / no / cancel |

Session commands ("goodbye juke", "hello juke", "cancel") always win over pending prompts. "Cancel" (also "never
mind", "forget it", "stop") abandons any open question, clears the create/search state and answers "Ok"; Juke
stays in dialog mode. Commands that only make sense
without a pending prompt declare `prompts: [null]`; prompt commands declare their prompt and typically accept any
phrase, so nothing falls through to the unknown reply while a question is open.

### 4.2 Recognizer behaviour

- `continuous = true`, `interimResults = false`, `lang = 'en-US'`, `maxAlternatives = 3`.
- Wake word matching runs over all alternatives; commands use the first alternative, falling back to others
  if the first does not match any command.
- Wake and sleep phrases accept common recognition variants: "hello juke", "hello, juke", "hello duke",
  "hello jook", "hey juke"; "goodbye juke", "good bye juke", "bye juke".
- Recognition is not paused while speaking; see the echo rules above.

### 4.3 Integration points (existing code, called not modified)

| Need | Existing API |
|---|---|
| Operator installed | `$aiRegisteredPlugins` in `features/ai/ai.store.ts` (export through `features/ai/index.ts` if not already) |
| Current user name | `$config.get().user?.getDisplayName()` (`shared/config/config.store.ts`) |
| Projects list, switch | `$projects`, `selectProject(project)` in `entities/project` (`projects.store.ts:395`); dialog stays closed |
| Content types for New Content | `fetchContentTypesByContent` / `fetchAllContentTypes` in `entities/schema/api/contentTypes.api.ts` |
| Create content | new v6 wrapper `createContent()` in `entities/content/api` calling `getCmsApiUrl('create')`, body as in legacy `app/resource/CreateContentRequest.ts` |
| Open edit tab | `ContentUrlHelper.openEditContentTab()` (`app/util/ContentUrlHelper.ts`) or `new EditContentEvent([summary]).fire()` |
| Filter panel | `setContentFilterOpen`, `setContentFilterValue`, `setContentFilterSelection`, `resetContentFilter` in `shared/app-state/contentFilter.store.ts` (re-exported from `features/search/model/contentFilter.store.ts`); aggregation names in `app/browse/filter/ContentAggregation.ts` (`contentTypes`, `workflow`, `lastModified`, `modifier`) |
| Count hits without applying | `queryContent` in `entities/content/api/contentQuery.api.ts` with the same query the filter panel would build (`ContentBrowseFilterPanel.doSearch`) |
| Displayed list order | `$activeFlatNodes` in `entities/content/model/active-tree.store.ts` (`node.id`, `node.data.displayName`) |
| Implicit target | `getCurrentItems()` in `entities/content/model/content-selection.store.ts` (selected items, else the highlighted row) |
| Tree expand/collapse | `expandNode`, `collapseNode`, `isNodeExpanded`, `getTreeNode`, `hasTreeNode` in `entities/content/model/content-tree.store.ts`; `expandFilterNode` in `filter-tree.store.ts` |
| Delete | `archiveContent` in `entities/content/api/delete.api.ts` (moved from `features/delete/api`, shim left) |
| Move | `moveContent(contentIds, parentPath?)` in `entities/content/api/move.api.ts` (moved from `features/move/api`, shim left); parent lookup via `findContentByName` |
| Duplicate | `duplicateContent(params)` in `entities/content/api/duplicate.api.ts` (moved from `features/duplicate/api`, shim left) with `includeChildren` |
| Preview | `PreviewActionHelper.openWindows(contents)` (`app/action/PreviewActionHelper.ts`) with the default portal preview for every targeted item |
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
- `juke.reply.goodbye=Goodbye {0}. See you next time.` plus `juke.reply.goodbye.2`–`.5` variants ("Bye {0}. It was a
  pleasure.", "See you later {0}. I'll be here when you need me.", "Goodbye {0}. Happy editing.", "Take care {0}.
  Talk to you soon."); one is picked at random per farewell
- `juke.reply.unknown=I'm not sure how to respond to this command. Please try again.`
- `juke.reply.cancel=Ok` (universal cancel of any pending question)
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
- Replies are spoken one at a time through a queue. Recognition keeps running while Juke speaks (pausing it lost
  quick answers in the recognizer's restart gap); transcripts finalized while speaking or within 1 s after,
  and transcripts that are a contiguous piece of one of the last three replies, or (3+ words) at least 80 %
  made of one reply's words, compared by a sound key (number words as digits, consonant skeletons, plurals collapsed) so "hear"
  matches "here", "one" matches "1" and "post" matches "Posts" (`speech/echo.ts`; Chrome may finalize an echo only after the next reply started),
  are dropped as Juke's own echo. When no pause separates the reply and the answer, Chrome merges them into one
  transcript; a leading run of 2+ words that is the in-order ending of a recent reply is stripped and the
  remainder is the answer. Stripping never removes words merely reused by the user (bug 2026-09-14: a union
  word set ate "hello juke" and "what can you do"). A command that throws or takes longer than 20 s
  gets `juke.reply.failed` spoken and logged, so Juke never falls silent. Every recognized phrase and the
  resolved command id are logged with `console.info('[juke] heard', ...)` for diagnosis, as are recognition
  start/end/error events, speaking start/end, and ignored echo with its timing.
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
- `juke.reply.create.typeNotFound=I can't find a content type called {0} in the system. Try again.`
- `juke.reply.create.askParent=Where do you want to create a new {0}?`
- `juke.reply.create.parentNotFound=I can't find a content named {0}. Try again.`
- `juke.reply.create.parentAmbiguous=I found several items named {0}. Try again with a more specific name.`
- `juke.reply.create.notAllowed=A {0} cannot be created under {1}. Try a different parent.`
- `juke.reply.create.notAllowedRoot=A {0} cannot be created in the root. Try a different parent.`
- `juke.reply.create.askName=How do you want to call the new {0}?`
- `juke.reply.create.creating=Creating a new {0} called {1} under {2}`
- `juke.reply.create.creatingRoot=Creating a new {0} called {1} in the root`
- `juke.reply.create.restart=Okay. Let's start over. What do you want to create?`
- `juke.reply.create.failed=I could not create a new {0}. Please try again.`

Behaviour:
- Recognition alternatives: the service puts every normalized alternative into `JukeContext.alternatives`.
  Name lookups (tree expand/collapse, project switch, create type and parent) try the name from each
  alternative in order until one resolves (`parseAlternatives`), because the alternative that matched the
  command pattern may carry a misheard name ("expand both" with "expand posts" as second guess).
- Matching (`commands/matching.ts`, `bestUniqueMatch`): labels and the spoken name are normalized; tiers are
  tried in order — exact, label starts with spoken, containment either way, every spoken word in the label —
  and the first tier with hits decides. More than one hit is ambiguous and reported as not found. The result
  carries which label matched; content is matched on display name and path name, and when the match came through
  the path name Juke says the path name back (`spokenName`): two items both displayed "stuff" with names "stuff"
  and "stuff-copy" — "delete stuff-copy" confirms "delete stuff-copy", "delete stuff" is ambiguous.
- Content lookup (`commands/content-lookup.ts`, `findContentByName`): runs the browse filter's free-text query
  (fulltext + ngram over `displayName^5`, `_name^3`, `_allText`, draft branch, current project, 50 hits) via
  `queryContent` — the endpoint needs `contentTypeNames`, `queryFilters` and `aggregationQueries` present even
  when empty — then applies `bestUniqueMatch` over display name and name. An optional `accept` filter narrows
  the hits; parent lookups use `canHoldChildren` (no media, no page templates). Shared with Move in M4.
- "Go to <name>" (also "switch to", "open", "change to", "navigate to"; optional leading "the" and trailing
  "project") matches against project display names and ids from `$projects`, calls `selectProject` without
  opening the dialog and answers with the project's display name. Only when no prompt is pending.
- Content creation is a three-step dialog (`commands/content.commands.ts`, state in
  `model/createFlow.store.ts`):
  1. "Create a <type>" (verbs "create", "make", "add", "new", plus "great"/"crate" as recognition hears
     "create"; optional "a"/"an"/"new"). The type is matched
     against all non-abstract, non-media content types (`schema/content/all`) by title and local name. Not
     found: type-not-found reply, no prompt. Found: "Where do you want to create a new <Type>?" and prompt
     `createParent`.
  2. In `createParent`: "root", "in the root", "at the root", "project root" → root. "cancel" → handled by the
     session command ("Ok"). "let's try again"/"try again"/"start over"/"restart" → collected
     state dropped, restart reply, no prompt; the user then says "create a ..." again. Anything else (optionally prefixed "under|in|inside|below|into [the]")
     is a parent display name resolved with `findContentByName` + `canHoldChildren`. Not found or ambiguous:
     the matching reply, prompt stays. Then the allowed types for that parent are fetched
     (`ContentTypesHelper.getAvailableContentTypes` with the parent id, or none for root); if the type is not
     allowed there Juke says so and keeps asking. Otherwise "How do you want to call the new <Type>?" and prompt
     `createName`.
  3. In `createName`: "cancel" → session command; "let's try again" → restart as above. Any other phrase is the name (first letter capitalized). Juke
     creates through the legacy `CreateContentRequest` (display name set; path name generated from it with the
     wizard's rules — `NamePrettyfier.prettify`, or simplified for media / when `allowPathTransliteration` is off —
     and suffixed `-1`, `-2`, … via `contentExistsByPath` when the path is taken; workflow in progress),
     opens `/edit/<id>?displayAsNew` in a new tab, leaves filter mode if active, expands the parent
     (`commands/tree-reveal.ts`), reveals the item in the browse tree with `revealContentByPath`, and confirms "Creating a new <Type> called <Name> under <Parent>" or "... in the
     root". Failure: failed reply, dialog closed.
- While a create prompt is pending only the prompt's own command and the session commands are recognized, so
  any phrase can be a name or a parent. The search prompts are different: create, expand/collapse, "go to" and
  the toolbar actions are recognized there too and abandon the search (state cleared, prompt dropped), because
  inside a search only free text should become keywords; the search answers register last so command phrases
  win (bug 2026-09-14: "create a new folder" during a stale search became keywords). Hello, goodbye and Juke turning off reset the create flow.
- The edit tab is opened outside a user gesture, so browsers may block it as a pop-up; Content Studio then
  shows its standard pop-up warning. Allow pop-ups for the admin origin when demoing.

Tests: start/parent/name parsers, matcher tiers and ambiguity, content lookup query and narrowing, project
switch and not-found, and the create dialog end to end through the registry: type not found, named parent,
root parent, unknown/ambiguous/disallowed parent, naming and creation, cancel at each step, goodbye during a
prompt, creation failure.

### Milestone 3 — Search and tree navigation (done)

Selection as a separate step is dropped (decided 2026-09-13): its only purpose was to feed Milestone 4, whose
commands now name their target directly.

Phrases:
- `juke.reply.search.start=What are you looking for?`
- `juke.reply.search.none=I couldn't find any content items matching your criteria. Try a different search.`
- `juke.reply.search.found=I found {0} content items matching your criteria. Do you want to see them?`
- `juke.reply.search.showing=Here they are. {0} items.` / `juke.reply.search.showingOne=Here it is.` / `juke.reply.search.dismissed=Okay.`
- `juke.reply.search.typeNotFound`, `juke.reply.search.userNotFound`
- `juke.reply.tree.expanding=Expanding {0}`
- `juke.reply.tree.collapsing=Collapsing {0}`
- `juke.reply.tree.alreadyExpanded={0} is already expanded`
- `juke.reply.tree.alreadyCollapsed={0} is already collapsed`
- `juke.reply.tree.notVisible=I can't see {0} in the tree. Expand its parent first.`
- `juke.reply.tree.ambiguous=I can see several items named {0}. Be more specific.`
- `juke.reply.tree.leaf={0} has no child items.`

Search acceptance:
- "New search" resets the filter (if applied), enters the `search` prompt and speaks the start reply. Short
  aliases "find", "look up", "look for", "search for" do the same; with criteria after the verb ("find summer",
  "look for content type post") the search runs immediately and Juke answers with the count, staying in
  `search` on zero hits.
- In `search`, each utterance is parsed left to right into criteria; several may appear in one utterance:
  `content type <x>`, `last modified by me|<user>`, `last modified today`, `last modified this week`,
  `in progress` ("last" also accepted as "lost"/"life"/"less", "modified" as "modify"). An utterance with
  any clause is a filter command and words around the clauses are dropped as recognition noise; only a
  clause-free utterance is free text. Content types and modifiers are de-duplicated by key.
- After each utterance Juke builds the same `SearchInputValues` the filter panel builds from its state
  (`commands/search-query.ts`: keywords as text, `AggregationSelection`s for content types, modifier, a
  `DateRangeBucket` for last modified, `in_progress` workflow bucket) and runs the panel's own
  `ContentAggregationsFetcher.getAggregations()`; the total is the hit count. "Found" enters `showResults`;
  zero hits keeps the `search` prompt open so the criteria can be refined. Filter criteria accumulate across
  utterances; free-text keywords are replaced by each utterance so a misheard phrase does not stick. "New
  search" (also "start a new search", "search again", "another search", "reset the search", and "surge" as
  recognition often hears it, and "you search"/"use search"/"and you search"/"usage" for "new search") is accepted
  in every prompt, resets the filter and any open create/search state,
  and starts afresh (bug found 2026-09-14: it used to become keywords, leaving the user stuck with zero hits). Content type names resolve against `schema/content/all` titles; "me" resolves to
  `config.user`; other user names resolve against the modifier buckets of the current search, mapped to display
  names through `getPrincipalsByKeys`. Unknown type or user: matching reply, prompt stays.
- "Yes" to `showResults` opens the filter panel, writes value and selection into `$contentFilterState`, so the
  list applies the same filter. Hit count in the panel equals the spoken number. Any other answer dismisses.
- "Yes" (also "yeah", "sure", "show me") writes the criteria into `shared/app-state/contentFilter.store.ts`
  (moved there from `features/search/model` with a re-export shim so `features/juke` can reach it) and opens the
  panel. Anything else dismisses. "Let's try again" restarts the search; "cancel" is the session command.
- "Hide search" (also "close"/"collapse" + "search"/"filter"/"filter panel") collapses the filter panel and
  "show search"/"open the filter panel" opens it; the applied filter is untouched (`setContentFilterOpen`).
- Once the filtered list is on screen, Milestone 4 targets ("the top one", "<name>") work on it.

Tree acceptance:
- "Expand <name>" / "collapse <name>" (also "open up", "fold", "unfold") apply to an item that is already
  loaded and visible in the tree — main tree or filtered tree, whichever is active (`$activeFlatNodes`). The
  name is matched with `bestUniqueMatch` over the visible nodes' display names; nothing else is fetched.
- Not visible: not-visible reply. Ambiguous: ambiguous reply. Leaf without children: leaf reply.
- Already in the requested state: "<name> is already expanded" / "... collapsed", no change.
- Otherwise `expandNode` / `collapseNode` (or `expandFilterNode` in filter mode) and the expanding/collapsing
  reply. Pure client-side: Juke only changes the tree store's expanded state and issues no REST calls; if the
  tree itself lazy-loads children on expand, that is the tree's own behaviour, not Juke's.

### Milestone 4 — Toolbar actions on a spoken target (done)

Commands name their target instead of relying on a prior selection (decided 2026-09-13).

Grammar: `<action> [the] <target>` where action is `edit`, `delete`, `move`, `duplicate`, `preview` and target
is one of:

| Target form | Examples | Resolves to |
|---|---|---|
| Position | "the top one", "the first one", "the third one", "the last one", "the bottom one", "the second one from the bottom", "number three" | The nth row of the list as displayed (`$activeFlatNodes`: expanded main tree, or the filtered list when a filter is active). Ordinals up to tenth and digits. |
| Name | "edit summer news", "delete the superhero site" | First a unique `bestUniqueMatch` over the visible rows' display names; if nothing is visible by that name, `findContentByName` project-wide. Ambiguity is reported. |
| Implicit | "delete it", "preview them", "edit the selected", bare "edit" | The current selection, else the highlighted row (`getCurrentItems()`), else the only visible row when the list shows exactly one. None → no-target reply. |
| All | "preview all", "edit all" | Every visible row. Allowed for preview and edit; delete and duplicate go through their confirmation with the count. Move all is not supported. |

Single target per command; multi-target lists ("the first three", "news and sport") are out of scope.

Phrases:
- `juke.reply.target.noSelection=Nothing is selected. Tell me which item, for example "the top one".`
- `juke.reply.target.notFound=I can't find {0} in the list.`
- `juke.reply.target.ambiguous=I found several items named {0}. Be more specific.`
- `juke.reply.target.outOfRange=There are only {0} items in the list.`
- `juke.reply.edit.opening=Opening {0} for editing.` / `juke.reply.edit.openingMany=Opening {0} items for editing.`
- `juke.reply.delete.confirmOne=Are you sure you want to delete {0}?`
- `juke.reply.delete.confirmMany=Are you sure you want to delete {0} items?`
- `juke.reply.delete.done={0} is deleted.`
- `juke.reply.delete.cancelled=Okay. Nothing was deleted.`
- `juke.reply.move.where=Where do you want to move {0}?`
- `juke.reply.move.done={0} is moved under {1}.` / `juke.reply.move.doneRoot={0} is moved to the root.`
- `juke.reply.move.notAll=I can only move one item or the selected items. Tell me which one.`
- `juke.reply.move.targetNotFound=I can't find {0} in the current project. Try again.`
- `juke.reply.move.targetAmbiguous=I found several items named {0}. Try again with a more specific name.`
- `juke.reply.move.cancelled=Okay. Nothing was moved.`
- `juke.reply.duplicate.children=Do you want to include child items of {0} when creating the duplicate?`
- `juke.reply.duplicate.doneWith={0} is duplicated with all the children.`
- `juke.reply.duplicate.doneWithout={0} is duplicated without the children.`
- `juke.reply.duplicate.cancelled=Okay. Nothing was duplicated.`
- `juke.reply.preview.opening=Opening a preview of {0}.` / `juke.reply.preview.openingMany=Opening previews of {0} items.` / `juke.reply.preview.none={0} cannot be previewed.`
- `juke.reply.action.failed=Something went wrong while doing that. Please try again.`
- `{0}` is the item's display name, or "<X> items" for several.

Acceptance:
- Target resolution (`commands/target.ts`) is shared by all five actions and unit-tested on its own. Verbs:
  edit; delete/remove/archive; move/relocate; duplicate/copy/clone; preview. Specs from every recognition
  alternative are tried in order. State between question and answer lives in `model/actionFlow.store.ts`.
- The delete, move and duplicate REST wrappers moved from `features/*/api` to `entities/content/api` (re-export
  shims left in place) so `features/juke` can call them within the boundary rules. Each returns a task id; Juke
  waits for the task with `trackTask` and answers done or `action.failed`, and shows the same success or error
  toast the corresponding dialog shows (`dialog.archive.success.*`, `notify.items.moved.to.*` + destination,
  `dialog.duplicate.success.*`, `notify.process.failed`).
- Edit: one edit tab per resolved item via `ContentUrlHelper.openEditContentTab`; reply names the item or the
  count.
- Delete: confirmation prompt with display name or count → `confirmDelete`. Only an explicit "yes" (also "go
  ahead", "confirm") archives and speaks done; any other answer speaks cancelled and does nothing. The prompt holds the
  resolved items, not the selection.
- Move: "Where do you want to move <name>?" → `moveTarget`. The answer is a new-parent name resolved with
  `findContentByName` + `canHoldChildren`, excluding the moved items and their descendants ("to the root" moves
  to the root); a unique match moves the items with `moveContent`, then waits for the server's move report on the
  socket (`$contentMoved`, 3 s timeout — the tree rebuilds both parents from it, and expanding earlier is undone by
  it), then — if a filter is active — resets the filter and waits for the tree to return (`$isFilterActive`, 3 s
  timeout) — and expands the destination in the tree
  (`revealContentByPath` with `select: false, expandTarget: true`) and speaks done; not found / ambiguous keep
  the prompt; "cancel" cancels. "Move all" is refused.
- Duplicate: children question → `duplicateChildren`. "Yes"/"no" leaves filter mode if active, duplicates with or
  without children via `duplicateContent`, expands the originals' parent and speaks the matching reply; "cancel"
  cancels.
- Preview: one tab per resolved item via `PreviewActionHelper.openWindows` with the default portal preview.
  Whether an item renders is only known by rendering it (most content uses a page template and has no page of
  its own), and the preview widget that decides this lives in the widgets layer, out of reach for a feature; so
  every target is opened and the preview page itself reports what cannot render (a page-flag check wrongly
  refused posts, 2026-09-14).
- "Cancel" and "let's try again" work in every prompt as in the create dialog.
- Toolbar actions do not change the selection; the mouse selection stays whatever it was.

### Milestone 5 — Voice commands in edit mode (done 2026-09-15)

Goal: an edit tab opened by Juke gets its own Juke; the browse tab that opened it goes quiet; first command
is "close the tab".

Phrases:
- `juke.reply.tab.closing=Closing the tab.` (spoken before the tab closes)
- `juke.reply.tab.unsaved=There are unsaved changes. Do you want to save them before closing the tab?`
- `juke.reply.tab.savingAndClosing=Saving changes and closing the tab.` (spoken before saving)
- `juke.reply.tab.saveFailed=Saving failed. The tab stays open.`
- `juke.reply.tab.saved=Changes saved.`, `juke.reply.tab.nothingToSave=There are no unsaved changes.`,
  `juke.reply.tab.saveOnlyFailed=Saving failed. Please try again.` (save without closing)
- `juke.reply.tab.cannotClose=I can't close this tab. Close it yourself.`
- No hand-off phrase: the browse tab goes silent without a word, so it feels like one assistant across tabs.

Design:
- Hand-over marker: edit URLs Juke opens get a `juke=1` query parameter (`commands/handoff.ts`:
  `openEditTabWithJuke` appends it to `ContentUrlHelper.generateEditContentUrl` and opens the tab under the
  wizard's tab name through the shared `openTabOrFocusExisting`). The wizard reads it at startup
  (`$jukeHandoff`); only then does Juke start in that tab. Manually opened editors stay silent for now. An
  editor that was already open without the marker is focused but not handed over (its URL lacks the marker),
  so the browse tab keeps talking.
- Availability in wizard mode: `$jukeAvailable` is `speech && aiEnabled && (browseMode || jukeHandoff)`. Note
  `aiEnabled` in the wizard is operator *or* translator running; the marker is only ever set by a Juke that
  required the operator, so no extra check is made.
- Browse tab hand-over: the create-name step and a single-item "edit" return their reply with
  `handoff: <the opened Window>`; after speaking it the service releases the microphone and hides the widget
  (mode `off`) without a word, then polls the window every second and, once it is closed, starts listening
  again straight in `dialog` mode — so the conversation continues in the browse tab where it left off. "Edit"
  on several items opens plain tabs; "preview" does not hand over.
- Edit-mode registry: session commands (hello/goodbye/cancel) and small talk are reused; browse-only commands
  (search, tree, project, toolbar, create) are not registered in wizard mode. New `tab.commands.ts`:
  - Editor bridge: the wizard lives in the pages layer and the legacy panel, out of reach for a feature, so
    `main.ts` (`startContentWizard`) injects a `JukeEditorBridge` — `hasUnsavedChanges()` (wizard dirty and not
    read-only), `save()` (the wizard's `saveChanges`), `close()` (sets a flag that skips the wizard's
    beforeunload prompt, then `window.close()`) — through `setJukeEditorBridge` exported from the feature.
  - "close the tab" / "close this tab" / "close the editor|window|wizard": if the bridge reports no unsaved
    changes, say "Closing the tab." and close. Otherwise ask the unsaved phrase and enter prompt `closeTab`:
    "yes" says "Saving changes and closing the tab.", saves, waits for the save to finish, then closes; "no"
    says "Closing the tab." and closes without saving and without the browser prompt; anything else repeats the
    question; "cancel" leaves the tab open. Save failure: save-failed reply, tab stays open.
  - "save (the changes) and close (the tab)" / "save and close": says "Saving changes and closing the tab.",
    saves without asking, then closes. Also accepted as the answer to the unsaved question.
  - "save (the changes|the content|it)" / "save": saves through the bridge without closing and says "Changes
    saved."; the wizard's own "Item ... has been saved" notification appears as after a manual save. With
    nothing to save Juke says so and does not call the wizard.
  - Confirmations are spoken *before* the action runs, because closing the tab would cut the speech off.
    `JukeReply` has an optional `after` hook (not `then`, which would make a reply a thenable) that the service
    runs after the reply has been spoken and its prompt/mode applied; it may answer with a follow-up reply
    (save failed, cannot close) that is spoken in turn. Failures and timeouts in the hook get the generic
    failure reply like a command would.
  - Closing uses `window.close()`, allowed because the tab was opened by script; if the tab is still there
    300 ms later (a manually opened tab with the marker), the cannot-close reply.
- Widget mount: `JukeWidget` is added to `WizardAppShell` next to `BrowseAppShell`. The Juke service already
  starts from `AppElement.initialize()` for both modes; commands are registered on activation per mode
  (`allCommands` in browse, `editorCommands` = session + small talk + tab in the editor); in the editor the
  dialog is open from the start (no "Hello, Juke" and no greeting after a hand-over).
- The wizard's beforeunload prompt is bypassed only for a close Juke performs; any other navigation keeps it.

Acceptance: "create a post" flow ends with the editor tab open, Juke silent in the browse tab (no hand-off
line) and active in the editor; "close the tab" closes a clean editor at once; with unsaved changes it asks,
"yes" saves and closes, "no" closes without the browser prompt; "save changes and close the tab" saves and closes
without asking. Each close is preceded by the spoken confirmation, and the close waits for the speech to end.
Closing the editor (by voice or by hand) brings the browse tab's Juke back in dialog mode. Unit tests for the
URL marker and hand-over helper, availability gate, registry composition per mode, the follow-up hook, the
hand-over/resume cycle, the dirty check and the three close paths.

### Milestone 6 — Suggestions from Juke Content Operator (planned 2026-09-15)

Goal: "create suggestion for <label>" / "create suggestions for <label 1> and <label 2>" in edit mode makes the
operator generate values for those inputs (via Vertex) and inserts them, without opening the operator dialog.

Plugin repositories (surveyed 2026-09-15): `/Users/ase/dev/app-ai-content-operator` and
`/Users/ase/dev/app-ai-translator` (both `2.1.0-SNAPSHOT`, XP `8.1.0-SNAPSHOT`); the user allows changes there.
Each mirrors `ai-protocol.ts` under `src/main/resources/shared/` — the mirror must stay byte-identical to CS's.

How the operator works today (`assets/store/websocket/websocket.utils.ts`):
- Generation is prompt-driven. `sendPrompt(nodes)` turns the chat input into text where a field mention becomes
  `{{/path}}` (`parseText`, path like `/title` or `/items/item[2]/title`, `/__topic__` for the display name),
  then sends `MessageType.GENERATE` with `{ prompt, instructions, history, meta: { language, contentPath },
  fields }` (`createGenerateMessagePayload`). The server answers `ANALYZED` then `GENERATED` with a
  `GenerationResult` keyed by path; `FAILED` on error.
- Results are applied only when the user clicks Apply in the chat: `applyResults(items)` in
  `store/host/host.utils.ts` maps each path to an `AiFieldPath` (`pathStringToAiFieldPath`) and calls
  `api.applyValue` + `api.animateField`.

Design:
- Field resolution (CS side): spoken labels are matched with `bestUniqueMatch` against the input labels of the
  content type form (`$aiContentType.getForm()`), mixins and page config, yielding `AiFieldPath`s. Unknown or
  ambiguous labels are reported per label; the rest proceed.
- Protocol (both repos + CS): add to `AiCommands`
  `'generate:fields': { requestId: string; paths: AiFieldPath[]; instructions?: string }` and a host-side
  completion signal `'generate:done': { requestId; applied: AiFieldPath[]; failed: { path; message }[] }` (a
  new `AiPluginApi` method `reportResult(requestId, …)` is the smallest addition; alternatively CS infers
  completion from `setFieldState('completed')` per path, which the operator does not emit today). Bump
  `AI_PROTOCOL_VERSION` to 3 and update both mirrors.
- Operator side: handle `generate:fields` by building a prompt from a template — "Generate a suggestion for
  {{/path1}} and {{/path2}}." — with the mentions for the requested paths, send it through the existing
  generate pipeline (`createGenerateMessagePayload` + `sendGenerateMessage`), and on `GENERATED` auto-apply the
  result entries for the requested paths via `applyResults`, then report done. The chat history still records
  the exchange, so the dialog shows it if opened later. No dialog is shown.
- Boundary: `features/juke` cannot import `features/ai`. The command dispatch (`emitToPlugin` on the registered
  plugin) and the completion signal are exposed through a shared bridge store (`shared/ai/ai-bridge.store.ts`),
  as the filter store was moved.
- Flow: parse labels → resolve paths → `generate:fields` → operator sets `setFieldState('processing')` per
  path → Juke waits for `generate:done` (timeout 60 s, matching the operator's `STOP_GENERATION_TIMEOUT`) →
  replies "Done. <labels> updated." or per-field failures. The wizard is left dirty, not saved.
- Phrases: `juke.reply.ai.generating=Generating suggestions for {0}.`, `juke.reply.ai.generated=Done. {0}
  updated.`, `juke.reply.ai.fieldNotFound=I can't find a field called {0}.`, `juke.reply.ai.unsupported=The Juke
  operator does not support this yet.`, `juke.reply.ai.failed=The suggestion for {0} failed.`

### Milestone 7 — Translation with Juke Translator (planned 2026-09-15)

Goal: "translate content into <language>" / "translate <label> into <language>" in edit mode translates the
whole content or the named field with the translator (via Vertex), without opening its dialog.

How the translator works today (`assets/store/websocket/websocket.utils.ts`):
- `startTranslation()` reads the persisted content id and project, the target language from the wizard's
  language (`getLanguage()` → "tag (name)"), custom instructions, connects and sends `MessageType.TRANSLATE`
  with `{ contentId, project, targetLanguage, customInstructions }`. The server reads the *persisted* content,
  answers `ACCEPTED { paths }` then one `COMPLETED { path, text }` per field (applied at once via
  `api.applyValue` + `setFieldState('completed')`) or `FAILED { path?, code }`.
- So translation works on saved data and always covers every translatable field; the client only tracks
  per-path progress in `store/items`.

Design:
- Language resolution: the spoken language is matched against the languages the wizard offers
  (`entities/language`, display name and tag); unknown → `juke.reply.translate.languageNotFound`. The target
  string is built as the translator does ("tag (name)").
- Field resolution as in M6; "content" means all translatable fields.
- Protocol: add `'translate:fields': { requestId; language: string; paths?: AiFieldPath[] }` to `AiCommands`
  plus the shared `'…:done'` completion signal. Translator side: run `startTranslation` with the given target
  language; when `paths` is given, apply `COMPLETED` results only for those paths and treat the rest as skipped
  (no server change needed; a `paths` filter in the `TRANSLATE` payload is an optional server-side optimisation).
- Unsaved changes: the translator reads persisted content, so Juke calls the host's `requestSave()` equivalent
  (wizard save) and waits for the save before sending `translate:fields`; the dialog has the same constraint.
- Phrases: `juke.reply.translate.working=Translating {0} into {1}.`, `juke.reply.translate.done=Done. {0}
  translated into {1}.`, `juke.reply.translate.languageNotFound=I don't know the language {0}.`,
  `juke.reply.translate.saving=Saving first.`

Remaining open points: whether the operator's default instructions (`$config.instructions`) should apply to
voice-driven generation (assume yes), and the exact wording of the generation prompt template so the model
returns one value per requested path.

### Milestone 8 — Juke Voice Assistant application (planned 2026-09-16)

Goal: everything built in milestones 1–7 ships as a separate XP application, "Juke Voice Assistant", next to Juke
Content Operator and Juke Translator. Installing and starting it enables the voice features in Content Studio;
without it Content Studio has none. The Content Studio side of this milestone is meant to be mergeable into the
real Content Studio (`com.enonic.app.contentstudio`), not just the hackathon fork.

Naming and location (to confirm with the user before starting):
- Application key `com.enonic.app.ai.voiceassistant`, title "Juke Voice Assistant", vendor Enonic AS
  (`application.yaml` like the operator's).
- Repository `/Users/ase/dev/app-ai-voice-assistant`, cloned from the operator's skeleton: Gradle
  (`build.gradle.kts`, `gradle.properties` with `appName`, XP `8.1.0-SNAPSHOT`), Vite + Preact client bundle at
  `assets/index.js`, esbuild server bundle, vitest, i18n `phrases.properties`.
- Plugin id `ai.voiceAssistant` added to `AiPluginId` in `ai-protocol.ts` (protocol version bump; the mirrors in
  the operator, translator and the new app stay byte-identical).

How the other Juke apps plug in today (`modules/app/.../admin/tools/main/main.js`, `main.html`, `lib/ai.js`,
`v6/features/ai/ai.host.ts`): the tool controller checks `appLib.get({key}).started`, passes the app's asset URL
to `main.html`, which seeds `window.Enonic.AI` and adds an async `<script src=".../index.js">` with the CSP nonce;
the bundle calls `window.Enonic.AI.register({ id, version, mount })`; the host mounts it into a container it
creates and fans `content/schema/language/config` signals out through the `AiPluginApi`. Juke Voice Assistant
uses the same path.

Where the line goes (the app is the thick side):
- **App (Juke Voice Assistant)** owns everything that is about voice: recognizer, speaker, echo filter, normalizer,
  command registry, every command's *phrase parsing* and dialog state (prompts, create/search/action flows),
  spoken replies and their phrases, the widget (rendered by the plugin into its container, shadow DOM like the
  operator's dialog, fixed bottom-right), the cross-tab BroadcastChannel and the hand-over/hand-back logic, the
  `juke=1` marker convention, and the availability rules (speech support, browse or handed-over editor). It
  reaches Content Studio only through the voice host API below and, for M6/M7, through the AI host's routed
  commands (`generate:fields`, `translate:fields`).
- **Content Studio** owns a **voice host API**: a typed, versioned capability surface in `ai-protocol.ts`
  (section "Voice host") implemented in `v6/features/ai` (or a sibling `features/voice-host`) by thin adapters
  over the stores and APIs the commands call today. It is passed to the plugin in `AiPluginContext` (a new
  `context.voice` object, only present for `ai.voiceAssistant`). Content Studio also keeps the load hooks
  (`lib/ai.js` `aiVoiceAssistantRunning()`, `main.js` params, `main.html` script tag, `isAiEnabled` including
  the voice app in both views), the editor bridge in `main.ts` (now feeding the host API instead of the feature),
  and the extension points the commands need but the UI does not expose yet (e.g. `revealContentByPath` options
  added in M2, `waitForMovedEvent` semantics, hit-count parity helpers).

Voice host API (derived from the action halves of the current commands; each is one method with plain data in
and out, no CS classes cross the boundary):
- Session/context: `getUser()` (display name), `getMode()` (`browse` | `wizard`), `isPluginRegistered(id)` (for
  M6/M7 replies like "the operator is not installed"), `notify(level, message)`, `i18n(key, ...args)` for CS
  toasts the commands reuse (`dialog.archive.success.*`, `notify.items.moved.to.*`, ...).
- Projects: `listProjects()`, `switchProject(name)`.
- Tree: `getVisibleNodes()` (id, displayName, name, hasChildren, expanded, level), `expandNode(id)`,
  `collapseNode(id)`, `getSelection()`, `revealPath(path, { expandTarget })`, `leaveFilterMode()`.
- Content: `findContentByName(name, { canHoldChildren, excludeIds, excludePaths })` returning candidates with
  labels and paths (matching stays in the app), `getCreatableTypes(parentId?)`, `createContent(type, parentPath,
  displayName)` (name generation and uniqueness inside CS), `archive(ids)`, `move(ids, destinationPath)`,
  `duplicate(ids, withChildren)` (all awaiting task completion and the socket report where relevant), `preview(ids)`,
  `openEditTab(id, { displayAsNew, marker })` returning a closed-state handle.
- Search: `search(criteria)` → hit count (criteria as plain data: keywords, content types, modifier, last
  modified range, workflow), `applySearch(criteria)`, `setFilterPanelOpen(open)`, `listContentTypes()`,
  `listRecentEditors()`.
- Editor: `hasUnsavedChanges()`, `save()`, `close()`; M6/M7 go through the routed AI commands.

Steps:
1. Carve the API: split each command file into parse (stays) and action (moves behind an interface) inside CS
   first, with the existing tests green, so the boundary is proven before anything moves.
2. Add the protocol types and the CS implementation; pass `context.voice` to the voice plugin; add the load hooks.
3. Scaffold the app repo; move `features/juke` (speech, commands' parse halves, model, ui, tests) into it; port the
   widget to the plugin container; move `juke.*` phrases to the app's i18n; wire `register`/`mount`/`dispose`.
4. Delete `features/juke` from CS; keep only the host API and hooks. Restore `hackathonTestsOnly=false` so CS's
   full suite runs again.
5. Re-verify every milestone by voice in Chrome with the three Juke apps installed; fix regressions.

Risks specific to this milestone: the plugin bundle cannot import Content Studio modules, so any command detail
that still leans on CS internals (e.g. `ContentTypesHelper`, filter-panel query builders, `NamePrettyfier`) must be
covered by the API or reimplemented; version coupling between CS and the app is handled by the protocol version;
CSP nonce and same-origin rules already cover script loading, BroadcastChannel and the microphone; the editor
bridge and hand-over marker become part of the API contract.

Acceptance: with Juke Voice Assistant stopped, Content Studio shows no widget, asks for no microphone and has no
`[juke]` console output; started, every acceptance scenario of milestones 1–7 passes by voice; the operator and
translator are only needed for M6/M7 commands and their absence is spoken, not silent; the app builds and tests on
its own; the Content Studio diff against `master` contains only the host API, hooks and protocol changes.

## 6. Non-goals (milestones 1–5)

- No LLM, no MCP, no server-side speech processing, no new server endpoints.
- No wizard/editor tab support (lifted in M5).
- No multi-language recognition.
- No functional use of the Juke Operator or Juke Translator (lifted in M6/M7).
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
3. **Milestone 3** (commit "Add Juke search and tree navigation commands")
   - Search prompt parser, query builder shared with filter panel, aggregation key resolution, show-results
     flow; expand/collapse commands over `$activeFlatNodes`; phrases; tests.
4. **Milestone 4** (commit "Add Juke toolbar commands: edit, delete, move, duplicate, preview")
   - Target resolver (position, name, implicit, all); confirmation prompts; five toolbar commands via feature
     APIs, preview via `PreviewActionHelper`; phrases;
     tests.
5. After each milestone: manual verification checklist in Chrome on the `juke` sandbox, then pause for review.
6. **Milestone 5** (commit "Add Juke to the editor tab with hand-over from browse")
   - URL marker, wizard availability gate, widget in `WizardAppShell`, browse-tab shutdown after hand-over,
     `tab.commands.ts`; phrases; tests.
7. **Milestone 6** (commit "Generate field suggestions with Juke Operator by voice")
   - Field label resolver over the form schema, `generate:fields` protocol command + shared AI bridge, operator
     side in app-ai-content-operator; phrases; tests.
8. **Milestone 7** (commit "Translate fields with Juke Translator by voice")
   - Language resolver, `translate:fields` protocol command, translator side in app-ai-translator; phrases;
     tests.
9. **Milestone 8** (several commits in CS: "Add the voice host API for Juke Voice Assistant", "Load Juke Voice
   Assistant as an AI plugin", "Remove the built-in Juke feature"; app repo: "Initial Juke Voice Assistant")
   - Parse/action split behind an interface, protocol types, CS implementation and load hooks, app scaffold,
     move of `features/juke`, deletion from CS, full re-verification.

## 9. Estimates

Measured on this session for milestones 1–5 (branch `juke-voice`, 2026-09-10 to 2026-09-15): about 10 hours of
active session time over 5 days, 64 commits, about 75 user messages, about 980 assistant turns, 3.3k lines of
feature code plus 3.5k lines of tests, roughly 400–500k output tokens and 80–120M input tokens processed (nearly
all cached context re-reads; about 200k tokens of fresh input). An up-front estimate from the PRD alone would
have been 2–3× too low; the difference was field testing by voice (recognition quirks, browser constraints) and
scope changes made on the way.

Estimates for the remaining milestones, using the same yardstick (active session time, commits, tokens processed
incl. cached re-reads; each assumes the same review-between-steps way of working and a similar share of
by-voice verification):

| Milestone | Active time | Commits | Tokens processed | Notes |
|---|---|---|---|---|
| 6 — Operator suggestions | 3–4 h | 10–14 | 25–35M | Two repos, protocol command, headless generation path in the operator, field-label matching. |
| 7 — Translator | 2–3 h | 8–12 | 20–30M | Same shape as M6, less new ground; save-first constraint. |
| 8 — Juke Voice Assistant app | 10–14 h | 40–60 | 90–130M | Parse/action split of ~3.3k lines and ~3.5k test lines, ~40-method host API, new repo and build, load hooks, full regression pass by voice across M1–7. About the size of M1–5 together. |
| Total M6–M8 | 15–21 h | 60–85 | 135–195M | |

The M8 estimate assumes the app repo is cloned from the operator's skeleton and that the host API is carved
inside CS first (step 1), which keeps every existing test green while the boundary is drawn; doing the move
before the split would roughly double the regression work.
