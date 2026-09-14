import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker, JUKE_VOICE_NAME, pickVoice } from './speaker';

const voice = (name: string, lang: string): SpeechSynthesisVoice =>
    ({ name, lang, default: false, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

class FakeUtterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
        this.text = text;
    }
}

describe('pickVoice', () => {
    it('prefers the Juke voice by name', () => {
        const voices = [voice('Samantha', 'en-US'), voice('Daniel', 'en-GB'), voice(JUKE_VOICE_NAME, 'en-US')];
        expect(pickVoice(voices)?.name).toBe(JUKE_VOICE_NAME);
    });

    it('falls back to US English, then any English', () => {
        expect(pickVoice([voice('Daniel', 'en-GB'), voice('Samantha', 'en-US')])?.name).toBe('Samantha');
        expect(pickVoice([voice('Nora', 'nb-NO'), voice('Daniel', 'en-GB')])?.name).toBe('Daniel');
    });

    it('returns null when no English voice exists', () => {
        expect(pickVoice([voice('Nora', 'nb-NO')])).toBeNull();
        expect(pickVoice([])).toBeNull();
    });
});

describe('createSpeaker', () => {
    const spoken: FakeUtterance[] = [];
    const synth = {
        cancel: vi.fn(),
        getVoices: vi.fn(() => [voice('Daniel', 'en-GB'), voice(JUKE_VOICE_NAME, 'en-US')]),
        speak: vi.fn((utterance: FakeUtterance) => {
            spoken.push(utterance);
        }),
    } as unknown as SpeechSynthesis;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
        spoken.length = 0;
        vi.mocked(synth.cancel).mockClear();
        vi.mocked(synth.speak).mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('returns null without speech synthesis', () => {
        expect(createSpeaker({ synth: null })).toBeNull();
    });

    it('speaks with the Juke voice and resolves when the utterance ends', async () => {
        const speaker = createSpeaker({ synth })!;
        const done = vi.fn();

        void speaker.speak('Hello, Alan.').then(done);

        expect(synth.cancel).toHaveBeenCalledTimes(1);
        expect(spoken).toHaveLength(1);
        expect(spoken[0].text).toBe('Hello, Alan.');
        expect(spoken[0].voice?.name).toBe(JUKE_VOICE_NAME);
        expect(spoken[0].lang).toBe('en-US');

        spoken[0].onend?.();
        await Promise.resolve();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('resolves on error and via the safety timeout', async () => {
        const speaker = createSpeaker({ synth })!;

        const onError = vi.fn();
        void speaker.speak('x').then(onError);
        spoken[0].onerror?.();
        await Promise.resolve();
        expect(onError).toHaveBeenCalledTimes(1);

        const onTimeout = vi.fn();
        void speaker.speak('silent').then(onTimeout);
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('re-evaluates the voice until one is available', () => {
        const emptySynth = { ...synth, getVoices: vi.fn(() => []) } as unknown as SpeechSynthesis;
        const speaker = createSpeaker({ synth: emptySynth })!;

        void speaker.speak('first');
        expect(spoken[0].voice).toBeNull();
        expect(spoken[0].lang).toBe('en-US');

        vi.mocked(emptySynth.getVoices).mockReturnValue([voice(JUKE_VOICE_NAME, 'en-US')]);
        void speaker.speak('second');
        expect(spoken[1].voice?.name).toBe(JUKE_VOICE_NAME);
    });
});
