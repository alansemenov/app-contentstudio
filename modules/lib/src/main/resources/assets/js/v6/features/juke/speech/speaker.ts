import { getSynthesis } from './support';

//
// * Speech synthesis
//
// Speaks one phrase at a time with Juke's voice. Voices load asynchronously in
// Chrome, so the pick is re-evaluated on every utterance until a voice is found.
//

export const JUKE_VOICE_NAME = 'Google UK English Male';
export const JUKE_VOICE_LANG = 'en-GB';

export type SpeakerOptions = {
    synth?: SpeechSynthesis | null;
    rate?: number;
    pitch?: number;
};

export type Speaker = {
    speak(text: string): Promise<void>;
    cancel(): void;
};

// Preferred voice by name, then any British English voice, then any English voice.
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    return (
        voices.find((voice) => voice.name === JUKE_VOICE_NAME) ??
        voices.find((voice) => voice.lang.toLowerCase().startsWith(JUKE_VOICE_LANG.toLowerCase())) ??
        voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ??
        null
    );
}

// Guards against utterances whose `end` event never fires (a known Chrome quirk).
function safetyTimeout(text: string): number {
    return Math.max(3000, text.length * 120);
}

export function createSpeaker(options: SpeakerOptions = {}): Speaker | null {
    const synth = options.synth === undefined ? getSynthesis() : options.synth;
    if (synth == null) {
        return null;
    }

    const rate = options.rate ?? 1;
    const pitch = options.pitch ?? 1;
    let voice: SpeechSynthesisVoice | null = null;

    const resolveVoice = (): SpeechSynthesisVoice | null => {
        if (voice == null) {
            voice = pickVoice(synth.getVoices());
        }
        return voice;
    };

    return {
        speak(text: string): Promise<void> {
            return new Promise((resolve) => {
                synth.cancel();

                const utterance = new SpeechSynthesisUtterance(text);
                const picked = resolveVoice();
                if (picked) {
                    utterance.voice = picked;
                    utterance.lang = picked.lang;
                } else {
                    utterance.lang = JUKE_VOICE_LANG;
                }
                utterance.rate = rate;
                utterance.pitch = pitch;

                let settled = false;
                const finish = (): void => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(finish, safetyTimeout(text));

                utterance.onend = finish;
                utterance.onerror = finish;
                synth.speak(utterance);
            });
        },
        cancel(): void {
            synth.cancel();
        },
    };
}
