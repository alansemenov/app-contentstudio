import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { setJukeMode, setJukePrompt } from '../model/juke.store';
import type { JukeCommand } from './command.types';

//
// * Session commands
//
// "Hello, Juke" opens the dialog, "Goodbye, Juke" closes it. Recognition often
// hears the name as a similar word, so a few variants are accepted.
//

export const JUKE_NAME_PATTERN = '(?:juke|jukes|duke|jook|jude|jules|juno)';

const WAKE_PATTERN = new RegExp(`\\b(?:hello|hey|hi)\\s+${JUKE_NAME_PATTERN}\\b`);
const SLEEP_PATTERN = new RegExp(`\\b(?:goodbye|good bye|bye|bye bye|see you)\\s+${JUKE_NAME_PATTERN}\\b`);

export function isWakePhrase(text: string): boolean {
    return WAKE_PATTERN.test(text);
}

export function isSleepPhrase(text: string): boolean {
    return SLEEP_PATTERN.test(text);
}

const ADDRESS_PATTERN = new RegExp(`^(?:(?:hello|hey|hi|okay|ok)\\s+)?${JUKE_NAME_PATTERN}\\s+(?=\\S)`);

// Drops a leading "hey juke" / "juke" so a command spoken in one breath with
// the name ("juke, how are you") matches the command itself. A bare wake
// phrase is returned unchanged so it still greets.
export function stripJukeAddress(text: string): string {
    return text.replace(ADDRESS_PATTERN, '');
}

export const helloCommand: JukeCommand<true> = {
    id: 'session.hello',
    modes: ['idle', 'dialog'],
    match: (text) => (isWakePhrase(text) ? true : null),
    run: (_args, context) => {
        // Show the icon before speaking so the greeting animates the widget.
        setJukePrompt(null);
        setJukeMode('dialog');
        return { say: i18n('juke.reply.hello', context.userName) };
    },
};

export const goodbyeCommand: JukeCommand<true> = {
    id: 'session.goodbye',
    modes: ['dialog'],
    match: (text) => (isSleepPhrase(text) ? true : null),
    run: (_args, context) => ({
        say: i18n('juke.reply.goodbye', context.userName),
        mode: 'idle',
        prompt: null,
    }),
};

export const sessionCommands: readonly JukeCommand[] = [helloCommand, goodbyeCommand];
