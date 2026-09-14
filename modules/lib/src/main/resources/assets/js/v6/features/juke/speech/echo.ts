import { normalizeTranscript } from './normalize';

//
// * Echo detection
//
// Recognition keeps running while Juke speaks, so the microphone hears Juke's
// own voice. Its final transcript arrives shortly after the utterance ends and
// consists mostly of the words just spoken; a user answer such as "yes" or
// "under blogs" shares few or none of them.
//

export const ECHO_WORD_OVERLAP = 0.8;
export const ECHO_MIN_WORDS = 3;
export const ECHO_PREFIX_MIN_WORDS = 2;

export type Spoken = string | readonly string[] | null;

const NUMBER_WORDS: Record<string, string> = {
    zero: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
    eleven: '11',
    twelve: '12',
};

// Recognition hears Juke's voice with homophone swaps ("hear" for "here",
// "one" for "1"), so words are compared by a crude sound key: number words as
// digits, and consonant skeletons for everything else.
export function echoKey(word: string): string {
    const numeric = NUMBER_WORDS[word];
    if (numeric != null) {
        return numeric;
    }
    if (/^\d+$/.test(word)) {
        return word;
    }
    const letters = word.replace(/[^a-z0-9]/g, '');
    if (letters.length <= 1) {
        return letters;
    }
    const skeleton = (letters[0] + letters.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
    // Plurals collapse onto the singular ("posts" / "post", "items" / "item").
    return skeleton.length > 3 && skeleton.endsWith('s') ? skeleton.slice(0, -1) : skeleton;
}

function words(text: string): string[] {
    return normalizeTranscript(text).split(' ').filter(Boolean).map(echoKey);
}

function spokenPhrases(spoken: Spoken): string[][] {
    const phrases = spoken == null ? [] : typeof spoken === 'string' ? [spoken] : spoken;
    return phrases.map(words).filter((phrase) => phrase.length > 0);
}

function endsWith(phrase: readonly string[], run: readonly string[]): boolean {
    if (run.length > phrase.length) {
        return false;
    }
    const offset = phrase.length - run.length;
    return run.every((word, i) => phrase[offset + i] === word);
}

// Drops a leading run of words (by sound key) that is the ending of one of
// Juke's recent replies, in order. Without a pause between the reply and the answer, Chrome
// merges both into one transcript ("do you want to see them yes"); the
// remainder ("yes") is the answer. Only in-order tails count, so a command
// that merely reuses a word Juke has said ("hello juke", "what can you do")
// stays intact.
export function stripEchoPrefix(transcript: string, spoken: Spoken): string {
    const original = normalizeTranscript(transcript).split(' ').filter(Boolean);
    const transcriptWords = original.map(echoKey);
    let longest = 0;
    for (const phrase of spokenPhrases(spoken)) {
        const max = Math.min(phrase.length, transcriptWords.length);
        for (let k = max; k >= ECHO_PREFIX_MIN_WORDS; k--) {
            if (k > longest && endsWith(phrase, transcriptWords.slice(0, k))) {
                longest = k;
                break;
            }
        }
    }
    return original.slice(longest).join(' ');
}

// A transcript is Juke's own echo when it is a contiguous piece of one recent
// reply, or when nearly all of its words come from a single reply (recognition
// hears "three" for "3" and the like). Several recent replies are matched
// because Chrome may finalize the echo of one reply only after the next started.
export function isEchoOf(transcript: string, spoken: Spoken): boolean {
    const transcriptWords = words(transcript);
    if (transcriptWords.length === 0) {
        return false;
    }
    const joined = transcriptWords.join(' ');
    return spokenPhrases(spoken).some((phrase) => {
        if (` ${phrase.join(' ')} `.includes(` ${joined} `)) {
            return true;
        }
        if (transcriptWords.length < ECHO_MIN_WORDS) {
            return false;
        }
        const set = new Set(phrase);
        const overlap = transcriptWords.filter((word) => set.has(word)).length / transcriptWords.length;
        return overlap >= ECHO_WORD_OVERLAP;
    });
}
