import { normalizeTranscript } from '../speech/normalize';

//
// * Spoken name matching
//
// Resolves a spoken name against display names. Tiers are tried in order and
// the first tier with hits decides: exact, label starts with the spoken text,
// label contains it (or the other way round), every spoken word appears in the
// label. A tier with more than one hit is ambiguous, never a guess.
//

export type MatchCandidate<T> = {
    value: T;
    labels: readonly string[];
};

export type MatchResult<T> =
    | { kind: 'match'; value: T; labelIndex: number }
    | { kind: 'ambiguous'; values: T[] }
    | { kind: 'none' };

type Tier = (label: string, spoken: string, spokenWords: string[]) => boolean;

const TIERS: readonly Tier[] = [
    (label, spoken) => label === spoken,
    (label, spoken) => label.startsWith(spoken),
    (label, spoken) => label.includes(spoken) || (label.length >= 3 && spoken.includes(label)),
    (label, _spoken, words) => {
        const labelWords = label.split(' ');
        return words.every((word) => labelWords.includes(word));
    },
];

function uniqueValues<T>(hits: readonly { value: T }[]): T[] {
    return [...new Set(hits.map((hit) => hit.value))];
}

// Runs a parser over every alternative and returns the values it yields, best
// alternative first and without duplicates.
export function parseAlternatives<T>(
    alternatives: readonly string[] | undefined,
    fallback: string,
    parse: (text: string) => T | null,
): T[] {
    const texts = alternatives != null && alternatives.length > 0 ? alternatives : [fallback];
    const seen = new Set<string>();
    const values: T[] = [];
    texts.forEach((text) => {
        const value = parse(text);
        const key = JSON.stringify(value);
        if (value != null && !seen.has(key)) {
            seen.add(key);
            values.push(value);
        }
    });
    return values;
}

export function bestUniqueMatch<T>(candidates: readonly MatchCandidate<T>[], spokenName: string): MatchResult<T> {
    const spoken = normalizeTranscript(spokenName);
    if (spoken.length === 0) {
        return { kind: 'none' };
    }
    const spokenWords = spoken.split(' ');

    const normalized = candidates.map((candidate) => ({
        value: candidate.value,
        // Index kept so the caller knows which label (display name, name, ...) matched.
        labels: candidate.labels
            .map((label, index) => ({ index, text: normalizeTranscript(label) }))
            .filter((label) => label.text.length > 0),
    }));

    for (const tier of TIERS) {
        const hits = normalized
            .map((candidate) => ({
                value: candidate.value,
                labelIndex: candidate.labels.find((label) => tier(label.text, spoken, spokenWords))?.index ?? -1,
            }))
            .filter((hit) => hit.labelIndex >= 0);
        const values = uniqueValues(hits);
        if (values.length === 1) {
            return { kind: 'match', value: values[0], labelIndex: hits[0].labelIndex };
        }
        if (values.length > 1) {
            return { kind: 'ambiguous', values };
        }
    }

    return { kind: 'none' };
}
