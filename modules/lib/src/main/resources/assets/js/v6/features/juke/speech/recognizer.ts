import { getRecognitionCtor, type JukeRecognition, type JukeRecognitionCtor } from './support';

//
// * Continuous speech recognizer
//
// Chrome stops continuous recognition on silence, on network hiccups and
// roughly once a minute, so every `end` restarts a fresh instance while the
// recognizer is active. `pause`/`resume` bracket Juke's own speech so it does
// not transcribe itself.
//
// Chrome runs one recognition session per profile: while another tab holds the
// microphone, a new session ends at once without an error or a result. Such
// ends back off like errors do, so the tab retries calmly until the other tab
// lets go (e.g. the browse tab after handing over to the editor).
//

export type RecognizerHandlers = {
    // Final transcript alternatives for one utterance, best first.
    onTranscripts: (alternatives: string[]) => void;
    // Microphone access was refused; the recognizer has stopped for good.
    onDenied: () => void;
};

export type RecognizerOptions = {
    ctor?: JukeRecognitionCtor | null;
    lang?: string;
    maxAlternatives?: number;
};

export type Recognizer = {
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
    isActive(): boolean;
    isPaused(): boolean;
};

export const RESUME_DELAY_MS = 300;
export const INITIAL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 10_000;
// A session that ends sooner than this without a result never really ran.
export const QUICK_END_MS = 1000;

const DENIED_ERRORS = new Set(['not-allowed', 'service-not-allowed']);
const BACKOFF_ERRORS = new Set(['network', 'audio-capture']);

export function createRecognizer(handlers: RecognizerHandlers, options: RecognizerOptions = {}): Recognizer | null {
    const Ctor = options.ctor === undefined ? getRecognitionCtor() : options.ctor;
    if (Ctor == null) {
        return null;
    }

    const lang = options.lang ?? 'en-US';
    const maxAlternatives = options.maxAlternatives ?? 3;

    let active = false;
    let paused = false;
    let backoff = 0;
    let instance: JukeRecognition | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let startedAt = 0;
    let heardSomething = false;

    const increaseBackoff = (): void => {
        backoff = backoff === 0 ? INITIAL_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, backoff * 2);
    };

    const clearRestart = (): void => {
        if (restartTimer != null) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
    };

    const dropInstance = (): void => {
        if (instance == null) {
            return;
        }
        const current = instance;
        instance = null;
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        try {
            current.abort();
        } catch {
            // already stopped
        }
    };

    const scheduleRestart = (delay: number): void => {
        clearRestart();
        restartTimer = setTimeout(() => {
            restartTimer = null;
            startInstance();
        }, delay);
    };

    const handleResult = (event: { resultIndex: number; results: SpeechRecognitionResultList }): void => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result?.isFinal) {
                continue;
            }
            const alternatives: string[] = [];
            for (let j = 0; j < result.length; j++) {
                const transcript = result[j]?.transcript?.trim();
                if (transcript) {
                    alternatives.push(transcript);
                }
            }
            if (alternatives.length > 0) {
                backoff = 0;
                heardSomething = true;
                handlers.onTranscripts(alternatives);
            }
        }
    };

    const handleError = (event: { error: string }): void => {
        console.info('[juke] recognition error', event.error);
        if (DENIED_ERRORS.has(event.error)) {
            active = false;
            clearRestart();
            dropInstance();
            handlers.onDenied();
            return;
        }
        if (BACKOFF_ERRORS.has(event.error)) {
            increaseBackoff();
        }
    };

    const handleEnd = (): void => {
        instance = null;
        const endedAtOnce = !heardSomething && Date.now() - startedAt < QUICK_END_MS;
        if (endedAtOnce && active && !paused) {
            increaseBackoff();
        }
        console.info(
            '[juke] recognition ended',
            endedAtOnce ? 'at once (microphone busy?),' : '',
            active && !paused ? `restarting in ${backoff} ms` : 'stopped',
        );
        if (active && !paused) {
            scheduleRestart(backoff);
        }
    };

    function startInstance(): void {
        if (!active || paused || instance != null) {
            return;
        }
        try {
            const recognition = new Ctor();
            recognition.lang = lang;
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.maxAlternatives = maxAlternatives;
            recognition.onresult = handleResult;
            recognition.onerror = handleError;
            recognition.onend = handleEnd;
            instance = recognition;
            startedAt = Date.now();
            heardSomething = false;
            recognition.start();
            console.info('[juke] recognition started');
        } catch (error) {
            console.error('[juke] speech recognition failed to start', error);
            instance = null;
            scheduleRestart(INITIAL_BACKOFF_MS);
        }
    }

    return {
        start(): void {
            if (active) {
                return;
            }
            active = true;
            paused = false;
            backoff = 0;
            startInstance();
        },
        stop(): void {
            active = false;
            paused = false;
            clearRestart();
            dropInstance();
        },
        pause(): void {
            if (!active || paused) {
                return;
            }
            paused = true;
            clearRestart();
            dropInstance();
        },
        resume(): void {
            if (!active || !paused) {
                return;
            }
            paused = false;
            scheduleRestart(RESUME_DELAY_MS);
        },
        isActive: () => active,
        isPaused: () => paused,
    };
}
