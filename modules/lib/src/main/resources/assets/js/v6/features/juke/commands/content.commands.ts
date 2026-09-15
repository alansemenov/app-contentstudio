import { Name } from '@enonic/lib-admin-ui/Name';
import { NamePrettyfier } from '@enonic/lib-admin-ui/NamePrettyfier';
import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { Content } from '../../../../app/content/Content';
import { ContentName } from '../../../../app/content/ContentName';
import { ContentPath } from '../../../../app/content/ContentPath';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { ContentHelper } from '../../../../app/util/ContentHelper';
import { ContentTypesHelper } from '../../../../app/util/ContentTypesHelper';
import { ContentEditParams } from '../../../../app/wizard/ContentEditParams';
import { revealContentByPath } from '../../../entities/content';
import { contentExistsByPath } from '../../../entities/content/api/contentExists.api';
import { $config } from '../../../shared/config/config.store';
import { getActiveProject } from '../../../entities/project';
import { fetchAllContentTypes } from '../../../entities/schema/api/contentTypes.api';
import {
    $createFlow,
    resetCreateFlow,
    setCreateFlowParent,
    startCreateFlow,
    type CreateFlow,
} from '../model/createFlow.store';
import type { JukeCommand, JukeReply } from './command.types';
import { canHoldChildren, findContentByName, spokenName } from './content-lookup';
import { openEditTabWithJuke } from './handoff';
import { expandInTree, leaveFilterMode } from './tree-reveal';
import { bestUniqueMatch, parseAlternatives } from './matching';

//
// * Content creation dialog
//
//   User: "Create a blog"           -> type resolved among the project's content types
//   Juke: "Where do you want to create a new Blog?"          (prompt: createParent)
//   User: "Under blogs" / "In the root"
//   Juke: "How do you want to call the new Blog?"            (prompt: createName)
//   User: "Summer news"
//   Juke: "Creating a new Blog called Summer news under Blogs"
//
// The type must be allowed under the chosen parent; otherwise Juke asks for a
// different parent. "Cancel" (a session command) and "let's try again" leave the dialog at any step.
//

export type CreateStartArgs = { typeName: string };
export type CreateParentArgs = { kind: 'root' } | { kind: 'restart' } | { kind: 'named'; name: string };
export type CreateNameArgs = { kind: 'restart' } | { kind: 'named'; name: string };

// "create" is often heard as "great" or "crate".
const CREATE_PATTERN = /^(?:create|great|crate|created|make|add|new)\s+(?:(?:a|an)\s+)?(?:new\s+)?(.+)$/;
const RESTART_PATTERN = /^(?:lets|let us)?\s*(?:try again|start over|start again|restart)$/;
const ROOT_PATTERN = /^(?:(?:in|at|under|inside|to)\s+)?(?:the\s+)?(?:project\s+)?root(?:\s+(?:folder|level))?$/;
const PARENT_PREFIX = /^(?:under|in|inside|below|into)\s+(?:the\s+)?/;

export function parseCreateStart(text: string): CreateStartArgs | null {
    const match = CREATE_PATTERN.exec(text);
    return match ? { typeName: match[1].trim() } : null;
}

export function parseCreateParent(text: string): CreateParentArgs {
    if (RESTART_PATTERN.test(text)) {
        return { kind: 'restart' };
    }
    if (ROOT_PATTERN.test(text)) {
        return { kind: 'root' };
    }
    return { kind: 'named', name: text.replace(PARENT_PREFIX, '').trim() || text };
}

export function parseCreateName(text: string): CreateNameArgs {
    if (RESTART_PATTERN.test(text)) {
        return { kind: 'restart' };
    }
    return { kind: 'named', name: text };
}

export function findContentType(types: readonly ContentTypeSummary[], spokenName: string): ContentTypeSummary | null {
    const result = bestUniqueMatch(
        types.map((type) => ({ value: type, labels: [type.getTitle(), type.getContentTypeName().getLocalName()] })),
        spokenName,
    );
    return result.kind === 'match' ? result.value : null;
}

// Spoken text arrives lowercased; a display name deserves a capital.
export function toDisplayName(spoken: string): string {
    return spoken.charAt(0).toUpperCase() + spoken.slice(1);
}

async function fetchCreatableTypes(): Promise<ContentTypeSummary[]> {
    const result = await fetchAllContentTypes();
    if (result.isErr()) {
        throw result.error;
    }
    return result.value.filter((type) => !type.isAbstract() && !type.getContentTypeName().isDescendantOfMedia());
}

async function isTypeAllowedUnder(type: ContentTypeSummary, parent: ContentSummary | undefined): Promise<boolean> {
    const allowed = await ContentTypesHelper.getAvailableContentTypes({
        contentId: parent?.getContentId(),
        project: getActiveProject(),
    });
    const wanted = type.getContentTypeName().toString();
    return allowed.some((candidate) => candidate.getContentTypeName().toString() === wanted);
}

// Same rules as the wizard's name field: transliterated and prettified, or
// simplified for media types and when transliteration is disabled.
export function generateContentName(displayName: string, type: ContentTypeSummary): string {
    const simplified = type.getContentTypeName().isDescendantOfMedia() || !$config.get().allowPathTransliteration;
    return simplified
        ? displayName.replace(Name.SIMPLIFIED_FORBIDDEN_CHARS, '').toLowerCase()
        : NamePrettyfier.prettify(displayName);
}

const MAX_NAME_ATTEMPTS = 50;

