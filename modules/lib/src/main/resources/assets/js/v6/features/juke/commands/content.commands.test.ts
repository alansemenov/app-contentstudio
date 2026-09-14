import { okAsync, errAsync } from 'neverthrow';
import { Name } from '@enonic/lib-admin-ui/Name';
import { $config } from '../../../shared/config/config.store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { $createFlow, resetCreateFlow } from '../model/createFlow.store';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext, JukeReply } from './command.types';
import {
    contentCommands,
    createNameCommand,
    createParentCommand,
    createStartCommand,
    findContentType,
    generateContentName,
    parseCreateParent,
    parseCreateStart,
    toDisplayName,
} from './content.commands';
import { sessionCommands } from './session.commands';
import { smallTalkCommands } from './smalltalk.commands';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        fetchAllContentTypes: vi.fn(),
        getAvailableContentTypes: vi.fn(),
        sendAndParse: vi.fn(),
        setParent: vi.fn(),
        setDisplayName: vi.fn(),
        setName: vi.fn(),
        makeNewContentRequest: vi.fn(),
        contentExistsByPath: vi.fn(),
        openEditContentTab: vi.fn(),
        revealContentByPath: vi.fn(),
        getActiveProject: vi.fn(),
        findContentByName: vi.fn(),
    },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('@enonic/lib-admin-ui/NamePrettyfier', () => ({
    NamePrettyfier: {
        prettify: (value: string) =>
            value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, ''),
    },
}));

vi.mock('../../../entities/schema/api/contentTypes.api', () => ({
    fetchAllContentTypes: mocks.fetchAllContentTypes,
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
    ContentPath: {
        getRoot: () => 'ROOT',
        create: () => ({ fromParent: (parent: string, child: string) => ({ build: () => `${parent}/${child}` }) }),
    },
}));

vi.mock('../../../../app/content/ContentName', () => ({
    ContentName: { fromString: (name: string) => `NAME:${name}` },
}));

vi.mock('../../../entities/content/api/contentExists.api', () => ({
    contentExistsByPath: mocks.contentExistsByPath,
}));

vi.mock('../../../entities/content', () => ({
    revealContentByPath: mocks.revealContentByPath,
}));

vi.mock('../../../entities/project', () => ({
    getActiveProject: mocks.getActiveProject,
}));

vi.mock('./content-lookup', () => ({
    findContentByName: mocks.findContentByName,
    canHoldChildren: () => true,
}));

const type = (
    localName: string,
    title: string,
    options: { media?: boolean; abstract?: boolean } = {},
): ContentTypeSummary => {
    const contentTypeName = {
        getLocalName: () => localName,
        isDescendantOfMedia: () => options.media === true,
        toString: () => `com.example:${localName}`,
    };
    return {
        getTitle: () => title,
        isAbstract: () => options.abstract === true,
        getContentTypeName: () => contentTypeName,
    } as unknown as ContentTypeSummary;
};

const blog = type('blog-post', 'Blog Post');
const article = type('article', 'Article');
const allTypes = [blog, article, type('image', 'Image', { media: true }), type('base', 'Base', { abstract: true })];

const summary = (id: string, displayName: string, path: string) => ({
    getContentId: () => id,
    getDisplayName: () => displayName,
    getPath: () => path,
});

const context = (prompt: JukeContext['prompt'] = null): JukeContext => ({ mode: 'dialog', prompt, userName: 'Alan' });

const runResolved = async (text: string, prompt: JukeContext['prompt'] = null): Promise<JukeReply | null> => {
    const resolved = resolveCommand([text], context(prompt));
    if (resolved == null) {
        return null;
    }
    return resolved.command.run(resolved.args, context(prompt));
};

describe('parseCreateStart', () => {
    it.each([
        ['create a blog', 'blog'],
        ['create a new blog post', 'blog post'],
        ['create an article', 'article'],
        ['make a folder', 'folder'],
        ['add a person', 'person'],
        ['new blog', 'blog'],
        ['great new post', 'post'],
        ['crate a post', 'post'],
    ])('should parse "%s" as type "%s"', (text, typeName) => {
        expect(parseCreateStart(text)).toEqual({ typeName });
    });

    it('should ignore unrelated phrases', () => {
        expect(parseCreateStart('go to superhero')).toBeNull();
        expect(parseCreateStart('create')).toBeNull();
    });
});

