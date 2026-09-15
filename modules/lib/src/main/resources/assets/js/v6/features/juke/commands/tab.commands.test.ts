import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setJukeEditorBridge } from '../model/editorBridge.store';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext, JukeReply } from './command.types';
import { sessionCommands } from './session.commands';
import { CLOSE_CHECK_MS, tabCommands } from './tab.commands';

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

const bridge = {
    hasUnsavedChanges: vi.fn<() => boolean>(),
    save: vi.fn<() => Promise<void>>(),
    close: vi.fn(),
};

const context = (prompt: JukeContext['prompt'] = null): JukeContext => ({ mode: 'dialog', prompt, userName: 'Alan' });

const say = async (text: string, prompt: JukeContext['prompt'] = null): Promise<JukeReply | null> => {
    const ctx = context(prompt);
    const resolved = resolveCommand([text], ctx);
    return resolved ? resolved.command.run(resolved.args, ctx) : null;
};

// Runs the reply's follow-up as the service would, once the reply is spoken.
const follow = async (reply: JukeReply | null): Promise<JukeReply | undefined> => {
    const pending = reply?.after?.();
    await vi.advanceTimersByTimeAsync(CLOSE_CHECK_MS);
    return pending;
};

let windowClosed = false;

describe('tab commands', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        bridge.hasUnsavedChanges.mockReset().mockReturnValue(false);
        bridge.save.mockReset().mockResolvedValue(undefined);
        bridge.close.mockReset().mockImplementation(() => {
            windowClosed = true;
        });
        windowClosed = false;
        vi.spyOn(window, 'closed', 'get').mockImplementation(() => windowClosed);
        setJukeEditorBridge(bridge);
        clearCommands();
        registerCommands(...sessionCommands, ...tabCommands);
    });

    afterEach(() => {
        setJukeEditorBridge(null);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each(['close the tab', 'close this tab', 'close the editor', 'clothes the window', 'close tab'])(
        'should recognize "%s" as closing',
        (text) => {
            expect(resolveCommand([text], context())?.command.id).toBe('tab.close');
        },
    );

    it.each(['save changes and close the tab', 'save and close', 'save the changes and close this tab', 'save, close'])(
        'should recognize "%s" as saving and closing',
        (text) => {
            expect(resolveCommand([text], context())?.command.id).toBe('tab.saveAndClose');
        },
    );

    it('should not recognize other tab talk', () => {
        expect(resolveCommand(['close the folder'], context())).toBeNull();
        expect(resolveCommand(['save'], context())).toBeNull();
    });

    it('should announce, then close a clean editor', async () => {
        const reply = await say('close the tab');

        expect(reply).toMatchObject({ say: 'juke.reply.tab.closing', prompt: null });
        expect(bridge.close).not.toHaveBeenCalled();

        expect(await follow(reply)).toBeUndefined();
        expect(bridge.close).toHaveBeenCalledTimes(1);
        expect(bridge.save).not.toHaveBeenCalled();
    });

    it('should ask about unsaved changes and save on yes', async () => {
        bridge.hasUnsavedChanges.mockReturnValue(true);

        expect(await say('close the tab')).toEqual({ say: 'juke.reply.tab.unsaved', prompt: 'closeTab' });
        expect(resolveCommand(['yes'], context('closeTab'))?.command.id).toBe('tab.closeAnswer');

        const reply = await say('yes', 'closeTab');
        expect(reply).toMatchObject({ say: 'juke.reply.tab.savingAndClosing', prompt: null });
        expect(bridge.save).not.toHaveBeenCalled();

        expect(await follow(reply)).toBeUndefined();
        expect(bridge.save).toHaveBeenCalledTimes(1);
        expect(bridge.close).toHaveBeenCalledTimes(1);
    });

    it('should close without saving on no and repeat the question otherwise', async () => {
        bridge.hasUnsavedChanges.mockReturnValue(true);
        await say('close the tab');

        expect(await say('what', 'closeTab')).toEqual({ say: 'juke.reply.tab.unsaved' });

        const reply = await say('no', 'closeTab');
        expect(reply).toMatchObject({ say: 'juke.reply.tab.closing', prompt: null });
        await follow(reply);
        expect(bridge.save).not.toHaveBeenCalled();
        expect(bridge.close).toHaveBeenCalledTimes(1);
    });

    it('should let cancel leave the tab open', async () => {
        bridge.hasUnsavedChanges.mockReturnValue(true);
        await say('close the tab');

        expect(resolveCommand(['cancel'], context('closeTab'))?.command.id).toBe('session.cancel');
    });

    it('should save and close without asking, also while the question is open', async () => {
        bridge.hasUnsavedChanges.mockReturnValue(true);

        const reply = await say('save changes and close the tab');
        expect(reply).toMatchObject({ say: 'juke.reply.tab.savingAndClosing', prompt: null });
        await follow(reply);
        expect(bridge.save).toHaveBeenCalledTimes(1);
        expect(bridge.close).toHaveBeenCalledTimes(1);

        expect(resolveCommand(['save and close'], context('closeTab'))?.command.id).toBe('tab.saveAndClose');
    });

    it('should keep the tab open when saving fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        bridge.save.mockRejectedValue(new Error('boom'));

        const reply = await say('save and close');
        expect(await follow(reply)).toEqual({ say: 'juke.reply.tab.saveFailed' });
        expect(bridge.close).not.toHaveBeenCalled();
    });

    it('should say so when the browser refuses to close the tab', async () => {
        bridge.close.mockImplementation(() => undefined);

        const reply = await say('close the tab');
        expect(await follow(reply)).toEqual({ say: 'juke.reply.tab.cannotClose' });
    });
});