// The wizard flags an occupied path and lets the user fix it; by voice the name
// gets a numeric suffix instead.
async function resolveUniqueName(baseName: string, parentPath: ContentPath): Promise<string> {
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
        const candidate = attempt === 0 ? baseName : `${baseName}-${attempt}`;
        const path = ContentPath.create().fromParent(parentPath, candidate).build();
        const exists = await contentExistsByPath(path.toString());
        if (exists.isErr() || !exists.value) {
            return candidate;
        }
    }
    return `${baseName}-${Date.now()}`;
}

async function createContent(flow: CreateFlow, displayName: string): Promise<Content> {
    const parentPath = flow.parent != null ? flow.parent.getPath() : ContentPath.getRoot();
    const request = ContentHelper.makeNewContentRequest(flow.type.getContentTypeName())
        .setParent(parentPath)
        .setDisplayName(displayName);

    const baseName = generateContentName(displayName, flow.type);
    if (baseName.length > 0) {
        request.setName(ContentName.fromString(await resolveUniqueName(baseName, parentPath)));
    }
    return request.sendAndParse();
}

// "Let's try again" drops everything collected so far and invites a fresh "create a ...".
// Also the fallback when a prompt is open without flow state (cannot normally happen).
const restarted = (): JukeReply => {
    resetCreateFlow();
    return { say: i18n('juke.reply.create.restart'), prompt: null };
};

export const createStartCommand: JukeCommand<CreateStartArgs> = {
    id: 'content.create.start',
    modes: ['dialog'],
    prompts: [null, 'search', 'showResults'],
    match: (text) => parseCreateStart(text),
    run: async ({ typeName }, context) => {
        const types = await fetchCreatableTypes();
        const names = parseAlternatives(
            context.alternatives,
            `create a ${typeName}`,
            (text) => parseCreateStart(text)?.typeName ?? null,
        );
        const type = names.map((candidate) => findContentType(types, candidate)).find((found) => found != null) ?? null;
        if (type == null) {
            return { say: i18n('juke.reply.create.typeNotFound', typeName) };
        }
        startCreateFlow(type);
        return { say: i18n('juke.reply.create.askParent', type.getTitle()), prompt: 'createParent' };
    },
};

export const createParentCommand: JukeCommand<CreateParentArgs> = {
    id: 'content.create.parent',
    modes: ['dialog'],
    prompts: ['createParent'],
    match: (text) => parseCreateParent(text),
    run: async (args, context) => {
        const flow = $createFlow.get();
        if (args.kind === 'restart' || flow == null) {
            return restarted();
        }
        const title = flow.type.getTitle();

        let parent: ContentSummary | undefined;
        let parentName: string | undefined;
        if (args.kind === 'named') {
            const names = parseAlternatives(context.alternatives, args.name, (text) => {
                const parsed = parseCreateParent(text);
                return parsed.kind === 'named' ? parsed.name : null;
            });
            let ambiguous: string | null = null;
            for (const candidate of names) {
                const result = await findContentByName(candidate, { accept: canHoldChildren });
                if (result.kind === 'match') {
                    parent = result.value;
                    parentName = spokenName(result.value, result.labelIndex);
                    break;
                }
                if (result.kind === 'ambiguous' && ambiguous == null) {
                    ambiguous = candidate;
                }
            }
            if (parent == null) {
                return ambiguous != null
                    ? { say: i18n('juke.reply.create.parentAmbiguous', ambiguous) }
                    : { say: i18n('juke.reply.create.parentNotFound', args.name) };
            }
        }

        if (!(await isTypeAllowedUnder(flow.type, parent))) {
            return {
                say:
                    parent != null
                        ? i18n('juke.reply.create.notAllowed', title, parentName ?? parent.getDisplayName())
                        : i18n('juke.reply.create.notAllowedRoot', title),
            };
        }

        setCreateFlowParent(parent, parentName);
        return { say: i18n('juke.reply.create.askName', title), prompt: 'createName' };
    },
};

export const createNameCommand: JukeCommand<CreateNameArgs> = {
    id: 'content.create.name',
    modes: ['dialog'],
    prompts: ['createName'],
    match: (text) => parseCreateName(text),
    run: async (args) => {
        const flow = $createFlow.get();
        if (args.kind === 'restart' || flow == null) {
            return restarted();
        }
        const title = flow.type.getTitle();
        const displayName = toDisplayName(args.name);
        let handoff: Window | null = null;

        try {
            const content = await createContent(flow, displayName);
            handoff = openEditTabWithJuke(
                ContentEditParams.create(content.getContentId()).setDisplayAsNew(true).build(),
            );
            // Shows the new item: leave the filtered list, expand the parent, then
            // highlight the item once the tree has it.
            await leaveFilterMode();
            await expandInTree(content.getPath().getParentPath());
            await revealContentByPath(content.getPath().toString()).catch(() => undefined);
        } catch (error) {
            console.error('[juke] content creation failed', error);
            resetCreateFlow();
            return { say: i18n('juke.reply.create.failed', title), prompt: null };
        }

        const parentName = flow.parentName ?? flow.parent?.getDisplayName();
        resetCreateFlow();
        return {
            say:
                parentName != null
                    ? i18n('juke.reply.create.creating', title, displayName, parentName)
                    : i18n('juke.reply.create.creatingRoot', title, displayName),
            prompt: null,
            handoff: handoff ?? undefined,
        };
    },
};

export const contentCommands: readonly JukeCommand[] = [createStartCommand, createParentCommand, createNameCommand];
