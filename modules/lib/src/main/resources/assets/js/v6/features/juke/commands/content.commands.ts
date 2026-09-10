import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { Content } from '../../../../app/content/Content';
import { ContentPath } from '../../../../app/content/ContentPath';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { ContentHelper } from '../../../../app/util/ContentHelper';
import { ContentTypesHelper } from '../../../../app/util/ContentTypesHelper';
import { ContentUrlHelper } from '../../../../app/util/ContentUrlHelper';
import { ContentEditParams } from '../../../../app/wizard/ContentEditParams';
import { getCurrentItems } from '../../../entities/content';
import { getActiveProject } from '../../../entities/project';
import type { JukeCommand } from './command.types';
import { bestUniqueMatch } from './matching';

//
// * Content commands
//
// "Create a new <content type>" creates an unnamed content of that type under
// the single selected item (or the project root) and opens it for editing in a
// new tab. Candidate types are the ones the New Content dialog would list for
// that parent: allowed by the parent, minus media types.
//

type CreateArgs = { typeName: string };

const CREATE_PATTERN = /^(?:create|make|add)\s+(?:(?:a|an)\s+(?:new\s+)?|new\s+)(.+)$/;

export function parseCreate(text: string): CreateArgs | null {
    const match = CREATE_PATTERN.exec(text);
    return match ? { typeName: match[1] } : null;
}

export function findContentType(types: readonly ContentTypeSummary[], spokenName: string): ContentTypeSummary | null {
    const result = bestUniqueMatch(
        types.map((type) => ({ value: type, labels: [type.getTitle(), type.getContentTypeName().getLocalName()] })),
        spokenName,
    );
    return result.kind === 'match' ? result.value : null;
}

function getParentContent(): ContentSummary | undefined {
    const items = getCurrentItems();
    return items.length === 1 ? items[0] : undefined;
}

async function fetchCreatableTypes(parent: ContentSummary | undefined): Promise<ContentTypeSummary[]> {
    const types = await ContentTypesHelper.getAvailableContentTypes({
        contentId: parent?.getContentId(),
        project: getActiveProject(),
    });
    return types.filter((type) => !type.getContentTypeName().isDescendantOfMedia());
}

async function createContent(type: ContentTypeSummary, parent: ContentSummary | undefined): Promise<Content> {
    const parentPath = parent != null ? parent.getPath() : ContentPath.getRoot();
    return ContentHelper.makeNewContentRequest(type.getContentTypeName()).setParent(parentPath).sendAndParse();
}

export const createContentCommand: JukeCommand<CreateArgs> = {
    id: 'content.create',
    modes: ['dialog'],
    match: (text) => parseCreate(text),
    run: async ({ typeName }) => {
        const parent = getParentContent();
        const types = await fetchCreatableTypes(parent);
        const type = findContentType(types, typeName);
        if (type == null) {
            return { say: i18n('juke.reply.content.typeNotFound', typeName) };
        }

        try {
            const content = await createContent(type, parent);
            ContentUrlHelper.openEditContentTab(
                ContentEditParams.create(content.getContentId()).setDisplayAsNew(true).build(),
            );
        } catch (error) {
            console.error('[juke] content creation failed', error);
            return { say: i18n('juke.reply.content.failed', type.getTitle()) };
        }

        return { say: i18n('juke.reply.content.creating', type.getTitle()) };
    },
};

export const contentCommands: readonly JukeCommand[] = [createContentCommand];
