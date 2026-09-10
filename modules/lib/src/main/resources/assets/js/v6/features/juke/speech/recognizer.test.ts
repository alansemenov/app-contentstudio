import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecognizer, INITIAL_BACKOFF_MS, RESUME_DELAY_MS } from './recognizer';
import type { JukeRecognition, JukeRecognitionErrorEvent, JukeRecognitionResultEvent } from './support';

class FakeRecognition implements JukeRecognition {
    static instances: FakeRecognition[] = [];

    lang = '';
    continuous = false;
    interimResults = true;
    maxAlternatives = 1;
    onresult: ((event: JukeRecognitionResultEvent) => void) | null = null;
    onerror: ((event: JukeRecognitionErrorEvent) => void) | null = null;
    onend: (() => void) | null = null;
    started = 0;
    aborted = 0;

    constructor() {
        FakeRecognition.instances.push(this);
    }

    start(): void {
        this.started++;
    }

    stop(): void {
        this.onend?.();
    }

    abort(): void {
        this.aborted++;
        this.onend?.();
    }

    emitFinal(alternatives: string[], extraNonFinal = false): void {
        const result = Object.assign(
            alternatives.map((transcript) => ({ transcript, confidence: 1 })),
            { isFinal: true, item: (i: number) => ({ transcript: alternatives[i], confidence: 1 }) },
        );
        const results: unknown[] = [result];
        if (extraNonFinal) {
            results.push(Object.assign([{ transcript: 'partial', confidence: 0 }], { isFinal: false }));
        }
        this.onresult?.({ resultIndex: 0, results: results as unknown as SpeechRecognitionResultList });
    }

    emitError(error: string): void {
        this.onerror?.({ error });
    }

    end(): void {
        this.onend?.();
    }
}

const latest = (): FakeRecognition => FakeRecognition.instances[FakeRecognition.instances.length - 1];

const MAX_WAIT = 60_000;

describe('createRecognizer', () => {
    const onTranscripts = vi.fn();
    const onDenied = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        FakeRecognition.instances = [];
        onTranscripts.mockReset();
        onDenied.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const create = () => createRecognizer({ onTranscripts, onDenied }, { ctor: FakeRecognition })!;

    it('returns null when the browser has no recognition constructor', () => {
        expect(createRecognizer({ onTranscripts, onDenied }, { ctor: null })).toBeNull();
    });

    it('starts a continuous, final-only recognition with alternatives', () => {
        const recognizer = create();
        recognizer.start();

        const instance = latest();
        expect(instance.started).toBe(1);
        expect(instance.continuous).toBe(true);
        expect(instance.interimResults).toBe(false);
        expect(instance.maxAlternatives).toBe(3);
        expect(instance.lang).toBe('en-US');
        expect(recognizer.isActive()).toBe(true);
    });

    it('reports final alternatives and ignores interim results', () => {
        create().start();
        latest().emitFinal(['Hello Juke', 'hello duke'], true);

        expect(onTranscripts).toHaveBeenCalledTimes(1);
        expect(onTranscripts).toHaveBeenCalledWith(['Hello Juke', 'hello duke']);
    });

    it('restarts with a fresh instance when recognition ends on its own', () => {
        create().start();
        latest().end();
        vi.advanceTimersByTime(0);

        expect(FakeRecognition.instances).toHaveLength(2);
        expect(latest().started).toBe(1);
    });

    it('backs off after network errors and resets after a result', () => {
        create().start();
        latest().emitError('network');
        latest().end();
        vi.advanceTimersByTime(INITIAL_BACKOFF_MS - 1);
        expect(FakeRecognition.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeRecognition.instances).toHaveLength(2);

        latest().emitError('network');
        latest().end();
        vi.advanceTimersByTime(INITIAL_BACKOFF_MS * 2);
        expect(FakeRecognition.instances).toHaveLength(3);

        latest().emitFinal(['hello juke']);
        latest().end();
        vi.advanceTimersByTime(0);
        expect(FakeRecognition.instances).toHaveLength(4);
    });

    it('stops for good and reports when the microphone is denied', () => {
        const recognizer = create();
        recognizer.start();
        latest().emitError('not-allowed');
        vi.advanceTimersByTime(MAX_WAIT);

        expect(onDenied).toHaveBeenCalledTimes(1);
        expect(recognizer.isActive()).toBe(false);
        expect(FakeRecognition.instances).toHaveLength(1);
    });

    it('pause aborts without restarting; resume restarts after a short delay', () => {
        const recognizer = create();
        recognizer.start();
        recognizer.pause();

        expect(latest().aborted).toBe(1);
        expect(recognizer.isPaused()).toBe(true);
        vi.advanceTimersByTime(MAX_WAIT);
        expect(FakeRecognition.instances).toHaveLength(1);

        recognizer.resume();
        vi.advanceTimersByTime(RESUME_DELAY_MS - 1);
        expect(FakeRecognition.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeRecognition.instances).toHaveLength(2);
        expect(recognizer.isPaused()).toBe(false);
    });

    it('stop aborts and prevents any restart', () => {
        const recognizer = create();
        recognizer.start();
        recognizer.stop();

        expect(latest().aborted).toBe(1);
        vi.advanceTimersByTime(MAX_WAIT);
        expect(FakeRecognition.instances).toHaveLength(1);
        expect(recognizer.isActive()).toBe(false);
    });

    it('start is idempotent', () => {
        const recognizer = create();
        recognizer.start();
        recognizer.start();
        expect(FakeRecognition.instances).toHaveLength(1);
    });
});
