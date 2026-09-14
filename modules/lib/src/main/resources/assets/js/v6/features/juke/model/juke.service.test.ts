import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@enonic/lib-admin-ui/security/Principal';
import { $config } from '../../../shared/config/config.store';
import { clearCommands, registerCommands } from '../commands/command.registry';
import type { Recognizer, RecognizerHandlers } from '../speech/recognizer';
import type { Speaker } from '../speech/speaker';
import { ECHO_GRACE_MS, start, stop } from './juke.service';
import { $jukeActivity, $jukeMode, $jukePrompt, $jukeSpeechSupported, $jukeTranscript } from './juke.store';

const { mockShowWarning } = vi.hoisted(() => ({ mockShowWarning: vi.fn() }));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('@enonic/lib-admin-ui/notify/MessageBus', () => ({
    showWarning: mockShowWarning,
}));

type FakeRecognizer = Recognizer & {
    handlers: RecognizerHandlers;
    startCalls: number;
    stopCalls: number;
    pauseCalls: number;
    resumeCalls: number;
};

type PendingSpeech = { text: string; resolve: () => void };

let recognizers: FakeRecognizer[] = [];
let speeches: PendingSpeech[] = [];
let speakerCancels = 0;

const createRecognizer = (handlers: RecognizerHandlers): Recognizer => {
    let active = false;
    let paused = false;
    const recognizer: FakeRecognizer = {
        handlers,
        startCalls: 0,
        stopCalls: 0,
        pauseCalls: 0,
        resumeCalls: 0,
        start: () => {
            recognizer.startCalls++;
            active = true;
        },
        stop: () => {
            recognizer.stopCalls++;
            active = false;
        },
        pause: () => {
            recognizer.pauseCalls++;
            paused = true;
        },
        resume: () => {
            recognizer.resumeCalls++;
            paused = false;
        },
        isActive: () => active,
        isPaused: () => paused,
    };
    recognizers.push(recognizer);
    return recognizer;
};

const createSpeaker = (): Speaker => ({
    speak: (text) =>
        new Promise<void>((resolve) => {
            speeches.push({ text, resolve });
        }),
    cancel: () => {
        speakerCancels++;
    },
});

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const latest = (): FakeRecognizer => recognizers[recognizers.length - 1];

const hear = async (...alternatives: string[]): Promise<void> => {
    latest().handlers.onTranscripts(alternatives);
    await flush();
};

// Resolves the current utterance and steps past the echo grace window, as a
// user answering a moment after Juke stops would.
const finishSpeaking = async (): Promise<void> => {
    await flush();
    speeches.shift()?.resolve();
    await flush();
    vi.advanceTimersByTime(ECHO_GRACE_MS + 50);
};

const makeAvailable = (): void => {
    $jukeSpeechSupported.set(true);
    $config.setKey('browseMode', true);
    $config.setKey('user', { getDisplayName: () => 'Alan' } as unknown as Principal);
    $config.setKey('aiEnabled', true);
};

