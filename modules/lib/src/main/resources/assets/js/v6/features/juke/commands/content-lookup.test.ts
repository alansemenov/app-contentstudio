import { errAsync, okAsync } from 'neverthrow';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTextSearchQuery, canHoldChildren, findContentByName, searchContentByText } from './content-lookup';

const { mockQueryContent } = vi.hoisted(() => ({ mockQueryContent: vi.fn() }));

vi.mock('../../../entities/content/api/contentQuery.api', () => ({
    queryContent: mockQueryContent,
}));

const summary = (id: string, displayName: string, type: 'folder' | 'image' | 'template' = 'folder') =>
    ({
        getContentId: () => ({ toString: () => id }),
        getDisplayName: () => displayName,
        getName: () => ({ toString: () => displayName.toLowerCase().replace(/\s+/g, '-') }),
        getType: () => ({
            isMedia: () => type === 'image',
            isDescendantOfMedia: () => type === 'image',
            isPageTemplate: () => type === 'template',
        }),
    }) as unknown as ContentSummary;

describe('buildTextSearchQuery', () => {
    it('should search display name, name and all text with fulltext and ngram', () => {
        const query = buildTextSearchQuery('summer') as { boolean: { should: object[] } };
        expect(query.boolean.should).toHaveLength(2);
        expect(query).toMatchObject({
            boolean: {
                should: [
                    {
                        fulltext: {
                            fields: ['displayName^5', '_name^3', '_allText'],
                            query: 'summer',
                            operator: 'AND',
                        },
                    },
                    { ngram: { fields: ['displayName^5', '_name^3', '_allText'], query: 'summer', operator: 'AND' } },
                ],
            },
        });
    });
});

describe('searchContentByText', () => {
    beforeEach(() => {
        mockQueryContent.mockReset();
    });

    it('should query the draft branch with the text query and drop excluded ids', async () => {
        mockQueryContent.mockReturnValue(
            okAsync({ contents: [summary('1', 'News'), summary('2', 'Old news')], totalHits: 2, aggregations: {} }),
        );

        const hits = await searchContentByText('news', { excludeIds: ['2'] });

        expect(mockQueryContent).toHaveBeenCalledWith({
            from: 0,
            size: 50,
            contentTypeNames: [],
            queryFilters: [],
            aggregationQueries: [],
            query: buildTextSearchQuery('news'),
        });
        expect(hits.map((hit) => hit.getDisplayName())).toEqual(['News']);
    });

    it('should throw the request error', async () => {
        mockQueryContent.mockReturnValue(errAsync(new Error('offline')));

        await expect(searchContentByText('news')).rejects.toThrow('offline');
    });
});

describe('canHoldChildren', () => {
    it('should reject media and page templates', () => {
        expect(canHoldChildren(summary('1', 'Site'))).toBe(true);
        expect(canHoldChildren(summary('2', 'hero.jpg', 'image'))).toBe(false);
        expect(canHoldChildren(summary('3', 'Default', 'template'))).toBe(false);
    });
});

describe('findContentByName', () => {
    beforeEach(() => {
        mockQueryContent.mockReset();
    });

    it('should return the unique hit whose display name matches best', async () => {
        mockQueryContent.mockReturnValue(
            okAsync({
                contents: [summary('1', 'News'), summary('2', 'News archive'), summary('3', 'Summer news')],
                totalHits: 3,
                aggregations: {},
            }),
        );

        const result = await findContentByName('news');

        expect(result.kind).toBe('match');
        if (result.kind === 'match') {
            expect(result.value.getDisplayName()).toBe('News');
        }
    });

    it('should ignore hits rejected by the accept filter', async () => {
        mockQueryContent.mockReturnValue(
            okAsync({
                contents: [summary('1', 'Superhero'), summary('2', 'superhero.jpg', 'image')],
                totalHits: 2,
                aggregations: {},
            }),
        );

        const result = await findContentByName('superhero', { accept: canHoldChildren });

        expect(result.kind).toBe('match');
    });

    it('should report ambiguity and no hits', async () => {
        mockQueryContent.mockReturnValue(
            okAsync({
                contents: [summary('1', 'Summer news'), summary('2', 'Summer sale')],
                totalHits: 2,
                aggregations: {},
            }),
        );
        expect((await findContentByName('summer')).kind).toBe('ambiguous');

        mockQueryContent.mockReturnValue(okAsync({ contents: [], totalHits: 0, aggregations: {} }));
        expect((await findContentByName('nothing')).kind).toBe('none');
    });
});
