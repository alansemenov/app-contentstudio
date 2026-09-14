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

export type ContentLookupOptions = {
    excludeIds?: readonly string[];
    // Narrows the hits before matching, e.g. to items that can hold children.
    accept?: (content: ContentSummary) => boolean;
};

export async function searchContentByText(text: string, options: ContentLookupOptions = {}): Promise<ContentSummary[]> {
    // The query endpoint requires the list fields to be present, even when empty.
    const result = await queryContent({
        from: 0,
        size: MAX_HITS,
        contentTypeNames: [],
        queryFilters: [],
        aggregationQueries: [],
        query: buildTextSearchQuery(text),
    });
    if (result.isErr()) {
        throw result.error;
    }
    const excluded = new Set(options.excludeIds ?? []);
    const accept = options.accept ?? (() => true);
    return result.value.contents.filter(
        (content) => !excluded.has(content.getContentId().toString()) && accept(content),
    );
}

// Media and page templates cannot hold children, so they never make sense as a parent.
export function canHoldChildren(content: ContentSummary): boolean {
    const type = content.getType();
    return !type.isMedia() && !type.isDescendantOfMedia() && !type.isPageTemplate();
}

// Labels are matched in this order; index 1 is the path name.
export function contentLabels(content: ContentSummary): string[] {
    return [content.getDisplayName(), content.getName().toString()];
}

// The name Juke uses for an item in replies: its display name, unless the item
// was matched through its path name ("stuff-copy" among several "stuff"), which
// is then the unambiguous thing to say back.
export function spokenName(content: ContentSummary, labelIndex: number): string {
    return labelIndex === 1 ? content.getName().toString() : content.getDisplayName();
}

export async function findContentByName(
    spokenName: string,
    options: ContentLookupOptions = {},
): Promise<MatchResult<ContentSummary>> {
    const hits = await searchContentByText(spokenName, options);
    return bestUniqueMatch(
        hits.map((content) => ({ value: content, labels: contentLabels(content) })),
        spokenName,
    );
}
