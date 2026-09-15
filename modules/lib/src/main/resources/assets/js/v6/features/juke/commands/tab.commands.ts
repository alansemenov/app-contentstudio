import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { getJukeEditorBridge } from '../model/editorBridge.store';
import type { JukeCommand, JukeReply } from './command.types';
import { parseYesNo, type YesNoArgs } from './toolbar.commands';

//
// * Tab commands (editor)
//
//   "close the tab"                    -> closes at once, or asks about unsaved changes
//   "save changes and close the tab"   -> saves, then closes, without asking
//
// Confirmations are spoken before the action runs, because closing the tab
// would cut the speech off; the work sits in the reply's `after` hook.
//

const TAB = '(?:the\\s+|this\\s+)?(?:tab|editor|window|wizard)';
const CLOSE_PATTERN = new RegExp(`^(?:close|clothes|closed)\\s+${TAB}$`);
const SAVE_AND_CLOSE_PATTERN = new RegExp(
    `^save(?:\\s+(?:the\\s+|my\\s+)?changes)?(?:\\s+and|,)?\\s+close(?:\\s+${TAB})?$`,
);

// window.close() is ignored for tabs the script did not open; the tab is then
// still there a moment later.
export const CLOSE_CHECK_MS = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const closeTab = async (): Promise<JukeReply | undefined> => {
    getJukeEditorBridge()?.close();
    await delay(CLOSE_CHECK_MS);
    return window.closed ? undefined : { say: i18n('juke.reply.tab.cannotClose') };
};

const saveAndCloseTab = async (): Promise<JukeReply | undefined> => {
    try {
        await getJukeEditorBridge()?.save();
    } catch (error) {
        console.error('[juke] saving failed', error);
        return { say: i18n('juke.reply.tab.saveFailed') };
    }
    return closeTab();
};

const closing = (): JukeReply => ({ say: i18n('juke.reply.tab.closing'), prompt: null, after: closeTab });
const savingAndClosing = (): JukeReply => ({
    say: i18n('juke.reply.tab.savingAndClosing'),
    prompt: null,
    after: saveAndCloseTab,
});

export const closeTabCommand: JukeCommand<true> = {
    id: 'tab.close',
    modes: ['dialog'],
    prompts: [null],
    match: (text) => (CLOSE_PATTERN.test(text) ? true : null),
    run: () => {
        if (getJukeEditorBridge()?.hasUnsavedChanges()) {
            return { say: i18n('juke.reply.tab.unsaved'), prompt: 'closeTab' };
        }
        return closing();
    },
};

export const saveAndCloseTabCommand: JukeCommand<true> = {
    id: 'tab.saveAndClose',
    modes: ['dialog'],
    prompts: [null, 'closeTab'],
    match: (text) => (SAVE_AND_CLOSE_PATTERN.test(text) ? true : null),
    run: () => savingAndClosing(),
};

export const closeTabAnswerCommand: JukeCommand<YesNoArgs> = {
    id: 'tab.closeAnswer',
    modes: ['dialog'],
    prompts: ['closeTab'],
    match: (text) => parseYesNo(text),
    run: (args) => {
        switch (args.kind) {
            case 'yes':
                return savingAndClosing();
            case 'no':
                return closing();
            default:
                return { say: i18n('juke.reply.tab.unsaved') };
        }
    },
};

export const tabCommands: readonly JukeCommand[] = [closeTabCommand, saveAndCloseTabCommand, closeTabAnswerCommand];
