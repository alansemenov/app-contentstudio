import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import type { JukeContext } from './command.types';
import { createContentCommand, findContentType, parseCreate, toDisplayName } from './content.commands';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getAvailableContentTypes: vi.fn(),
        sendAndParse: vi.fn(),
        setParent: vi.fn(),
        setDisplayName: vi.fn(),
        makeNewContentRequest: vi.fn(),
        openEditContentTab: vi.fn(),
        getCurrentItems: vi.fn(),
        getActiveProject: vi.fn(),
        findContentByName: vi.fn(),
        revealContentByPath: vi.fn(),
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
    revealContentByPath: mocks.revealContentByPath,
}));

vi.mock('../../../entities/project', () => ({
    getActiveProject: mocks.getActiveProject,
}));

vi.mock('./content-lookup', () => ({
    findContentByName: mocks.findContentByName,
    canHoldChildren: () => true,
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

const summary = (id: string, displayName: string, path: string) => ({
    getContentId: () => id,
    getDisplayName: () => displayName,
    getPath: () => path,
});

describe('parseCreate', () => {
    it.each([
        ['create a new blog', { typeName: 'blog' }],
        ['create new blog post', { typeName: 'blog post' }],
        ['create an article', { typeName: 'article' }],
        ['make a new folder', { typeName: 'folder' }],
        ['add a person', { typeName: 'person' }],
        ['create a new blog called summer news', { typeName: 'blog', displayName: 'summer news' }],
        ['create a new blog named summer news', { typeName: 'blog', displayName: 'summer news' }],
        ['create a new article under superhero', { typeName: 'article', parentName: 'superhero' }],
        ['create a new article inside the news folder', { typeName: 'article', parentName: 'the news folder' }],
        ['create a new blog called life in the city', { typeName: 'blog', displayName: 'life in the city' }],
        [
            'create a new blog called summer news under superhero',
            { typeName: 'blog', displayName: 'summer news', parentName: 'superhero' },
        ],
        [
            'create a new blog under superhero called summer news',
            { typeName: 'blog', displayName: 'summer news', parentName: 'superhero' },
        ],
    ])('should parse "%s"', (text, expected) => {
        expect(parseCreate(text)).toEqual(expected);
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

describe('toDisplayName', () => {
    it('should capitalize the first letter only', () => {
        expect(toDisplayName('summer news')).toBe('Summer news');
        expect(toDisplayName('Q3 report')).toBe('Q3 report');
    });
});

describe('createContentCommand', () => {
    const created = { getContentId: () => 'new-id', getPath: () => ({ toString: () => '/news/new' }) };

    const run = (text: string) => {
        const args = createContentCommand.match(text, context)!;
        return createContentCommand.run(args, context);
    };

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.getAvailableContentTypes.mockResolvedValue(types);
        mocks.getActiveProject.mockReturnValue('PROJECT');
        mocks.getCurrentItems.mockReturnValue([]);
        mocks.sendAndParse.mockResolvedValue(created);
        const request = {
            setParent: mocks.setParent,
            setDisplayName: mocks.setDisplayName,
            sendAndParse: mocks.sendAndParse,
        };
        mocks.setParent.mockReturnValue(request);
        mocks.setDisplayName.mockReturnValue(request);
        mocks.makeNewContentRequest.mockReturnValue(request);
        mocks.findContentByName.mockResolvedValue({ kind: 'none' });
        mocks.revealContentByPath.mockResolvedValue(undefined);
    });

    it('should create the content at the root and open it for editing as new', async () => {
        const reply = await run('create a new blog');

        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: undefined, project: 'PROJECT' });
        expect(mocks.makeNewContentRequest).toHaveBeenCalledWith(types[0].getContentTypeName());
        expect(mocks.setParent).toHaveBeenCalledWith('ROOT');
        expect(mocks.setDisplayName).not.toHaveBeenCalled();
        expect(mocks.openEditContentTab).toHaveBeenCalledWith({ contentId: 'new-id', displayAsNew: true });
        expect(reply).toEqual({ say: 'juke.reply.content.creating|Blog Post' });
    });

    it('should create under the single selected item', async () => {
        mocks.getCurrentItems.mockReturnValue([summary('parent-id', 'Parent', 'PARENT_PATH')]);

        const reply = await run('create a new article');

        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: 'parent-id', project: 'PROJECT' });
        expect(mocks.setParent).toHaveBeenCalledWith('PARENT_PATH');
        expect(reply).toEqual({ say: 'juke.reply.content.creating|Article' });
    });

    it('should use the root when several items are selected', async () => {
        mocks.getCurrentItems.mockReturnValue([summary('a', 'A', 'A'), summary('b', 'B', 'B')]);

        await run('create a new article');

        expect(mocks.setParent).toHaveBeenCalledWith('ROOT');
    });

    it('should set the display name when a name is given', async () => {
        const reply = await run('create a new blog called summer news');

        expect(mocks.setDisplayName).toHaveBeenCalledWith('Summer news');
        expect(reply).toEqual({ say: 'juke.reply.content.creatingNamed|Blog Post|Summer news' });
    });

    it('should look up the parent by name and create under it', async () => {
        const parent = summary('news-id', 'News', 'NEWS_PATH');
        mocks.getCurrentItems.mockReturnValue([summary('sel', 'Selected', 'SELECTED_PATH')]);
        mocks.findContentByName.mockResolvedValue({ kind: 'match', value: parent });

        const reply = await run('create a new article under news');

        expect(mocks.findContentByName).toHaveBeenCalledWith('news', { accept: expect.any(Function) });
        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: 'news-id', project: 'PROJECT' });
        expect(mocks.setParent).toHaveBeenCalledWith('NEWS_PATH');
        expect(mocks.revealContentByPath).toHaveBeenCalledWith('/news/new');
        expect(reply).toEqual({ say: 'juke.reply.content.creatingUnder|Article|News' });
    });

    it('should combine name and parent', async () => {
        mocks.findContentByName.mockResolvedValue({ kind: 'match', value: summary('news-id', 'News', 'NEWS_PATH') });

        const reply = await run('create a new blog called summer news under news');

        expect(mocks.setDisplayName).toHaveBeenCalledWith('Summer news');
        expect(mocks.setParent).toHaveBeenCalledWith('NEWS_PATH');
        expect(reply).toEqual({ say: 'juke.reply.content.creatingNamedUnder|Blog Post|Summer news|News' });
    });

    it('should report an unknown or ambiguous parent without creating', async () => {
        mocks.findContentByName.mockResolvedValueOnce({ kind: 'none' });
        expect(await run('create a new blog under nowhere')).toEqual({
            say: 'juke.reply.content.parentNotFound|nowhere',
        });

        mocks.findContentByName.mockResolvedValueOnce({ kind: 'ambiguous', values: [] });
        expect(await run('create a new blog under news')).toEqual({ say: 'juke.reply.content.parentAmbiguous|news' });

        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();
    });

    it('should not offer media types and report unknown types', async () => {
        const reply = await run('create a new image');

        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.content.typeNotFound|image' });
    });

    it('should report a failed creation without opening a tab', async () => {
        mocks.sendAndParse.mockRejectedValue(new Error('boom'));

        const reply = await run('create a new blog');

        expect(mocks.openEditContentTab).not.toHaveBeenCalled();
        expect(mocks.revealContentByPath).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.content.failed|Blog Post' });
    });
});
