import type { JukeCommand } from './command.types';
import { contentCommands } from './content.commands';
import { projectCommands } from './project.commands';
import { searchCommands } from './search.commands';
import { sessionCommands } from './session.commands';
import { smallTalkCommands } from './smalltalk.commands';
import { treeCommands } from './tree.commands';

//
// * Registration order
//
// Earlier commands win. Session commands come first so they beat any prompt;
// fixed-phrase commands (search, tree) come before open-ended ones (create,
// which accepts "new <anything>") so "new search" is a search, not a type.
//

export const allCommands: readonly JukeCommand[] = [
    ...sessionCommands,
    ...smallTalkCommands,
    ...searchCommands,
    ...treeCommands,
    ...projectCommands,
    ...contentCommands,
];
