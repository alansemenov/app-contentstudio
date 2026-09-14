import { normalizeTranscript } from './normalize';

//
// * Echo detection
//
// Recognition keeps running while Juke speaks, so the microphone hears Juke's
// own voice. Its final transcript arrives shortly after the utterance ends and
// consists mostly of the words just spoken; a user answer such as "yes" or
// "under blogs" shares few or none of them.
//

export const ECHO_WORD_OVERLAP = 0.6;

export function isEchoOf(transcript: string, spoken: string | null): boolean {
    if (spoken == null) {
        return false;
    }
    const spokenWords = new Set(normalizeTranscript(spoken).split(' ').filter(Boolean));
    const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
    if (words.length === 0 || spokenWords.size === 0) {
        return false;
    }
    const overlap = words.filter((word) => spokenWords.has(word)).length / words.length;
    return overlap >= ECHO_WORD_OVERLAP;
}
