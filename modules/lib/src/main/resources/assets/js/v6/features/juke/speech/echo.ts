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

// Drops the leading run of words that Juke just said. Without a pause between
// Juke's reply and the answer, Chrome merges both into one transcript
// ("do you want to see them yes"); the remainder ("yes") is the answer.
export function stripEchoPrefix(transcript: string, spoken: string | null): string {
    if (spoken == null) {
        return transcript;
    }
    const spokenWords = new Set(normalizeTranscript(spoken).split(' ').filter(Boolean));
    const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
    let index = 0;
    while (index < words.length && spokenWords.has(words[index])) {
        index++;
    }
    return words.slice(index).join(' ');
}

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
