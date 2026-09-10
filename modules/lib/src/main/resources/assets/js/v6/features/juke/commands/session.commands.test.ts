import { beforeEach, describe, expect, it, vi } from 'vitest';
import { $jukeMode, $jukePrompt, resetJukeState } from '../model/juke.store';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext } from './command.types';
import { goodbyeCommand, helloCommand, isSleepPhrase, isWakePhrase, sessionCommands } from './session.commands';

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

const context = (mode: JukeContext['mode'], prompt: JukeContext['prompt'] = null): JukeContext => ({
    mode,
    prompt,
    userName: 'Alan',
});

describe('wake and sleep phrases', () => {
    it.each(['hello juke', 'hey juke', 'hi juke', 'hello duke', 'hello jook', 'hello jude', 'okay hello juke please'])(
        'accepts "%s" as a wake phrase',
        (text) => {
            expect(isWakePhrase(text)).toBe(true);
        },
    );

    it.each(['hello', 'juke', 'hello there', 'goodbye juke', 'yellow juke'])(
        'rejects "%s" as a wake phrase',
        (text) => {
            expect(isWakePhrase(text)).toBe(false);
        },
    );

    it.each(['goodbye juke', 'good bye juke', 'bye juke', 'bye bye juke', 'see you juke', 'goodbye duke'])(
        'accepts "%s" as a sleep phrase',
        (text) => {
            expect(isSleepPhrase(text)).toBe(true);
        },
    );

    it.each(['goodbye', 'hello juke', 'bye'])('rejects "%s" as a sleep phrase', (text) => {
        expect(isSleepPhrase(text)).toBe(false);
    });
});

describe('session commands', () => {
    beforeEach(() => {
        resetJukeState();
        clearCommands();
        registerCommands(...sessionCommands);
    });

    it('hello opens the dialog and greets the user by name', async () => {
        $jukeMode.set('idle');
        $jukePrompt.set('search');

        const resolved = resolveCommand(['hello juke'], context('idle', 'search'));
        expect(resolved?.command).toBe(helloCommand);

        const reply = await resolved!.command.run(resolved!.args, context('idle'));

        expect($jukeMode.get()).toBe('dialog');
        expect($jukePrompt.get()).toBeNull();
        expect(reply).toEqual({ say: 'juke.reply.hello|Alan' });
    });

    it('hello is also accepted while already in dialog', () => {
        expect(resolveCommand(['hello juke'], context('dialog'))?.command).toBe(helloCommand);
    });

    it('goodbye is only accepted in dialog and closes it after speaking', async () => {
        expect(resolveCommand(['goodbye juke'], context('idle'))).toBeNull();

        const resolved = resolveCommand(['goodbye juke'], context('dialog'));
        expect(resolved?.command).toBe(goodbyeCommand);

        const reply = await resolved!.command.run(resolved!.args, context('dialog'));
        expect(reply).toEqual({ say: 'juke.reply.goodbye|Alan', mode: 'idle', prompt: null });
    });

    it('session commands win over pending prompts', () => {
        expect(resolveCommand(['goodbye juke'], context('dialog', 'confirmDelete'))?.command).toBe(goodbyeCommand);
    });

    it('falls back to later alternatives when the first is not a command', () => {
        const resolved = resolveCommand(['hello duke', 'hello juke'], context('idle'));
        expect(resolved?.command).toBe(helloCommand);
        expect(resolveCommand(['yellow jute', 'hello juke'], context('idle'))?.command).toBe(helloCommand);
    });

    it('returns null for unknown phrases', () => {
        expect(resolveCommand(['make me a sandwich'], context('dialog'))).toBeNull();
        expect(resolveCommand(['make me a sandwich'], context('idle'))).toBeNull();
    });
});