describe('juke.service', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        recognizers = [];
        speeches = [];
        speakerCancels = 0;
        mockShowWarning.mockReset();
        clearCommands();
        $jukeSpeechSupported.set(false);
        $config.setKey('browseMode', false);
        $config.setKey('aiEnabled', false);
    });

    afterEach(() => {
        stop();
        vi.useRealTimers();
    });

    it('stays off until the operator is running in browse mode with speech support', () => {
        start({ createRecognizer, createSpeaker });
        expect($jukeMode.get()).toBe('off');
        expect(recognizers).toHaveLength(0);

        $jukeSpeechSupported.set(true);
        $config.setKey('browseMode', true);
        expect(recognizers).toHaveLength(0);

        $config.setKey('aiEnabled', true);
        expect(recognizers).toHaveLength(1);
        expect(latest().startCalls).toBe(1);
        expect($jukeMode.get()).toBe('idle');
    });

    it('never starts the microphone outside the browse view', () => {
        start({ createRecognizer, createSpeaker });
        $jukeSpeechSupported.set(true);
        $config.setKey('aiEnabled', true);
        expect(recognizers).toHaveLength(0);
        expect($jukeMode.get()).toBe('off');
    });

    it('ignores everything but the wake phrase while idle', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('go to superhero');

        expect($jukeMode.get()).toBe('idle');
        expect(speeches).toHaveLength(0);
        expect($jukeTranscript.get()).toBe('go to superhero');
    });

    it('opens the dialog on "Hello, Juke" and greets by name while paused', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('Hello, Juke!');

        expect($jukeMode.get()).toBe('dialog');
        expect($jukeActivity.get()).toBe('speaking');
        expect(latest().pauseCalls).toBe(0);
        expect(speeches).toHaveLength(1);
        expect(speeches[0].text).toBe('juke.reply.hello|Alan');

        await finishSpeaking();

        expect($jukeActivity.get()).toBe('listening');
        expect(latest().resumeCalls).toBe(0);
        expect($jukeMode.get()).toBe('dialog');
    });

    it('answers unknown commands only in dialog mode', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('hello juke');
        await finishSpeaking();

        await hear('sing me a song');

        expect(speeches).toHaveLength(1);
        expect(speeches[0].text).toBe('juke.reply.unknown');
        await finishSpeaking();
        expect($jukeMode.get()).toBe('dialog');
    });

    it('closes the dialog on "Goodbye, Juke" after the farewell is spoken', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('hello juke');
        await finishSpeaking();

        await hear('goodbye juke');

        expect(speeches[0].text).toBe('juke.reply.goodbye|Alan');
        expect($jukeMode.get()).toBe('dialog');

        await finishSpeaking();

        expect($jukeMode.get()).toBe('idle');
        expect($jukePrompt.get()).toBeNull();
        expect($jukeActivity.get()).toBe('listening');
    });

    it('answers a command spoken together with the name while in dialog', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('hello juke');
        await finishSpeaking();

        await hear('hey juke, how are you?');

        expect(speeches[0].text).toBe('juke.reply.smalltalk.howAreYou|Alan');
    });

    it('ignores what it hears while speaking and its own echo afterwards', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('hello juke');
        expect($jukeActivity.get()).toBe('speaking');
        await hear('go to superhero');
        expect(speeches).toHaveLength(1);

        await flush();
        speeches.shift()?.resolve();
        await flush();
        vi.advanceTimersByTime(100);
        await hear('yes');
        expect(speeches).toHaveLength(0);

        vi.advanceTimersByTime(ECHO_GRACE_MS);
        await hear('juke reply hello alan');
        expect(speeches).toHaveLength(0);
        expect($jukeTranscript.get()).toBe('hello juke');

        await hear('how are you');
        expect(speeches[0].text).toBe('juke.reply.smalltalk.howAreYou|Alan');
    });

    it('speaks a failure reply when a command throws instead of falling silent', async () => {
        start({ createRecognizer, createSpeaker });
        registerCommands({
            id: 'test.boom',
            modes: ['dialog'],
            match: (text) => (text === 'explode' ? true : null),
            run: () => Promise.reject(new Error('boom')),
        });
        makeAvailable();

        await hear('hello juke');
        await finishSpeaking();

        await hear('explode');

        expect(speeches[0].text).toBe('juke.reply.failed');
        await finishSpeaking();

        await hear('goodbye juke');
        expect(speeches[0].text).toBe('juke.reply.goodbye|Alan');
    });

    it('uses later alternatives when the first one is misheard', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        await hear('yellow chute', 'hello juke');

        expect($jukeMode.get()).toBe('dialog');
    });

    it('turns off and warns once when the microphone is denied', () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();

        latest().handlers.onDenied();

        expect($jukeMode.get()).toBe('off');
        expect(latest().stopCalls).toBe(1);
        expect(mockShowWarning).toHaveBeenCalledTimes(1);
        expect(mockShowWarning).toHaveBeenCalledWith('juke.notify.micDenied', false);
    });

    it('releases the microphone when the operator goes away', async () => {
        start({ createRecognizer, createSpeaker });
        makeAvailable();
        await hear('hello juke');

        $config.setKey('aiEnabled', false);

        expect(latest().stopCalls).toBe(1);
        expect(speakerCancels).toBe(1);
        expect($jukeMode.get()).toBe('off');
    });

    it('start is idempotent and stop releases everything', () => {
        start({ createRecognizer, createSpeaker });
        start({ createRecognizer, createSpeaker });
        makeAvailable();
        expect(recognizers).toHaveLength(1);

        stop();
        expect(latest().stopCalls).toBe(1);
        expect($jukeMode.get()).toBe('off');
    });
});
