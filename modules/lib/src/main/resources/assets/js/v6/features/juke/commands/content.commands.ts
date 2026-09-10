import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { Content } from '../../../../app/content/Content';
import { ContentPath } from '../../../../app/content/ContentPath';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { ContentHelper } from '../../../../app/util/ContentHelper';
import { ContentTypesHelper } from '../../../../app/util/ContentTypesHelper';
import { ContentUrlHelper } from '../../../../app/util/ContentUrlHelper';
import { ContentEditParams } from '../../../../app/wizard/ContentEditParams';
import { getCurrentItems, revealContentByPath } from '../../../entities/content';
import { getActiveProject } from '../../../entities/project';
import type { JukeCommand, JukeReply } from './command.types';
import { canHoldChildren, findContentByName } from './content-lookup';
import { bestUniqueMatch } from './matching';

//
// * Content commands
//
// "Create a new <type> [called <name>] [under <parent>]" creates content of
// that type and opens it for editing in a new tab. The parent is the named
// content when given, else the single selected item, else the project root.
// Candidate types are the ones the New Content dialog would list for that
// parent: allowed by the parent, minus media types.
//

export type CreateArgs = {
    typeName: string;
    displayName?: string;
    parentName?: string;
};

const CREATE_PREFIX = /^(?:create|make|add)\s+(?:(?:a|an)\s+(?:new\s+)?|new\s+)(.+)$/;
const NAME_CLAUSE = /\s+(?:called|named|titled)\s+/;
const PARENT_CLAUSE = /\s+(?:under|inside|below)\s+/;

// Splits "<type> called <name> under <parent>" (either clause order) into parts.
function splitClauses(rest: string): CreateArgs {
    const nameAt = NAME_CLAUSE.exec(rest);
    const parentAt = PARENT_CLAUSE.exec(rest);
    const cuts = [
        nameAt ? { key: 'displayName' as const, index: nameAt.index, length: nameAt[0].length } : null,
        parentAt ? { key: 'parentName' as const, index: parentAt.index, length: parentAt[0].length } : null,
    ]
        .filter((cut) => cut != null)
        .sort((a, b) => a.index - b.index);

    const args: CreateArgs = { typeName: cuts.length > 0 ? rest.slice(0, cuts[0].index) : rest };
    cuts.forEach((cut, i) => {
        const end = i + 1 < cuts.length ? cuts[i + 1].index : rest.length;
        const value = rest.slice(cut.index + cut.length, end).trim();
        if (value.length > 0) {
            args[cut.key] = value;
        }
    });
    return args;
}

export function parseCreate(text: string): CreateArgs | null {
    const match = CREATE_PREFIX.exec(text);
    if (match == null) {
        return null;
    }
    const args = splitClauses(match[1].trim());
    return args.typeName.length > 0 ? args : null;
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

type ParentResolution = { parent: ContentSummary | undefined } | { reply: JukeReply };

async function resolveParent(parentName: string | undefined): Promise<ParentResolution> {
    if (parentName == null) {
        const items = getCurrentItems();
        return { parent: items.length === 1 ? items[0] : undefined };
    }
    const result = await findContentByName(parentName, { accept: canHoldChildren });
    if (result.kind === 'match') {
        return { parent: result.value };
    }
    if (result.kind === 'ambiguous') {
        return { reply: { say: i18n('juke.reply.content.parentAmbiguous', parentName) } };
    }
    return { reply: { say: i18n('juke.reply.content.parentNotFound', parentName) } };
}

async function fetchCreatableTypes(parent: ContentSummary | undefined): Promise<ContentTypeSummary[]> {
    const types = await ContentTypesHelper.getAvailableContentTypes({
        contentId: parent?.getContentId(),
        project: getActiveProject(),
    });
    return types.filter((type) => !type.getContentTypeName().isDescendantOfMedia());
}

async function createContent(
    type: ContentTypeSummary,
    parent: ContentSummary | undefined,
    displayName: string | undefined,
): Promise<Content> {
    const parentPath = parent != null ? parent.getPath() : ContentPath.getRoot();
    const request = ContentHelper.makeNewContentRequest(type.getContentTypeName()).setParent(parentPath);
    if (displayName != null) {
        request.setDisplayName(displayName);
    }
    return request.sendAndParse();
}

function creatingReply(type: ContentTypeSummary, displayName?: string, parent?: ContentSummary): JukeReply {
    const title = type.getTitle();
    if (displayName != null && parent != null) {
        return { say: i18n('juke.reply.content.creatingNamedUnder', title, displayName, parent.getDisplayName()) };
    }
    if (displayName != null) {
        return { say: i18n('juke.reply.content.creatingNamed', title, displayName) };
    }
    if (parent != null) {
        return { say: i18n('juke.reply.content.creatingUnder', title, parent.getDisplayName()) };
    }
    return { say: i18n('juke.reply.content.creating', title) };
}

export const createContentCommand: JukeCommand<CreateArgs> = {
    id: 'content.create',
    modes: ['dialog'],
    match: (text) => parseCreate(text),
    run: async ({ typeName, displayName, parentName }) => {
        const resolution = await resolveParent(parentName);
        if ('reply' in resolution) {
            return resolution.reply;
        }
        const { parent } = resolution;

        const types = await fetchCreatableTypes(parent);
        const type = findContentType(types, typeName);
        if (type == null) {
            return { say: i18n('juke.reply.content.typeNotFound', typeName) };
        }

        const name = displayName != null ? toDisplayName(displayName) : undefined;
        try {
            const content = await createContent(type, parent, name);
            ContentUrlHelper.openEditContentTab(
                ContentEditParams.create(content.getContentId()).setDisplayAsNew(true).build(),
            );
            // Expands the parent chain in the browse tree and highlights the new item.
            await revealContentByPath(content.getPath().toString()).catch(() => undefined);
        } catch (error) {
            console.error('[juke] content creation failed', error);
            return { say: i18n('juke.reply.content.failed', type.getTitle()) };
        }

        return creatingReply(type, name, parentName != null ? parent : undefined);
    },
};

export const contentCommands: readonly JukeCommand[] = [createContentCommand];
