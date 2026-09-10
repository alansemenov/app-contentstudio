import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { queryContent } from '../../../entities/content/api/contentQuery.api';
import { bestUniqueMatch, type MatchResult } from './matching';

//
// * Content lookup by spoken name
//
// Runs the same free-text search the browse filter panel uses (fulltext and
// ngram over display name, name and all text) in the current project, then
// narrows the hits to a unique display-name match.
//

const SEARCH_FIELDS = ['displayName^5', '_name^3', '_allText'];
const MAX_HITS = 50;

export function buildTextSearchQuery(text: string): object {
    return {
        boolean: {
            should: [
                { fulltext: { fields: SEARCH_FIELDS, query: text, operator: 'AND' } },
                { ngram: { fields: SEARCH_FIELDS, query: text, operator: 'AND' } },
            ],
        },
    };
}

export async function searchContentByText(text: string, excludeIds: readonly string[] = []): Promise<ContentSummary[]> {
    const result = await queryContent({ from: 0, size: MAX_HITS, query: buildTextSearchQuery(text) });
    if (result.isErr()) {
        throw result.error;
    }
    const excluded = new Set(excludeIds);
    return result.value.contents.filter((content) => !excluded.has(content.getContentId().toString()));
}

export async function findContentByName(
    spokenName: string,
    excludeIds: readonly string[] = [],
): Promise<MatchResult<ContentSummary>> {
    const hits = await searchContentByText(spokenName, excludeIds);
    return bestUniqueMatch(
        hits.map((content) => ({ value: content, labels: [content.getDisplayName(), content.getName().toString()] })),
        spokenName,
    );
}
