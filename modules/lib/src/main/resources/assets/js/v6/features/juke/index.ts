import { computed } from 'nanostores';
import {
    $jukeActivity as $jukeActivityAtom,
    $jukeMode as $jukeModeAtom,
    $jukePrompt as $jukePromptAtom,
    $jukeTranscript as $jukeTranscriptAtom,
} from './model/juke.store';

// Read: stores
export { $isJukeVisible, $jukeAvailable } from './model/juke.store';

// Bootstrap
export { start as startJukeService, stop as stopJukeService } from './model/juke.service';

// UI
export { JukeWidget } from './ui/JukeWidget';

// Extension points for later milestones
export { registerCommands } from './commands/command.registry';
export type { JukeCommand, JukeContext, JukeMode, JukePrompt, JukeReply } from './commands/command.types';

//
// * Read-only views
//
// Atoms stay private to the slice; writes go through commands.
//

export const $jukeMode = computed($jukeModeAtom, (value) => value);
export const $jukeActivity = computed($jukeActivityAtom, (value) => value);
export const $jukePrompt = computed($jukePromptAtom, (value) => value);
export const $jukeTranscript = computed($jukeTranscriptAtom, (value) => value);
