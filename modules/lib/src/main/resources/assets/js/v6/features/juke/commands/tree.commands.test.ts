import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JukeContext } from './command.types';
import { findVisibleNode, parseTreeCommand, treeCommand } from './tree.commands';

const { mocks, state } = vi.hoisted(() => ({
    mocks: {
        expandNode: vi.fn(),
        collapseNode: vi.fn(),
        expandFilterNode: vi.fn(),
        collapseFilterNode: vi.fn(),
        nodeNeedsChildrenLoad: vi.fn(),
        filterNodeNeedsChildrenLoad: vi.fn(),
        fetchChildrenIdsOnly: vi.fn(),
        fetchFilterChildrenIdsOnly: vi.fn(),
    },
    state: { nodes: [] as unknown[], filterActive: false },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('../../../entities/content', () => ({
    $activeFlatNodes: { get: () => state.nodes },
    $isFilterActive: { get: () => state.filterActive },
    ...mocks,
}));

const node = (id: string, displayName: string, options: { children?: boolean; expanded?: boolean } = {}) => ({
    id,
    level: 0,
    isExpanded: options.expanded === true,
    isLoading: false,
    isLoadingData: false,
    hasChildren: options.children !== false,
    data: { id, displayName, name: displayName.toLowerCase().replace(/\s+/g, '-') },
});

const context: JukeContext = { mode: 'dialog', prompt: null, userName: 'Alan' };

const run = (text: string) => treeCommand.run(treeCommand.match(text, context)!, context);

describe('parseTreeCommand', () => {
    it.each([
        ['expand superhero', { action: 'expand', name: 'superhero' }],
        ['expand the news folder', { action: 'expand', name: 'news folder' }],
        ['unfold blogs', { action: 'expand', name: 'blogs' }],
        ['collapse superhero', { action: 'collapse', name: 'superhero' }],
        ['fold the blogs', { action: 'collapse', name: 'blogs' }],
    ])('should parse "%s"', (text, expected) => {
        expect(parseTreeCommand(text)).toEqual(expected);
    });

    it('should ignore unrelated phrases', () => {
        expect(parseTreeCommand('open superhero')).toBeNull();
        expect(parseTreeCommand('expand')).toBeNull();
    });
});

describe('treeCommand', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.nodeNeedsChildrenLoad.mockReturnValue(false);
        mocks.filterNodeNeedsChildrenLoad.mockReturnValue(false);
        mocks.fetchChildrenIdsOnly.mockResolvedValue(undefined);
        mocks.fetchFilterChildrenIdsOnly.mockResolvedValue(undefined);
        state.filterActive = false;
        state.nodes = [
            node('site', 'Superhero'),
            node('blogs', 'Blogs', { expanded: true }),
            node('about', 'About us', { children: false }),
            {
                id: 'loading',
                level: 1,
                isExpanded: false,
                isLoading: true,
                isLoadingData: false,
                hasChildren: false,
                data: null,
            },
        ];
    });

    it('should match visible nodes by display name and ignore loading rows', () => {
        const nodes = state.nodes as Parameters<typeof findVisibleNode>[0];
        expect(
            findVisibleNode(
                nodes.filter((n) => n.data != null),
                'blogs',
            ).kind,
        ).toBe('match');
        expect(
            findVisibleNode(
                nodes.filter((n) => n.data != null),
                'nothing',
            ).kind,
        ).toBe('none');
    });

    it('should expand a collapsed node and load its children when needed', async () => {
        mocks.nodeNeedsChildrenLoad.mockReturnValue(true);

        const reply = await run('expand superhero');

        expect(mocks.expandNode).toHaveBeenCalledWith('site');
        expect(mocks.fetchChildrenIdsOnly).toHaveBeenCalledWith('site');
        expect(reply).toEqual({ say: 'juke.reply.tree.expanding|Superhero' });
    });

    it('should report an already expanded node without touching it', async () => {
        const reply = await run('expand blogs');

        expect(mocks.expandNode).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.tree.alreadyExpanded|Blogs' });
    });

    it('should collapse an expanded node and report an already collapsed one', async () => {
        expect(await run('collapse blogs')).toEqual({ say: 'juke.reply.tree.collapsing|Blogs' });
        expect(mocks.collapseNode).toHaveBeenCalledWith('blogs');

        expect(await run('collapse superhero')).toEqual({ say: 'juke.reply.tree.alreadyCollapsed|Superhero' });
        expect(mocks.collapseNode).toHaveBeenCalledTimes(1);
    });

    it('should refuse leaves and report invisible or ambiguous names', async () => {
        expect(await run('expand about us')).toEqual({ say: 'juke.reply.tree.leaf|About us' });
        expect(await run('expand archive')).toEqual({ say: 'juke.reply.tree.notVisible|archive' });

        state.nodes = [node('a', 'Landing page'), node('b', 'Landing hero')];
        expect(await run('expand landing')).toEqual({ say: 'juke.reply.tree.ambiguous|landing' });
        expect(mocks.expandNode).not.toHaveBeenCalled();
    });

    it('should use the filter tree while a filter is active', async () => {
        state.filterActive = true;
        mocks.filterNodeNeedsChildrenLoad.mockReturnValue(true);

        await run('expand superhero');
        await run('collapse blogs');

        expect(mocks.expandFilterNode).toHaveBeenCalledWith('site');
        expect(mocks.fetchFilterChildrenIdsOnly).toHaveBeenCalledWith('site');
        expect(mocks.collapseFilterNode).toHaveBeenCalledWith('blogs');
        expect(mocks.expandNode).not.toHaveBeenCalled();
        expect(mocks.collapseNode).not.toHaveBeenCalled();
    });

    it('should only run in dialog mode without a pending prompt', () => {
        expect(treeCommand.modes).toEqual(['dialog']);
        expect(treeCommand.prompts).toEqual([null]);
    });
});
