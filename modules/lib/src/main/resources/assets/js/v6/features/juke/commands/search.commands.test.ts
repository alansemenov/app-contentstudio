import { okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@enonic/lib-admin-ui/security/Principal';
import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { $config } from '../../../shared/config/config.store';
import { $searchFlow, resetSearchFlow } from '../model/searchFlow.store';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext, JukeReply } from './command.types';
import {
    findModifier,
    parseCriteria,
    parseSearchAnswer,
    parseShowAnswer,
    searchCommands,
    searchPromptCommands,
} from './search.commands';
import { sessionCommands } from './session.commands';
import { smallTalkCommands } from './smalltalk.commands';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        fetchAllContentTypes: vi.fn(),
        runSearch: vi.fn(),
        applySearchToFilterPanel: vi.fn(),
        resetContentFilter: vi.fn(),
        setContentFilterOpen: vi.fn(),
    },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('../../../entities/schema/api/contentTypes.api', () => ({
    fetchAllContentTypes: mocks.fetchAllContentTypes,
}));

vi.mock('../../../shared/app-state/contentFilter.store', () => ({
    resetContentFilter: mocks.resetContentFilter,
    setContentFilterOpen: mocks.setContentFilterOpen,
}));

vi.mock('./search-query', () => ({
    runSearch: mocks.runSearch,
    applySearchToFilterPanel: mocks.applySearchToFilterPanel,
}));

const type = (localName: string, title: string): ContentTypeSummary =>
    ({
        getTitle: () => title,
        isAbstract: () => false,
        getContentTypeName: () => ({
            getLocalName: () => localName,
            isDescendantOfMedia: () => false,
            toString: () => `com.example:${localName}`,
        }),
    }) as unknown as ContentTypeSummary;

const types = [type('post', 'Post'), type('author', 'Author')];

const candidates = [
    { key: 'user:system:su', displayName: 'Super User' },
    { key: 'user:system:anna', displayName: 'Anna Editor' },
];

const context = (prompt: JukeContext['prompt'] = null): JukeContext => ({ mode: 'dialog', prompt, userName: 'Alan' });

const say = async (text: string, prompt: JukeContext['prompt'] = null): Promise<JukeReply | null> => {
    const resolved = resolveCommand([text], context(prompt));
    return resolved ? resolved.command.run(resolved.args, context(prompt)) : null;
};

describe('parseCriteria', () => {
    it('should treat plain text as keywords', () => {
        expect(parseCriteria('summer holiday')).toEqual({
            keywords: ['summer holiday'],
            contentTypes: [],
            modifiedBy: [],
            inProgress: false,
        });
    });

    it('should split several clauses in one utterance', () => {
        expect(parseCriteria('content type post last modified by anna last modified this week in progress')).toEqual({
            keywords: [],
            contentTypes: ['post'],
            modifiedBy: ['anna'],
            lastModified: 'week',
            inProgress: true,
        });
    });

    it('should treat words around clauses as noise, not keywords', () => {
        expect(parseCriteria('summer content type post in progress news')).toEqual({
            keywords: [],
            contentTypes: ['post'],
            modifiedBy: [],
            inProgress: true,
        });
        expect(parseCriteria('life modified by me')).toEqual({
            keywords: [],
            contentTypes: [],
            modifiedBy: ['me'],
            inProgress: false,
        });
        expect(parseCriteria('lost modified this week').lastModified).toBe('week');
        expect(parseCriteria('modify today').lastModified).toBe('day');
        expect(parseCriteria('last modified today')).toEqual({
            keywords: [],
            contentTypes: [],
            modifiedBy: [],
            lastModified: 'day',
            inProgress: false,
        });
        expect(parseCriteria('last modified by me').modifiedBy).toEqual(['me']);
    });
});

describe('answer parsers', () => {
    it('should recognize restart and criteria', () => {
        expect(parseSearchAnswer('lets try again')).toEqual({ kind: 'restart' });
        expect(parseSearchAnswer('in progress').kind).toBe('criteria');
    });

    it('should recognize yes variants for showing results', () => {
        ['yes', 'yeah', 'sure', 'show me', 'yes please'].forEach((text) => {
            expect(parseShowAnswer(text)).toEqual({ kind: 'yes' });
        });
        expect(parseShowAnswer('no')).toEqual({ kind: 'no' });
        expect(parseShowAnswer('go to superhero')).toEqual({ kind: 'no' });
    });
});

