import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTextSearchQuery, findContentByName, searchContentByText } from './content-lookup';

const { mockQueryContent } = vi.hoisted(() => ({ mockQueryContent: vi.fn() }));

vi.mock('../../../entities/content/api/contentQuery.api', () => ({
    queryContent: mockQueryContent,
}));

const summary = (id: string, displayName: string, name = displayName.toLowerCase().replace(/\s+/g, '-')) => ({
    getContentId: () => ({ toString: () => id }),
    getDisplayName: () => displayName,
    getName: () => ({ toString: () => name }),
});

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

        const hits = await searchContentByText('news', ['2']);

        expect(mockQueryContent).toHaveBeenCalledWith({ from: 0, size: 50, query: buildTextSearchQuery('news') });
        expect(hits.map((hit) => hit.getDisplayName())).toEqual(['News']);
    });

    it('should throw the request error', async () => {
        mockQueryContent.mockReturnValue(errAsync(new Error('offline')));

        await expect(searchContentByText('news')).rejects.toThrow('offline');
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
