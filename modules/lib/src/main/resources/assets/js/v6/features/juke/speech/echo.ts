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

export type Spoken = string | readonly string[] | null;

function spokenWordSet(spoken: Spoken): Set<string> {
    const phrases = spoken == null ? [] : typeof spoken === 'string' ? [spoken] : spoken;
    return new Set(phrases.flatMap((phrase) => normalizeTranscript(phrase).split(' ')).filter(Boolean));
}

// Drops the leading run of words that Juke recently said. Without a pause
// between Juke's reply and the answer, Chrome merges both into one transcript
// ("do you want to see them yes"); the remainder ("yes") is the answer.
export function stripEchoPrefix(transcript: string, spoken: Spoken): string {
    const spokenWords = spokenWordSet(spoken);
    const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
    let index = 0;
    while (index < words.length && spokenWords.has(words[index])) {
        index++;
    }
    return words.slice(index).join(' ');
}

// Chrome may finalize the echo of one reply only after the next reply has
// started, so several recent replies are matched, not just the last one.
export function isEchoOf(transcript: string, spoken: Spoken): boolean {
    const spokenWords = spokenWordSet(spoken);
    const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
    if (words.length === 0 || spokenWords.size === 0) {
        return false;
    }
    const overlap = words.filter((word) => spokenWords.has(word)).length / words.length;
    return overlap >= ECHO_WORD_OVERLAP;
}
