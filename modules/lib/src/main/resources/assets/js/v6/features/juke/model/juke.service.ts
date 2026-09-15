import { showWarning } from '@enonic/lib-admin-ui/notify/MessageBus';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { registerCommands, resolveCommand } from '../commands/command.registry';
import type { JukeHandoff, JukeReply } from '../commands/command.types';
import { allCommands, editorCommands } from '../commands/all.commands';
import { stripJukeAddress } from '../commands/session.commands';
import { isEchoOf, stripEchoPrefix } from '../speech/echo';
import { normalizeTranscript } from '../speech/normalize';
import {
    createRecognizer as defaultCreateRecognizer,
    type Recognizer,
    type RecognizerHandlers,
} from '../speech/recognizer';
import { createSpeaker as defaultCreateSpeaker, type Speaker } from '../speech/speaker';
import { $config } from '../../../shared/config/config.store';
import { resetActionFlow } from './actionFlow.store';
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
// command registry and speaks replies. Recognition keeps running while Juke
// speaks; its own words are filtered out. Started explicitly from the app root.
// In an editor tab opened by Juke the dialog is open from the start, and the
// browse tab that handed over stays quiet until that tab is closed.
//

export type JukeServiceDeps = {
    createRecognizer?: (handlers: RecognizerHandlers) => Recognizer | null;
    createSpeaker?: () => Speaker | null;
};

let unsubscribe: (() => void) | null = null;
let recognizer: Recognizer | null = null;
let speaker: Speaker | null = null;
let deniedNotified = false;
let commandsRegistered = false;
// Set while the conversation is in another tab.
let handoffTimer: ReturnType<typeof setInterval> | null = null;
let deps: Required<JukeServiceDeps> = {
    createRecognizer: (handlers) => defaultCreateRecognizer(handlers),
    createSpeaker: () => defaultCreateSpeaker(),
};

// Replies are spoken one after another, never interleaved.
let queue: Promise<void> = Promise.resolve();

// Recognition keeps running while Juke speaks so a quick answer is not lost in
// the recognizer's restart gap. Transcripts finalized during speech, shortly
// after it, or echoing what was just said are dropped instead.
// Chrome finalizes the echo of a reply up to about a second after the voice
// stops; a user answer is finalized later than that.
export const ECHO_GRACE_MS = 1000;
let speaking = false;
let speechEndedAt = 0;
// The last few replies; see isEchoOf for why more than one is kept.
export const RECENT_SPOKEN_SIZE = 3;
let recentSpoken: string[] = [];

// A command that neither answers nor fails within this time is treated as failed,
// so Juke never falls silent with the queue blocked behind it.
export const COMMAND_TIMEOUT_MS = 20_000;

// How often the browse tab checks whether the editor tab it handed over to is
// still open.
export const HANDOFF_POLL_MS = 1000;

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
    speaking = true;
    recentSpoken = [reply.say, ...recentSpoken].slice(0, RECENT_SPOKEN_SIZE);
    console.info('[juke] speaking', JSON.stringify(reply.say));
    try {
        await speaker?.speak(reply.say);
    } finally {
        speaking = false;
        speechEndedAt = Date.now();
        console.info('[juke] finished speaking');
        setJukeActivity('listening');
        if (reply.prompt !== undefined) {
            setJukePrompt(reply.prompt);
        }
        if (reply.mode != null) {
            setJukeMode(reply.mode);
        }
    }
};

// Returns the alternatives with Juke's own words removed, or null when nothing
// but echo was heard.
// Runs a command step, answering with the failure reply instead of throwing.
const runStep = async (
    step: () => Promise<JukeReply | null | undefined> | JukeReply | null | undefined,
    label: string,
): Promise<JukeReply | null> => {
    try {
        return (await withTimeout(Promise.resolve(step()), COMMAND_TIMEOUT_MS)) ?? null;
    } catch (error) {
        console.error(`[juke] ${label} failed`, error);
        return { say: i18n('juke.reply.failed') };
    }
};

const withoutSelfEcho = (normalized: readonly string[]): string[] | null => {
    if (speaking || Date.now() - speechEndedAt < ECHO_GRACE_MS) {
        return null;
    }
    const remaining = normalized
        .map((text) => stripEchoPrefix(text, recentSpoken))
        .filter((text) => text.length > 0 && !isEchoOf(text, recentSpoken));
    return remaining.length > 0 ? remaining : null;
};

