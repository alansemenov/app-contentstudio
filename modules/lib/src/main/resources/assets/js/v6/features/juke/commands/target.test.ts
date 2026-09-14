import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { labelFor, parseTarget, resolveTarget } from './target';

const { mocks, state } = vi.hoisted(() => ({
    mocks: {
        getCurrentItems: vi.fn(),
        getContent: vi.fn(),
        findContentByName: vi.fn(),
        getVisibleNodes: vi.fn(),
    },
    state: {},
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('../../../entities/content', () => ({
    getCurrentItems: mocks.getCurrentItems,
    getContent: mocks.getContent,
}));

vi.mock('./content-lookup', () => ({
    findContentByName: mocks.findContentByName,
}));

vi.mock('./tree.commands', () => ({
    getVisibleNodes: mocks.getVisibleNodes,
}));

const item = (id: string, displayName: string): ContentSummary =>
    ({
        getId: () => id,
        getDisplayName: () => displayName,
        getContentId: () => ({ toString: () => id }),
    }) as unknown as ContentSummary;

const node = (summary: ContentSummary) => ({
    id: summary.getId(),
    data: {
        id: summary.getId(),
        displayName: summary.getDisplayName(),
        name: summary.getDisplayName().toLowerCase(),
        item: summary,
    },
});

const superhero = item('site', 'Superhero');
const posts = item('posts', 'Posts');
const about = item('about', 'About us');
const news = item('news', 'News');

describe('parseTarget', () => {
    it.each([
        ['', { kind: 'implicit' }],
        ['it', { kind: 'implicit' }],
        ['them', { kind: 'implicit' }],
        ['the selected', { kind: 'implicit' }],
        ['the selected ones', { kind: 'implicit' }],
        ['all', { kind: 'all' }],
        ['all of them', { kind: 'all' }],
        ['the top one', { kind: 'position', index: 1, fromBottom: false }],
        ['the first one', { kind: 'position', index: 1, fromBottom: false }],
        ['the third one', { kind: 'position', index: 3, fromBottom: false }],
        ['number 4', { kind: 'position', index: 4, fromBottom: false }],
        ['the 2nd item', { kind: 'position', index: 2, fromBottom: false }],
        ['the last one', { kind: 'position', index: 1, fromBottom: true }],
        ['the bottom one', { kind: 'position', index: 1, fromBottom: true }],
        ['the second one from the bottom', { kind: 'position', index: 2, fromBottom: true }],
        ['the third from the top', { kind: 'position', index: 3, fromBottom: false }],
        ['summer news', { kind: 'name', name: 'summer news' }],
        ['the superhero site', { kind: 'name', name: 'the superhero site' }],
    ])('should parse "%s"', (text, expected) => {
        expect(parseTarget(text)).toEqual(expected);
    });
});

describe('resolveTarget', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.getVisibleNodes.mockReturnValue([node(superhero), node(posts), node(about)]);
        mocks.getCurrentItems.mockReturnValue([]);
        mocks.getContent.mockReturnValue(undefined);
        mocks.findContentByName.mockResolvedValue({ kind: 'none' });
    });

    it('should pick rows by position from the top and the bottom', async () => {
        expect(await resolveTarget([parseTarget('the top one')])).toEqual({
            kind: 'items',
            items: [superhero],
            label: 'Superhero',
        });
        expect(await resolveTarget([parseTarget('the second one')])).toMatchObject({ items: [posts] });
        expect(await resolveTarget([parseTarget('the last one')])).toMatchObject({ items: [about] });
        expect(await resolveTarget([parseTarget('the second one from the bottom')])).toMatchObject({ items: [posts] });
    });

    it('should report positions outside the list', async () => {
        expect(await resolveTarget([parseTarget('the fifth one')])).toEqual({
            kind: 'reply',
            reply: { say: 'juke.reply.target.outOfRange|3' },
        });
    });

    it('should resolve names among visible rows first, then anywhere in the project', async () => {
        expect(await resolveTarget([parseTarget('posts')])).toMatchObject({ items: [posts] });

        mocks.findContentByName.mockResolvedValue({ kind: 'match', value: news });
        expect(await resolveTarget([parseTarget('news')])).toMatchObject({ items: [news] });
        expect(mocks.findContentByName).toHaveBeenCalledWith('news');
    });

    it('should report unknown and ambiguous names', async () => {
        expect(await resolveTarget([parseTarget('recipes')])).toEqual({
            kind: 'reply',
            reply: { say: 'juke.reply.target.notFound|recipes' },
        });

        mocks.getVisibleNodes.mockReturnValue([node(item('a', 'Landing page')), node(item('b', 'Landing hero'))]);
        expect(await resolveTarget([parseTarget('landing')])).toEqual({
            kind: 'reply',
            reply: { say: 'juke.reply.target.ambiguous|landing' },
        });
    });

    it('should use the selection for implicit targets and all visible rows for all', async () => {
        expect(await resolveTarget([parseTarget('it')])).toEqual({
            kind: 'reply',
            reply: { say: 'juke.reply.target.noSelection' },
        });

        mocks.getCurrentItems.mockReturnValue([posts, about]);
        expect(await resolveTarget([parseTarget('them')])).toEqual({
            kind: 'items',
            items: [posts, about],
            label: 'juke.reply.target.items|2',
        });

        expect(await resolveTarget([parseTarget('all')])).toMatchObject({ items: [superhero, posts, about] });
    });

    it('should try later alternatives when the first one fails', async () => {
        const resolution = await resolveTarget([parseTarget('both'), parseTarget('posts')]);
        expect(resolution).toMatchObject({ items: [posts] });

        const failed = await resolveTarget([parseTarget('both'), parseTarget('boats')]);
        expect(failed).toEqual({ kind: 'reply', reply: { say: 'juke.reply.target.notFound|both' } });
    });

    it('should label one item by name and several by count', () => {
        expect(labelFor([posts])).toBe('Posts');
        expect(labelFor([posts, about])).toBe('juke.reply.target.items|2');
    });
});