describe('parseCreateParent', () => {
    it.each(['root', 'the root', 'in the root', 'at the root', 'under root', 'in the project root', 'root folder'])(
        'should treat "%s" as the root',
        (text) => {
            expect(parseCreateParent(text)).toEqual({ kind: 'root' });
        },
    );

    it.each([
        ['under blogs', 'blogs'],
        ['in the news folder', 'news folder'],
        ['inside superhero', 'superhero'],
        ['blogs', 'blogs'],
    ])('should take "%s" as parent "%s"', (text, name) => {
        expect(parseCreateParent(text)).toEqual({ kind: 'named', name });
    });

    it.each(['lets try again', 'let us try again', 'try again', 'start over', 'lets start over', 'restart'])(
        'should recognize "%s" as a restart',
        (text) => {
            expect(parseCreateParent(text)).toEqual({ kind: 'restart' });
        },
    );
});

describe('findContentType', () => {
    it('should match by title or local name', () => {
        expect(findContentType(allTypes, 'blog')?.getTitle()).toBe('Blog Post');
        expect(findContentType(allTypes, 'article')?.getTitle()).toBe('Article');
        expect(findContentType(allTypes, 'blog-post')?.getTitle()).toBe('Blog Post');
    });

    it('should return null for unknown names', () => {
        expect(findContentType(allTypes, 'recipe')).toBeNull();
    });
});

describe('generateContentName', () => {
    it('should prettify like the wizard name field when transliteration is on', () => {
        $config.setKey('allowPathTransliteration', true);
        expect(generateContentName('Summer News!', blog)).toBe('summer-news');
    });

    it('should only strip forbidden characters when transliteration is off or the type is media', () => {
        const media = type('image', 'Image', { media: true });
        $config.setKey('allowPathTransliteration', false);
        expect(generateContentName('Summer News!', blog)).toBe(
            'Summer News!'.replace(Name.SIMPLIFIED_FORBIDDEN_CHARS, '').toLowerCase(),
        );
        $config.setKey('allowPathTransliteration', true);
        expect(generateContentName('Summer News!', media)).toBe(
            'Summer News!'.replace(Name.SIMPLIFIED_FORBIDDEN_CHARS, '').toLowerCase(),
        );
    });
});

describe('toDisplayName', () => {
    it('should capitalize the first letter only', () => {
        expect(toDisplayName('summer news')).toBe('Summer news');
        expect(toDisplayName('Q3 report')).toBe('Q3 report');
    });
});