describe('findModifier', () => {
    it('should match users by display name', () => {
        expect(findModifier(candidates, 'anna')?.key).toBe('user:system:anna');
        expect(findModifier(candidates, 'super user')?.key).toBe('user:system:su');
        expect(findModifier(candidates, 'bob')).toBeNull();
    });
});

describe('search dialog', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        resetSearchFlow();
        clearCommands();
        registerCommands(...sessionCommands, ...smallTalkCommands, ...searchCommands, ...searchPromptCommands);
        mocks.fetchAllContentTypes.mockReturnValue(okAsync(types));
        mocks.runSearch.mockResolvedValue({ hits: 3, modifierCandidates: candidates });
        $config.setKey('user', {
            getKey: () => ({ toString: () => 'user:system:su' }),
            getDisplayName: () => 'Super User',
        } as unknown as Principal);
    });

    it('should reset the filter and ask what to look for', async () => {
        const reply = await say('new search');

        expect(mocks.resetContentFilter).toHaveBeenCalledTimes(1);
        expect(reply).toEqual({ say: 'juke.reply.search.start', prompt: 'search' });
        expect($searchFlow.get()).toEqual({ keywords: [], contentTypes: [], modifiers: [], inProgress: false });
    });

    it('should resolve criteria, count hits and offer to show them', async () => {
        await say('new search');

        await say('summer', 'search');
        const reply = await say('content type post last modified this week in progress', 'search');

        expect(mocks.runSearch).toHaveBeenLastCalledWith({
            keywords: ['summer'],
            contentTypes: [{ key: 'com.example:post', title: 'Post' }],
            modifiers: [],
            lastModified: 'week',
            inProgress: true,
            hits: undefined,
        });
        expect(reply).toEqual({ say: 'juke.reply.search.found|3', prompt: 'showResults' });
        expect($searchFlow.get()?.hits).toBe(3);
    });

    it('should resolve "me" to the current user and other names via modifier buckets', async () => {
        await say('new search');

        await say('last modified by me', 'search');
        expect(mocks.runSearch).toHaveBeenLastCalledWith(
            expect.objectContaining({ modifiers: [{ key: 'user:system:su', displayName: 'Super User' }] }),
        );

        await say('last modified by anna', 'search');
        const lastCall = mocks.runSearch.mock.calls.at(-1)![0];
        expect(lastCall.modifiers.map((m: { key: string }) => m.key)).toEqual(['user:system:su', 'user:system:anna']);

        await say('last modified by me', 'search');
        const afterRepeat = mocks.runSearch.mock.calls.at(-1)![0];
        expect(afterRepeat.modifiers.map((m: { key: string }) => m.key)).toEqual([
            'user:system:su',
            'user:system:anna',
        ]);
    });

    it('should keep the search open when a type or user is unknown or nothing is found', async () => {
        await say('new search');

        expect(await say('content type recipe', 'search')).toEqual({ say: 'juke.reply.search.typeNotFound|recipe' });
        expect(await say('last modified by bob', 'search')).toEqual({ say: 'juke.reply.search.userNotFound|bob' });

        mocks.runSearch.mockResolvedValue({ hits: 0, modifierCandidates: [] });
        expect(await say('unicorns', 'search')).toEqual({ say: 'juke.reply.search.none' });
        expect($searchFlow.get()?.keywords).toEqual(['unicorns']);
    });

    it('should accumulate filters but replace keywords across utterances', async () => {
        await say('new search');
        await say('content type post', 'search');
        await say('summer', 'search');
        await say('winter', 'search');
        await say('in progress', 'search');

        expect(mocks.runSearch).toHaveBeenLastCalledWith(
            expect.objectContaining({
                keywords: ['winter'],
                contentTypes: [{ key: 'com.example:post', title: 'Post' }],
                inProgress: true,
            }),
        );
    });

    it('should start over on "new search" even while a search is open', async () => {
        await say('new search');
        await say('unicorns', 'search');

        expect(await say('new search', 'search')).toEqual({ say: 'juke.reply.search.start', prompt: 'search' });
        expect($searchFlow.get()?.keywords).toEqual([]);

        await say('content type post', 'search');
        expect(await say('new search', 'showResults')).toEqual({ say: 'juke.reply.search.start', prompt: 'search' });
        expect(await say('new search', 'createName')).toEqual({ say: 'juke.reply.search.start', prompt: 'search' });
    });

    it.each([
        'new search',
        'a new search',
        'start a new search',
        'lets do a new search',
        'search again',
        'another search',
        'reset the search',
        'new surge',
        'search',
        'you search',
        'use search',
        'and you search',
        'usage',
        'find',
        'look up',
        'search for',
    ])('should start on "%s"', (text) => {
        expect(resolveCommand([text], context())?.command.id).toBe('search.start');
    });

    it('should search at once when criteria follow the find verb', async () => {
        expect(await say('find summer')).toEqual({ say: 'juke.reply.search.found|3', prompt: 'showResults' });
        expect(mocks.runSearch).toHaveBeenLastCalledWith(expect.objectContaining({ keywords: ['summer'] }));
        expect(mocks.resetContentFilter).toHaveBeenCalledTimes(1);

        mocks.runSearch.mockResolvedValue({ hits: 0, modifierCandidates: [] });
        expect(await say('search for unicorns')).toEqual({ say: 'juke.reply.search.none', prompt: 'search' });

        expect(await say('look for content type post', 'createName')).toEqual({
            say: 'juke.reply.search.none',
            prompt: 'search',
        });
        expect(mocks.runSearch).toHaveBeenLastCalledWith(
            expect.objectContaining({ contentTypes: [{ key: 'com.example:post', title: 'Post' }] }),
        );
    });

    it.each([
        ['hide search', false],
        ['hide the search panel', false],
        ['close the filter', false],
        ['collapse filters', false],
        ['show search', true],
        ['open the filter panel', true],
    ])('should toggle the filter panel on "%s"', async (text, open) => {
        const reply = await say(text);
        expect(mocks.setContentFilterOpen).toHaveBeenLastCalledWith(open);
        expect(reply).toEqual({ say: open ? 'juke.reply.search.panelShown' : 'juke.reply.search.panelHidden' });
        expect(mocks.resetContentFilter).not.toHaveBeenCalled();
    });

    it('should not start on phrases merely containing search', () => {
        expect(resolveCommand(['research'], context())).toBeNull();
    });

    it('should apply the criteria to the filter panel on yes and dismiss otherwise', async () => {
        await say('new search');
        await say('content type post', 'search');

        const reply = await say('yes', 'showResults');

        expect(mocks.applySearchToFilterPanel).toHaveBeenCalledWith(
            expect.objectContaining({ contentTypes: [{ key: 'com.example:post', title: 'Post' }], hits: 3 }),
        );
        expect(reply).toEqual({ say: 'juke.reply.search.showing|3', prompt: null });
        expect($searchFlow.get()).toBeNull();

        await say('new search');
        await say('content type post', 'search');
        expect(await say('no thanks', 'showResults')).toEqual({ say: 'juke.reply.search.dismissed', prompt: null });
        expect(mocks.applySearchToFilterPanel).toHaveBeenCalledTimes(1);
    });

    it('should cancel through the session command and restart', async () => {
        await say('new search');
        expect(await say('cancel', 'search')).toEqual({ say: 'juke.reply.cancel', prompt: null });
        expect($searchFlow.get()).toBeNull();

        await say('new search');
        await say('content type post', 'search');
        expect(await say('lets try again', 'search')).toEqual({ say: 'juke.reply.search.start', prompt: 'search' });
        expect($searchFlow.get()?.contentTypes).toEqual([]);
        expect(mocks.resetContentFilter).toHaveBeenCalledTimes(3);
    });

    it('should let goodbye win while searching', () => {
        expect(resolveCommand(['goodbye juke'], context('search'))?.command.id).toBe('session.goodbye');
    });
});
