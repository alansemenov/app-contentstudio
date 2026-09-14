import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { $actionFlow, resetActionFlow } from '../model/actionFlow.store';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext, JukeReply } from './command.types';
import { sessionCommands } from './session.commands';
import { parseMoveTarget, parseToolbar, parseYesNo, toolbarCommands } from './toolbar.commands';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        resolveTarget: vi.fn(),
        openEditContentTab: vi.fn(),
        openWindows: vi.fn(),
        archiveContent: vi.fn(),
        moveContent: vi.fn(),
        duplicateContent: vi.fn(),
        trackTask: vi.fn(),
        findContentByName: vi.fn(),
        leaveFilterMode: vi.fn(),
        expandInTree: vi.fn(),
        showSuccess: vi.fn(),
        showError: vi.fn(),
    },
}));

vi.mock('@enonic/lib-admin-ui/notify/MessageBus', () => ({
    showSuccess: mocks.showSuccess,
    showError: mocks.showError,
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('./target', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./target')>();
    return { ...actual, resolveTarget: mocks.resolveTarget };
});

vi.mock('../../../../app/util/ContentUrlHelper', () => ({
    ContentUrlHelper: { openEditContentTab: mocks.openEditContentTab },
}));

vi.mock('../../../../app/action/PreviewActionHelper', () => ({
    PreviewActionHelper: class {
        openWindows = mocks.openWindows;
    },
}));

vi.mock('../../../entities/content/api/delete.api', () => ({ archiveContent: mocks.archiveContent }));
vi.mock('../../../entities/content/api/move.api', () => ({ moveContent: mocks.moveContent }));
vi.mock('../../../entities/content/api/duplicate.api', () => ({ duplicateContent: mocks.duplicateContent }));
vi.mock('../../../entities/task/task.service', () => ({ trackTask: mocks.trackTask }));
vi.mock('./tree-reveal', () => ({
    leaveFilterMode: mocks.leaveFilterMode,
    expandInTree: mocks.expandInTree,
}));
vi.mock('./content-lookup', () => ({
    findContentByName: mocks.findContentByName,
    canHoldChildren: () => true,
}));

type ItemOptions = { page?: boolean; site?: boolean; media?: boolean; path?: string };

const item = (id: string, displayName: string, options: ItemOptions = {}): ContentSummary => {
    const contentId = { toString: () => id };
    const pathString = options.path ?? `/${id}`;
    const parentPath = { toString: () => pathString.replace(/\/[^/]+$/, '') || '/' };
    const path = {
        toString: () => pathString,
        isRoot: () => pathString === '/',
        getParentPath: () => parentPath,
    };
    const type = { isMedia: () => options.media === true, isDescendantOfMedia: () => options.media === true };
    return {
        getId: () => id,
        getDisplayName: () => displayName,
        getContentId: () => contentId,
        getPath: () => path,
        isPage: () => options.page === true,
        isSite: () => options.site === true,
        getType: () => type,
    } as unknown as ContentSummary;
};

const post = item('post', 'Summer news', { page: true, path: '/superhero/posts/summer-news' });
const folder = item('folder', 'Archive', { path: '/archive' });
const image = item('img', 'hero.jpg', { media: true });
const blogs = item('blogs', 'Blogs', { path: '/superhero/blogs' });

const context = (prompt: JukeContext['prompt'] = null, alternatives?: string[]): JukeContext => ({
    mode: 'dialog',
    prompt,
    userName: 'Alan',
    alternatives,
});

const say = async (
    text: string,
    prompt: JukeContext['prompt'] = null,
    alternatives?: string[],
): Promise<JukeReply | null> => {
    const ctx = context(prompt, alternatives);
    const resolved = resolveCommand([text], ctx);
    return resolved ? resolved.command.run(resolved.args, ctx) : null;
};

const itemsResolution = (items: ContentSummary[]) => ({
    kind: 'items',
    items,
    label: items.length === 1 ? items[0].getDisplayName() : `${items.length} items`,
});

describe('parsers', () => {
    it.each([
        ['edit the top one', { action: 'edit', target: 'the top one' }],
        ['delete summer news', { action: 'delete', target: 'summer news' }],
        ['remove it', { action: 'delete', target: 'it' }],
        ['move', { action: 'move', target: '' }],
        ['duplicate the last one', { action: 'duplicate', target: 'the last one' }],
        ['copy them', { action: 'duplicate', target: 'them' }],
        ['preview all', { action: 'preview', target: 'all' }],
    ])('should parse "%s"', (text, expected) => {
        expect(parseToolbar(text)).toEqual(expected);
    });

    it('should ignore unrelated phrases', () => {
        expect(parseToolbar('go to superhero')).toBeNull();
        expect(parseToolbar('create a post')).toBeNull();
    });

    it('should parse yes, no, restart and anything else', () => {
        expect(parseYesNo('yes')).toEqual({ kind: 'yes' });
        expect(parseYesNo('go ahead')).toEqual({ kind: 'yes' });
        expect(parseYesNo('no')).toEqual({ kind: 'no' });
        expect(parseYesNo('lets try again')).toEqual({ kind: 'restart' });
        expect(parseYesNo('what')).toEqual({ kind: 'other' });
    });

    it('should parse move destinations', () => {
        expect(parseMoveTarget('to the root')).toEqual({ kind: 'root' });
        expect(parseMoveTarget('under blogs')).toEqual({ kind: 'named', name: 'blogs' });
        expect(parseMoveTarget('blogs')).toEqual({ kind: 'named', name: 'blogs' });
        expect(parseMoveTarget('start over')).toEqual({ kind: 'restart' });
    });
});

describe('toolbar actions', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        resetActionFlow();
        clearCommands();
        registerCommands(...sessionCommands, ...toolbarCommands);
        mocks.resolveTarget.mockResolvedValue(itemsResolution([post]));
        mocks.archiveContent.mockReturnValue(okAsync('task-1'));
        mocks.moveContent.mockReturnValue(okAsync('task-2'));
        mocks.duplicateContent.mockReturnValue(okAsync('task-3'));
        mocks.trackTask.mockImplementation((_id: string, config: { onComplete: (state: string) => void }) => {
            config.onComplete('SUCCESS');
            return () => undefined;
        });
        mocks.findContentByName.mockResolvedValue({ kind: 'match', value: blogs });
        mocks.leaveFilterMode.mockResolvedValue(undefined);
        mocks.expandInTree.mockResolvedValue(undefined);
    });

    it('should pass the target specs from every alternative to the resolver', async () => {
        await say('edit both', null, ['edit both', 'edit posts', 'delete posts']);

        expect(mocks.resolveTarget).toHaveBeenCalledWith([
            { kind: 'name', name: 'both' },
            { kind: 'name', name: 'posts' },
        ]);
    });

    it('should relay a failed target resolution', async () => {
        mocks.resolveTarget.mockResolvedValue({ kind: 'reply', reply: { say: 'juke.reply.target.notFound|x' } });
        expect(await say('edit x')).toEqual({ say: 'juke.reply.target.notFound|x' });
    });

    it('should open one edit tab per item', async () => {
        expect(await say('edit summer news')).toEqual({ say: 'juke.reply.edit.opening|Summer news' });
        expect(mocks.openEditContentTab).toHaveBeenCalledWith(post.getContentId());

        mocks.resolveTarget.mockResolvedValue(itemsResolution([post, folder]));
        expect(await say('edit all')).toEqual({ say: 'juke.reply.edit.openingMany|2' });
        expect(mocks.openEditContentTab).toHaveBeenCalledTimes(3);
    });

    it('should open a preview for every targeted item', async () => {
        mocks.resolveTarget.mockResolvedValue(itemsResolution([post, folder, image]));
        expect(await say('preview all')).toEqual({ say: 'juke.reply.preview.openingMany|3' });
        expect(mocks.openWindows).toHaveBeenCalledWith([post, folder, image]);

        mocks.resolveTarget.mockResolvedValue(itemsResolution([folder]));
        expect(await say('preview archive')).toEqual({ say: 'juke.reply.preview.opening|Archive' });
    });

    it('should ask before deleting and archive on yes', async () => {
        expect(await say('delete summer news')).toEqual({
            say: 'juke.reply.delete.confirmOne|Summer news',
            prompt: 'confirmDelete',
        });
        expect($actionFlow.get()?.items).toEqual([post]);

        expect(await say('yes', 'confirmDelete')).toEqual({ say: 'juke.reply.delete.done|Summer news', prompt: null });
        expect(mocks.archiveContent).toHaveBeenCalledWith([post.getContentId()]);
        expect(mocks.showSuccess).toHaveBeenCalledWith('dialog.archive.success.single|Summer news');
        expect($actionFlow.get()).toBeNull();
    });

    it('should count several items in the delete confirmation and do nothing on no', async () => {
        mocks.resolveTarget.mockResolvedValue(itemsResolution([post, folder]));
        expect(await say('delete them')).toEqual({ say: 'juke.reply.delete.confirmMany|2', prompt: 'confirmDelete' });

        expect(await say('no', 'confirmDelete')).toEqual({ say: 'juke.reply.delete.cancelled', prompt: null });
        expect(await say('delete them')).toBeTruthy();
        expect(await say('maybe', 'confirmDelete')).toEqual({ say: 'juke.reply.delete.cancelled', prompt: null });
        expect(mocks.archiveContent).not.toHaveBeenCalled();
    });

    it('should report a failed archive task', async () => {
        await say('delete summer news');
        mocks.trackTask.mockImplementation((_id: string, config: { onComplete: (state: string) => void }) => {
            config.onComplete('ERROR');
            return () => undefined;
        });
        expect(await say('yes', 'confirmDelete')).toEqual({ say: 'juke.reply.action.failed', prompt: null });
        expect(mocks.showError).toHaveBeenCalledTimes(1);

        await say('delete summer news');
        mocks.archiveContent.mockReturnValue(errAsync(new Error('boom')));
        expect(await say('yes', 'confirmDelete')).toEqual({ say: 'juke.reply.action.failed', prompt: null });
        expect(mocks.showError).toHaveBeenLastCalledWith('boom');
        expect(mocks.showSuccess).not.toHaveBeenCalled();
    });

    it('should ask where to move, resolve the destination and move', async () => {
        expect(await say('move summer news')).toEqual({
            say: 'juke.reply.move.where|Summer news',
            prompt: 'moveTarget',
        });

        expect(await say('under blogs', 'moveTarget')).toEqual({
            say: 'juke.reply.move.done|Summer news|Blogs',
            prompt: null,
        });
        expect(mocks.findContentByName).toHaveBeenCalledWith('blogs', { accept: expect.any(Function) });
        expect(mocks.moveContent).toHaveBeenCalledWith([post.getContentId()], blogs.getPath());
        expect(mocks.leaveFilterMode).toHaveBeenCalledTimes(1);
        expect(mocks.expandInTree).toHaveBeenCalledWith(blogs.getPath());
        expect(mocks.showSuccess).toHaveBeenCalledWith('notify.items.moved.to.single|1 /superhero/blogs');
        expect(mocks.showSuccess).toHaveBeenCalledWith('notify.items.moved.to.single|1 /superhero/blogs');
    });

    it('should exclude the moved items and their descendants as destinations', async () => {
        const site = item('site', 'Superhero', { path: '/superhero' });
        mocks.resolveTarget.mockResolvedValue(itemsResolution([site]));
        await say('move superhero');
        await say('under blogs', 'moveTarget');

        const accept = mocks.findContentByName.mock.calls[0][1].accept as (c: ContentSummary) => boolean;
        expect(accept(site)).toBe(false);
        expect(accept(blogs)).toBe(false);
        expect(accept(folder)).toBe(true);
    });

    it('should move to the root and keep asking on an unknown destination', async () => {
        await say('move summer news');
        expect(await say('to the root', 'moveTarget')).toEqual({
            say: 'juke.reply.move.doneRoot|Summer news',
            prompt: null,
        });
        expect(mocks.moveContent).toHaveBeenCalledWith([post.getContentId()], undefined);
        expect(mocks.showSuccess).toHaveBeenCalledWith('notify.items.moved.to.single|1 field.root');
        expect(mocks.showSuccess).toHaveBeenCalledWith('notify.items.moved.to.single|1 field.root');

        await say('move summer news');
        mocks.findContentByName.mockResolvedValue({ kind: 'none' });
        expect(await say('under nowhere', 'moveTarget')).toEqual({ say: 'juke.reply.move.targetNotFound|nowhere' });
        expect($actionFlow.get()?.action).toBe('move');
    });

    it('should refuse to move all visible items', async () => {
        mocks.resolveTarget.mockResolvedValue(itemsResolution([post, folder]));
        expect(await say('move all')).toEqual({ say: 'juke.reply.move.notAll' });
        expect($actionFlow.get()).toBeNull();
    });

    it('should ask about children and duplicate accordingly', async () => {
        expect(await say('duplicate summer news')).toEqual({
            say: 'juke.reply.duplicate.children|Summer news',
            prompt: 'duplicateChildren',
        });

        expect(await say('yes', 'duplicateChildren')).toEqual({
            say: 'juke.reply.duplicate.doneWith|Summer news',
            prompt: null,
        });
        expect(mocks.duplicateContent).toHaveBeenCalledWith([
            { contentId: post.getContentId(), includeChildren: true },
        ]);
        expect(mocks.leaveFilterMode).toHaveBeenCalledTimes(1);
        expect(mocks.expandInTree).toHaveBeenCalledWith(post.getPath().getParentPath());
        expect(mocks.showSuccess).toHaveBeenCalledWith('dialog.duplicate.success.single|Summer news');

        await say('duplicate summer news');
        expect(await say('no', 'duplicateChildren')).toEqual({
            say: 'juke.reply.duplicate.doneWithout|Summer news',
            prompt: null,
        });
        expect(mocks.duplicateContent).toHaveBeenLastCalledWith([
            { contentId: post.getContentId(), includeChildren: false },
        ]);
    });

    it('should repeat the children question on an unclear answer', async () => {
        await say('duplicate summer news');
        expect(await say('hmm', 'duplicateChildren')).toEqual({ say: 'juke.reply.duplicate.children|Summer news' });
        expect(mocks.duplicateContent).not.toHaveBeenCalled();
    });

    it('should let cancel abandon any pending action', async () => {
        await say('delete summer news');
        expect(await say('cancel', 'confirmDelete')).toEqual({ say: 'juke.reply.cancel', prompt: null });
        expect($actionFlow.get()).toBeNull();
    });
});
