import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import type { JukeContext } from './command.types';
import { createContentCommand, findContentType, parseCreate } from './content.commands';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getAvailableContentTypes: vi.fn(),
        sendAndParse: vi.fn(),
        setParent: vi.fn(),
        makeNewContentRequest: vi.fn(),
        openEditContentTab: vi.fn(),
        getCurrentItems: vi.fn(),
        getActiveProject: vi.fn(),
    },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('../../../../app/util/ContentTypesHelper', () => ({
    ContentTypesHelper: { getAvailableContentTypes: mocks.getAvailableContentTypes },
}));

vi.mock('../../../../app/util/ContentHelper', () => ({
    ContentHelper: { makeNewContentRequest: mocks.makeNewContentRequest },
}));

vi.mock('../../../../app/util/ContentUrlHelper', () => ({
    ContentUrlHelper: { openEditContentTab: mocks.openEditContentTab },
}));

vi.mock('../../../../app/wizard/ContentEditParams', () => ({
    ContentEditParams: {
        create: (contentId: unknown) => ({
            setDisplayAsNew: (displayAsNew: boolean) => ({ build: () => ({ contentId, displayAsNew }) }),
        }),
    },
}));

vi.mock('../../../../app/content/ContentPath', () => ({
    ContentPath: { getRoot: () => 'ROOT' },
}));

vi.mock('../../../entities/content', () => ({
    getCurrentItems: mocks.getCurrentItems,
}));

vi.mock('../../../entities/project', () => ({
    getActiveProject: mocks.getActiveProject,
}));

const type = (localName: string, title: string, media = false): ContentTypeSummary => {
    const contentTypeName = {
        getLocalName: () => localName,
        isDescendantOfMedia: () => media,
        toString: () => `com.example:${localName}`,
    };
    return { getTitle: () => title, getContentTypeName: () => contentTypeName } as unknown as ContentTypeSummary;
};

const types = [type('blog-post', 'Blog Post'), type('article', 'Article'), type('image', 'Image', true)];

const context: JukeContext = { mode: 'dialog', prompt: null, userName: 'Alan' };

describe('parseCreate', () => {
    it.each([
        ['create a new blog', 'blog'],
        ['create new blog post', 'blog post'],
        ['create an article', 'article'],
        ['make a new folder', 'folder'],
        ['add a person', 'person'],
    ])('should parse "%s" as type "%s"', (text, typeName) => {
        expect(parseCreate(text)).toEqual({ typeName });
    });

    it('should ignore unrelated phrases', () => {
        expect(parseCreate('go to superhero')).toBeNull();
        expect(parseCreate('create')).toBeNull();
        expect(parseCreate('make me a sandwich')).toBeNull();
        expect(parseCreate('create blog')).toBeNull();
    });
});

describe('findContentType', () => {
    it('should match by title or local name', () => {
        expect(findContentType(types, 'blog')?.getTitle()).toBe('Blog Post');
        expect(findContentType(types, 'article')?.getTitle()).toBe('Article');
        expect(findContentType(types, 'blog-post')?.getTitle()).toBe('Blog Post');
    });

    it('should return null for unknown names', () => {
        expect(findContentType(types, 'recipe')).toBeNull();
    });
});

describe('createContentCommand', () => {
    const created = { getContentId: () => 'new-id' };

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.getAvailableContentTypes.mockResolvedValue(types);
        mocks.getActiveProject.mockReturnValue('PROJECT');
        mocks.getCurrentItems.mockReturnValue([]);
        mocks.sendAndParse.mockResolvedValue(created);
        mocks.setParent.mockReturnValue({ sendAndParse: mocks.sendAndParse });
        mocks.makeNewContentRequest.mockReturnValue({ setParent: mocks.setParent });
    });

    it('should create the content at the root and open it for editing as new', async () => {
        const args = createContentCommand.match('create a new blog', context)!;
        const reply = await createContentCommand.run(args, context);

        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: undefined, project: 'PROJECT' });
        expect(mocks.makeNewContentRequest).toHaveBeenCalledWith(types[0].getContentTypeName());
        expect(mocks.setParent).toHaveBeenCalledWith('ROOT');
        expect(mocks.openEditContentTab).toHaveBeenCalledWith({ contentId: 'new-id', displayAsNew: true });
        expect(reply).toEqual({ say: 'juke.reply.content.creating|Blog Post' });
    });

    it('should create under the single selected item', async () => {
        const parent = { getContentId: () => 'parent-id', getPath: () => 'PARENT_PATH' };
        mocks.getCurrentItems.mockReturnValue([parent]);

        const args = createContentCommand.match('create a new article', context)!;
        await createContentCommand.run(args, context);

        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: 'parent-id', project: 'PROJECT' });
        expect(mocks.setParent).toHaveBeenCalledWith('PARENT_PATH');
    });

    it('should use the root when several items are selected', async () => {
        mocks.getCurrentItems.mockReturnValue([{ getPath: () => 'A' }, { getPath: () => 'B' }]);

        const args = createContentCommand.match('create a new article', context)!;
        await createContentCommand.run(args, context);

        expect(mocks.setParent).toHaveBeenCalledWith('ROOT');
    });

    it('should not offer media types and report unknown types', async () => {
        const args = createContentCommand.match('create a new image', context)!;
        const reply = await createContentCommand.run(args, context);

        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.content.typeNotFound|image' });
    });

    it('should report a failed creation without opening a tab', async () => {
        mocks.sendAndParse.mockRejectedValue(new Error('boom'));

        const args = createContentCommand.match('create a new blog', context)!;
        const reply = await createContentCommand.run(args, context);

        expect(mocks.openEditContentTab).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.content.failed|Blog Post' });
    });
});