const handleTranscripts = (alternatives: string[]): void => {
    const heard = alternatives.map(normalizeTranscript).filter((text) => text.length > 0);
    if (heard.length === 0) {
        return;
    }
    const normalized = withoutSelfEcho(heard);
    if (normalized == null) {
        console.info(
            '[juke] ignored own speech',
            JSON.stringify(heard[0]),
            speaking ? 'while speaking' : `${Date.now() - speechEndedAt} ms after speaking`,
        );
        return;
    }
    setJukeTranscript(normalized[0]);

    const context = getJukeContext();
    if (context.mode === 'off') {
        return;
    }

    const candidates = context.mode === 'dialog' ? normalized.map(stripJukeAddress) : normalized;
    context.alternatives = candidates;
    const resolved = resolveCommand(candidates, context);
    console.info(
        '[juke] heard',
        JSON.stringify(candidates[0]),
        candidates.length > 1 ? `(or ${JSON.stringify(candidates.slice(1))})` : '(single alternative)',
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

    // A general command spoken while a question is open (e.g. "create a folder"
    // during a search) abandons the question and its collected state.
    if (context.prompt != null && resolved.command.prompts?.includes(null)) {
        setJukePrompt(null);
        resetSearchFlow();
        resetCreateFlow();
        resetActionFlow();
        context.prompt = null;
    }

    enqueue(async () => {
        let reply = await runStep(() => resolved.command.run(resolved.args, context), `command ${resolved.command.id}`);
        while (reply != null) {
            // Chrome runs one recognition session at a time: let go of the
            // microphone before the hand-over reply so the editor tab can take it
            // while this tab is still speaking.
            if (reply.handoff != null) {
                recognizer?.stop();
            }
            await respond(reply);
            if (reply.handoff != null) {
                handOver(reply.handoff);
            }
            reply = reply.after == null ? null : await runStep(reply.after, `command ${resolved.command.id} follow-up`);
        }
    });
};

const stopHandoffWatch = (): void => {
    if (handoffTimer != null) {
        clearInterval(handoffTimer);
        handoffTimer = null;
    }
};

const deactivate = (): void => {
    stopHandoffWatch();
    recognizer?.stop();
    recognizer = null;
    speaker?.cancel();
    speaker = null;
    resetJukeState();
    resetCreateFlow();
    resetSearchFlow();
    resetActionFlow();
    speaking = false;
    speechEndedAt = 0;
    recentSpoken = [];
};

const handleDenied = (): void => {
    deactivate();
    if (!deniedNotified) {
        deniedNotified = true;
        showWarning(i18n('juke.notify.micDenied'), false);
    }
};

const isHandoffTab = (): boolean => !$config.get().browseMode;

const activate = (): void => {
    if (recognizer != null) {
        return;
    }
    if (!commandsRegistered) {
        registerCommands(...(isHandoffTab() ? editorCommands : allCommands));
        commandsRegistered = true;
    }
    speaker = deps.createSpeaker();
    recognizer = deps.createRecognizer({ onTranscripts: handleTranscripts, onDenied: handleDenied });
    if (recognizer == null || speaker == null) {
        deactivate();
        return;
    }
    recognizer.start();
    // After a hand-over the conversation simply continues in the new tab.
    setJukeMode(isHandoffTab() ? 'dialog' : 'idle');
};

// Goes quiet while the conversation continues in the other tab, and picks it up
// again, still in dialog mode, once that tab is closed.
const handOver = (target: JukeHandoff): void => {
    console.info('[juke] handing over to the editor tab');
    deactivate();
    handoffTimer = setInterval(() => {
        if (!target.closed) {
            return;
        }
        stopHandoffWatch();
        if ($jukeAvailable.get()) {
            console.info('[juke] editor tab closed, resuming');
            activate();
            setJukeMode('dialog');
        }
    }, HANDOFF_POLL_MS);
};

/**
 * Start Juke. Safe to call multiple times - will only initialize once.
 */
export const start = (overrides: JukeServiceDeps = {}): void => {
    if (unsubscribe != null) {
        return;
    }
    deps = { ...deps, ...overrides };
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
    commandsRegistered = false;
    queue = Promise.resolve();
};
