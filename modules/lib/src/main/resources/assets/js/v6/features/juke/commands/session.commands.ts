import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { resetActionFlow } from '../model/actionFlow.store';
import { resetCreateFlow } from '../model/createFlow.store';
import { resetSearchFlow } from '../model/searchFlow.store';
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
const CANCEL_PATTERN = /^(?:cancel|never mind|nevermind|forget it|stop)$/;

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
        resetCreateFlow();
        resetSearchFlow();
        resetActionFlow();
        setJukePrompt(null);
        setJukeMode('dialog');
        return { say: i18n('juke.reply.hello', context.userName) };
    },
};

// Farewell variants; one is picked at random so Juke does not sound scripted.
export const FAREWELL_KEYS: readonly string[] = [
    'juke.reply.goodbye',
    'juke.reply.goodbye.2',
    'juke.reply.goodbye.3',
    'juke.reply.goodbye.4',
    'juke.reply.goodbye.5',
];

export function pickFarewell(random: () => number = Math.random): string {
    return FAREWELL_KEYS[Math.min(FAREWELL_KEYS.length - 1, Math.floor(random() * FAREWELL_KEYS.length))];
}

export const goodbyeCommand: JukeCommand<true> = {
    id: 'session.goodbye',
    modes: ['dialog'],
    match: (text) => (isSleepPhrase(text) ? true : null),
    run: (_args, context) => {
        resetCreateFlow();
        resetSearchFlow();
        resetActionFlow();
        return {
            say: i18n(pickFarewell(), context.userName),
            mode: 'idle',
            prompt: null,
        };
    },
};

// "Cancel" abandons whatever question Juke is waiting on and returns to plain
// dialog mode. Registered with the session commands so it wins in every prompt.
export const cancelCommand: JukeCommand<true> = {
    id: 'session.cancel',
    modes: ['dialog'],
    match: (text) => (CANCEL_PATTERN.test(text) ? true : null),
    run: () => {
        resetCreateFlow();
        resetSearchFlow();
        resetActionFlow();
        return { say: i18n('juke.reply.cancel'), prompt: null };
    },
};

export const sessionCommands: readonly JukeCommand[] = [helloCommand, goodbyeCommand, cancelCommand];
