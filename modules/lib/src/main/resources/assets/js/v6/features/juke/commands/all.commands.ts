import type { JukeCommand } from './command.types';
import { contentCommands } from './content.commands';
import { projectCommands } from './project.commands';
import { searchCommands, searchPromptCommands } from './search.commands';
import { sessionCommands } from './session.commands';
import { smallTalkCommands } from './smalltalk.commands';
import { tabCommands } from './tab.commands';
import { toolbarCommands } from './toolbar.commands';
import { treeCommands } from './tree.commands';

//
// * Registration order
//
// Earlier commands win. Session commands come first so they beat any prompt;
// fixed-phrase commands (search, tree) come before open-ended ones (create,
// which accepts "new <anything>") so "new search" is a search, not a type. The
// search prompt's own answers come last: while a search is open, any phrase that
// is a command runs as that command and only the rest counts as keywords.
//
// The editor tab gets its own, smaller set: browse-only commands (search, tree,
// project, toolbar, create) are not registered there.
//

export const allCommands: readonly JukeCommand[] = [
    ...sessionCommands,
    ...smallTalkCommands,
    ...searchCommands,
    ...treeCommands,
    ...toolbarCommands,
    ...projectCommands,
    ...contentCommands,
    ...searchPromptCommands,
];

export const editorCommands: readonly JukeCommand[] = [...sessionCommands, ...smallTalkCommands, ...tabCommands];
