import { showWarning } from '@enonic/lib-admin-ui/notify/MessageBus';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { registerCommands, resolveCommand } from '../commands/command.registry';
import { contentCommands } from '../commands/content.commands';
import { projectCommands } from '../commands/project.commands';
import { searchCommands } from '../commands/search.commands';
import type { JukeReply } from '../commands/command.types';
import { sessionCommands, stripJukeAddress } from '../commands/session.commands';
import { smallTalkCommands } from '../commands/smalltalk.commands';
import { treeCommands } from '../commands/tree.commands';
import { normalizeTranscript } from '../speech/normalize';
import {
    createRecognizer as defaultCreateRecognizer,
    type Recognizer,
    type RecognizerHandlers,
} from '../speech/recognizer';
import { createSpeaker as defaultCreateSpeaker, type Speaker } from '../speech/speaker';
import { resetCreateFlow } from './createFlow.store';
import { resetSearchFlow } from './searchFlow.store';
import {
    $jukeAvailable,
    getJukeContext,
    resetJukeState,
    setJukeActivity,
    setJukeMode,
    setJukePrompt,
    setJukeTranscript,
} from './juke.store';

//
// * Juke service
//
// Starts the microphone while Juke is available, routes transcripts to the
// command registry and speaks replies. Recognition is paused while speaking so
// Juke does not hear itself. Started explicitly from the app root.
//

export type JukeServiceDeps = {
    createRecognizer?: (handlers: RecognizerHandlers) => Recognizer | null;
    createSpeaker?: () => Speaker | null;
};

let unsubscribe: (() => void) | null = null;
let recognizer: Recognizer | null = null;
let speaker: Speaker | null = null;
let deniedNotified = false;
let deps: Required<JukeServiceDeps> = {
    createRecognizer: (handlers) => defaultCreateRecognizer(handlers),
    createSpeaker: () => defaultCreateSpeaker(),
};

// Replies are spoken one after another, never interleaved.
let queue: Promise<void> = Promise.resolve();

// A command that neither answers nor fails within this time is treated as failed,
// so Juke never falls silent with the queue blocked behind it.
export const COMMAND_TIMEOUT_MS = 20_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`command timed out after ${ms} ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });

const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error) => {
        console.error('[juke] command failed', error);
    });
};

const respond = async (reply: JukeReply): Promise<void> => {
    setJukeActivity('speaking');
    recognizer?.pause();
    try {
        await speaker?.speak(reply.say);
    } finally {
        setJukeActivity('listening');
        if (reply.prompt !== undefined) {
            setJukePrompt(reply.prompt);
        }
        if (reply.mode != null) {
            setJukeMode(reply.mode);
        }
        recognizer?.resume();
    }
};

const handleTranscripts = (alternatives: string[]): void => {
    const normalized = alternatives.map(normalizeTranscript).filter((text) => text.length > 0);
    if (normalized.length === 0) {
        return;
    }
    setJukeTranscript(normalized[0]);

    const context = getJukeContext();
    if (context.mode === 'off') {
        return;
    }

    const candidates = context.mode === 'dialog' ? normalized.map(stripJukeAddress) : normalized;
    const resolved = resolveCommand(candidates, context);
    console.info(
        '[juke] heard',
        JSON.stringify(candidates[0]),
        '->',
        resolved?.command.id ?? 'no command',
        context.mode,
    );
    if (resolved == null) {
        if (context.mode === 'dialog') {
            enqueue(() => respond({ say: i18n('juke.reply.unknown') }));
        }
        return;
    }

    enqueue(async () => {
        let reply: JukeReply | null;
        try {
            reply = await withTimeout(
                Promise.resolve(resolved.command.run(resolved.args, context)),
                COMMAND_TIMEOUT_MS,
            );
        } catch (error) {
            console.error(`[juke] command ${resolved.command.id} failed`, error);
            reply = { say: i18n('juke.reply.failed') };
        }
        if (reply != null) {
            await respond(reply);
        }
    });
};

const deactivate = (): void => {
    recognizer?.stop();
    recognizer = null;
    speaker?.cancel();
    speaker = null;
    resetJukeState();
    resetCreateFlow();
    resetSearchFlow();
};

const handleDenied = (): void => {
    deactivate();
    if (!deniedNotified) {
        deniedNotified = true;
        showWarning(i18n('juke.notify.micDenied'), false);
    }
};

const activate = (): void => {
    if (recognizer != null) {
        return;
    }
    speaker = deps.createSpeaker();
    recognizer = deps.createRecognizer({ onTranscripts: handleTranscripts, onDenied: handleDenied });
    if (recognizer == null || speaker == null) {
        deactivate();
        return;
    }
    recognizer.start();
    setJukeMode('idle');
};

/**
 * Start Juke. Safe to call multiple times - will only initialize once.
 */
export const start = (overrides: JukeServiceDeps = {}): void => {
    if (unsubscribe != null) {
        return;
    }
    deps = { ...deps, ...overrides };
    registerCommands(
        ...sessionCommands,
        ...smallTalkCommands,
        ...projectCommands,
        ...contentCommands,
        ...searchCommands,
        ...treeCommands,
    );
    unsubscribe = $jukeAvailable.subscribe((available) => {
        if (available) {
            activate();
        } else {
            deactivate();
        }
    });
};

/**
 * Stop Juke, release the microphone and detach all subscriptions.
 */
export const stop = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    deactivate();
    queue = Promise.resolve();
};
