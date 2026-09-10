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

export type MatchResult<T> = { kind: 'match'; value: T } | { kind: 'ambiguous'; values: T[] } | { kind: 'none' };

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

function uniqueValues<T>(hits: MatchCandidate<T>[]): T[] {
    return [...new Set(hits.map((hit) => hit.value))];
}

export function bestUniqueMatch<T>(candidates: readonly MatchCandidate<T>[], spokenName: string): MatchResult<T> {
    const spoken = normalizeTranscript(spokenName);
    if (spoken.length === 0) {
        return { kind: 'none' };
    }
    const spokenWords = spoken.split(' ');

    const normalized = candidates.map((candidate) => ({
        value: candidate.value,
        labels: candidate.labels.map(normalizeTranscript).filter((label) => label.length > 0),
    }));

    for (const tier of TIERS) {
        const hits = normalized.filter((candidate) =>
            candidate.labels.some((label) => tier(label, spoken, spokenWords)),
        );
        const values = uniqueValues(hits);
        if (values.length === 1) {
            return { kind: 'match', value: values[0] };
        }
        if (values.length > 1) {
            return { kind: 'ambiguous', values };
        }
    }

    return { kind: 'none' };
}
