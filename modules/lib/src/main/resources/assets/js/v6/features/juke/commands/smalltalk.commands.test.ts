import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext } from './command.types';
import { goodbyeCommand, sessionCommands } from './session.commands';
import { smallTalkCommands } from './smalltalk.commands';

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

const context = (mode: JukeContext['mode']): JukeContext => ({ mode, prompt: null, userName: 'Alan' });

describe('small talk commands', () => {
    beforeEach(() => {
        clearCommands();
        registerCommands(...sessionCommands, ...smallTalkCommands);
    });

    it.each([
        ['how are you', 'smalltalk.howAreYou'],
        ['how are you doing today', 'smalltalk.howAreYou'],
        ['hows it going', 'smalltalk.howAreYou'],
        ['id like some help with content studio', 'smalltalk.help'],
        ['i would like some help with content studio', 'smalltalk.help'],
        ['can you help me', 'smalltalk.help'],
        ['what can you do', 'smalltalk.capabilities'],
        ['who are you', 'smalltalk.whoAreYou'],
        ['whats your name', 'smalltalk.whoAreYou'],
        ['thank you very much', 'smalltalk.thanks'],
        ['thanks', 'smalltalk.thanks'],
        ['nice to meet you', 'smalltalk.niceToMeetYou'],
        ['good morning', 'smalltalk.goodMorning'],
        ['good afternoon juke', 'smalltalk.goodAfternoon'],
        ['good evening', 'smalltalk.goodEvening'],
        ['hello', 'smalltalk.greeting'],
        ['hi there', 'smalltalk.greeting'],
    ])('should answer "%s" with %s', (text, id) => {
        expect(resolveCommand([text], context('dialog'))?.command.id).toBe(id);
    });

    it('should reply with the phrase key and the user name', async () => {
        const resolved = resolveCommand(['how are you'], context('dialog'));
        const reply = await resolved!.command.run(resolved!.args, context('dialog'));
        expect(reply).toEqual({ say: 'juke.reply.smalltalk.howAreYou|Alan' });
    });

    it('should stay silent in idle mode', () => {
        expect(resolveCommand(['how are you'], context('idle'))).toBeNull();
        expect(resolveCommand(['thanks'], context('idle'))).toBeNull();
    });

    it('should let session commands win', () => {
        expect(resolveCommand(['thanks goodbye juke'], context('dialog'))?.command).toBe(goodbyeCommand);
        expect(resolveCommand(['hello juke'], context('dialog'))?.command.id).toBe('session.hello');
    });

    it('should not match unrelated phrases', () => {
        expect(resolveCommand(['go to superhero'], context('dialog'))).toBeNull();
        expect(resolveCommand(['hello world'], context('dialog'))).toBeNull();
    });
});