describe('create dialog', () => {
    const created = { getContentId: () => 'new-id', getPath: () => ({ toString: () => '/blogs/new' }) };
    const blogs = summary('blogs-id', 'Blogs', 'BLOGS_PATH');

    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        resetCreateFlow();
        clearCommands();
        registerCommands(...sessionCommands, ...smallTalkCommands, ...contentCommands);

        mocks.fetchAllContentTypes.mockReturnValue(okAsync(allTypes));
        mocks.getAvailableContentTypes.mockResolvedValue([blog, article]);
        mocks.getActiveProject.mockReturnValue('PROJECT');
        mocks.sendAndParse.mockResolvedValue(created);
        const request = {
            setParent: mocks.setParent,
            setDisplayName: mocks.setDisplayName,
            setName: mocks.setName,
            sendAndParse: mocks.sendAndParse,
        };
        mocks.setParent.mockReturnValue(request);
        mocks.setDisplayName.mockReturnValue(request);
        mocks.setName.mockReturnValue(request);
        mocks.makeNewContentRequest.mockReturnValue(request);
        mocks.contentExistsByPath.mockReturnValue(okAsync(false));
        $config.setKey('allowPathTransliteration', true);
        mocks.findContentByName.mockResolvedValue({ kind: 'match', value: blogs });
        mocks.revealContentByPath.mockResolvedValue(undefined);
    });

    it('should ask where to create after resolving the type', async () => {
        const reply = await runResolved('create a blog');

        expect(reply).toEqual({ say: 'juke.reply.create.askParent|Blog Post', prompt: 'createParent' });
        expect($createFlow.get()?.type).toBe(blog);
    });

    it('should try the type and the parent from every recognition alternative', async () => {
        const startCtx: JukeContext = {
            ...context(),
            alternatives: ['great new host', 'create new post', 'great new post'],
        };
        const start = resolveCommand([startCtx.alternatives![0]], startCtx)!;
        const post = type('post', 'Post');
        mocks.fetchAllContentTypes.mockReturnValue(okAsync([...allTypes, post]));
        mocks.getAvailableContentTypes.mockResolvedValue([blog, article, post]);

        expect(await start.command.run(start.args, startCtx)).toEqual({
            say: 'juke.reply.create.askParent|Post',
            prompt: 'createParent',
        });

        mocks.findContentByName.mockImplementation(async (name: string) =>
            name === 'blogs' ? { kind: 'match', value: blogs } : { kind: 'none' },
        );
        const parentCtx: JukeContext = { ...context('createParent'), alternatives: ['under blocks', 'under blogs'] };
        const parentStep = resolveCommand(['under blocks'], parentCtx)!;

        expect(await parentStep.command.run(parentStep.args, parentCtx)).toEqual({
            say: 'juke.reply.create.askName|Post',
            prompt: 'createName',
        });
        expect($createFlow.get()?.parent).toBe(blogs);
    });

    it('should not offer media or abstract types and ask to try again', async () => {
        expect(await runResolved('create an image')).toEqual({ say: 'juke.reply.create.typeNotFound|image' });
        expect(await runResolved('create a base')).toEqual({ say: 'juke.reply.create.typeNotFound|base' });
        expect($createFlow.get()).toBeNull();
    });

    it('should resolve a named parent, check the type is allowed and ask for the name', async () => {
        await runResolved('create a blog');

        const reply = await runResolved('under blogs', 'createParent');

        expect(mocks.findContentByName).toHaveBeenCalledWith('blogs', { accept: expect.any(Function) });
        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: 'blogs-id', project: 'PROJECT' });
        expect(reply).toEqual({ say: 'juke.reply.create.askName|Blog Post', prompt: 'createName' });
        expect($createFlow.get()?.parent).toBe(blogs);
    });

    it('should accept the root as parent', async () => {
        await runResolved('create a blog');

        const reply = await runResolved('in the root', 'createParent');

        expect(mocks.findContentByName).not.toHaveBeenCalled();
        expect(mocks.getAvailableContentTypes).toHaveBeenCalledWith({ contentId: undefined, project: 'PROJECT' });
        expect(reply).toEqual({ say: 'juke.reply.create.askName|Blog Post', prompt: 'createName' });
        expect($createFlow.get()?.parent).toBeUndefined();
    });

    it('should keep asking when the parent is unknown, ambiguous or disallows the type', async () => {
        await runResolved('create a blog');

        mocks.findContentByName.mockResolvedValueOnce({ kind: 'none' });
        expect(await runResolved('under nowhere', 'createParent')).toEqual({
            say: 'juke.reply.create.parentNotFound|nowhere',
        });

        mocks.findContentByName.mockResolvedValueOnce({ kind: 'ambiguous', values: [] });
        expect(await runResolved('under news', 'createParent')).toEqual({
            say: 'juke.reply.create.parentAmbiguous|news',
        });

        mocks.getAvailableContentTypes.mockResolvedValueOnce([article]);
        expect(await runResolved('under blogs', 'createParent')).toEqual({
            say: 'juke.reply.create.notAllowed|Blog Post|Blogs',
        });

        mocks.getAvailableContentTypes.mockResolvedValueOnce([article]);
        expect(await runResolved('root', 'createParent')).toEqual({
            say: 'juke.reply.create.notAllowedRoot|Blog Post',
        });

        expect($createFlow.get()?.parent).toBeUndefined();
        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();
    });

    it('should create with the spoken name under the chosen parent and confirm', async () => {
        await runResolved('create a blog');
        await runResolved('under blogs', 'createParent');

        const reply = await runResolved('summer news', 'createName');

        expect(mocks.makeNewContentRequest).toHaveBeenCalledWith(blog.getContentTypeName());
        expect(mocks.setParent).toHaveBeenCalledWith('BLOGS_PATH');
        expect(mocks.setDisplayName).toHaveBeenCalledWith('Summer news');
        expect(mocks.contentExistsByPath).toHaveBeenCalledWith('BLOGS_PATH/summer-news');
        expect(mocks.setName).toHaveBeenCalledWith('NAME:summer-news');
        expect(mocks.openEditContentTab).toHaveBeenCalledWith({ contentId: 'new-id', displayAsNew: true });
        expect(mocks.revealContentByPath).toHaveBeenCalledWith('/blogs/new');
        expect(reply).toEqual({ say: 'juke.reply.create.creating|Blog Post|Summer news|Blogs', prompt: null });
        expect($createFlow.get()).toBeNull();
    });

    it('should create in the root and say so', async () => {
        await runResolved('create a blog');
        await runResolved('in the root', 'createParent');

        const reply = await runResolved('summer news', 'createName');

        expect(mocks.setParent).toHaveBeenCalledWith('ROOT');
        expect(reply).toEqual({ say: 'juke.reply.create.creatingRoot|Blog Post|Summer news', prompt: null });
    });

    it('should add a numeric suffix when the generated path is taken', async () => {
        await runResolved('create a blog');
        await runResolved('root', 'createParent');
        mocks.contentExistsByPath.mockReturnValueOnce(okAsync(true)).mockReturnValueOnce(okAsync(true));

        await runResolved('summer news', 'createName');

        expect(mocks.contentExistsByPath.mock.calls.map((call) => call[0])).toEqual([
            'ROOT/summer-news',
            'ROOT/summer-news-1',
            'ROOT/summer-news-2',
        ]);
        expect(mocks.setName).toHaveBeenCalledWith('NAME:summer-news-2');
    });

    it('should take any phrase as the name, including ones that look like commands', async () => {
        await runResolved('create a blog');
        await runResolved('root', 'createParent');

        await runResolved('how are you', 'createName');

        expect(mocks.setDisplayName).toHaveBeenCalledWith('How are you');
    });

    it('should let the session cancel command abandon the dialog at either step', async () => {
        await runResolved('create a blog');
        expect(await runResolved('cancel', 'createParent')).toEqual({ say: 'juke.reply.cancel', prompt: null });
        expect($createFlow.get()).toBeNull();

        await runResolved('create a blog');
        await runResolved('root', 'createParent');
        expect(await runResolved('never mind', 'createName')).toEqual({ say: 'juke.reply.cancel', prompt: null });
        expect($createFlow.get()).toBeNull();
        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();
    });

    it('should start over on "let\'s try again" at either step', async () => {
        await runResolved('create a blog');
        expect(await runResolved('lets try again', 'createParent')).toEqual({
            say: 'juke.reply.create.restart',
            prompt: null,
        });
        expect($createFlow.get()).toBeNull();

        await runResolved('create a blog');
        await runResolved('root', 'createParent');
        expect(await runResolved('start over', 'createName')).toEqual({
            say: 'juke.reply.create.restart',
            prompt: null,
        });
        expect($createFlow.get()).toBeNull();
        expect(mocks.makeNewContentRequest).not.toHaveBeenCalled();

        expect(await runResolved('create an article')).toEqual({
            say: 'juke.reply.create.askParent|Article',
            prompt: 'createParent',
        });
    });

    it('should let goodbye win over an open prompt', async () => {
        await runResolved('create a blog');
        const resolved = resolveCommand(['goodbye juke'], context('createParent'));
        expect(resolved?.command.id).toBe('session.goodbye');
    });

    it('should report a failed creation and leave the dialog', async () => {
        await runResolved('create a blog');
        await runResolved('root', 'createParent');
        mocks.sendAndParse.mockRejectedValue(new Error('boom'));

        const reply = await runResolved('summer news', 'createName');

        expect(mocks.openEditContentTab).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.create.failed|Blog Post', prompt: null });
        expect($createFlow.get()).toBeNull();
    });

    it('should surface a failing type request', async () => {
        mocks.fetchAllContentTypes.mockReturnValue(errAsync(new Error('offline')));

        await expect(runResolved('create a blog')).rejects.toThrow('offline');
    });

    it('should expose the three commands in dialog order', () => {
        expect(contentCommands).toEqual([createStartCommand, createParentCommand, createNameCommand]);
    });
});
