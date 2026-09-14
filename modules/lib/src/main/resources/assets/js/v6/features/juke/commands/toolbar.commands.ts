import type { TaskId } from '@enonic/lib-admin-ui/task/TaskId';
import { showError, showSuccess } from '@enonic/lib-admin-ui/notify/MessageBus';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { ResultAsync } from 'neverthrow';
import { PreviewActionHelper } from '../../../../app/action/PreviewActionHelper';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { ContentUrlHelper } from '../../../../app/util/ContentUrlHelper';
import { archiveContent } from '../../../entities/content/api/delete.api';
import { duplicateContent } from '../../../entities/content/api/duplicate.api';
import { moveContent } from '../../../entities/content/api/move.api';
import { trackTask } from '../../../entities/task/task.service';
import type { AppError } from '../../../shared/api/errors';
import { $actionFlow, resetActionFlow, startActionFlow, type ActionFlow } from '../model/actionFlow.store';
import type { JukeCommand, JukeContext, JukeReply } from './command.types';
import { canHoldChildren, findContentByName, spokenName } from './content-lookup';
import { parseAlternatives } from './matching';
import { parseTarget, resolveTarget, type TargetSpec } from './target';
import { expandInTree, leaveFilterMode } from './tree-reveal';

//
// * Toolbar actions on a spoken target
//
//   "edit the top one"            -> one edit tab per item
//   "delete summer news"          -> "Are you sure ...?"            (prompt: confirmDelete)
//   "move it"                     -> "Where do you want to move ...?" (prompt: moveTarget)
//   "duplicate the last one"      -> "Include child items ...?"      (prompt: duplicateChildren)
//   "preview all"                 -> one preview tab per previewable item
//
// Delete archives, as the toolbar's Delete does. Actions never change the
// mouse selection.
//

export type ToolbarAction = 'edit' | 'delete' | 'move' | 'duplicate' | 'preview';
export type ToolbarArgs = { action: ToolbarAction; target: string };
export type YesNoArgs = { kind: 'yes' } | { kind: 'no' } | { kind: 'restart' } | { kind: 'other' };
export type MoveTargetArgs = { kind: 'restart' } | { kind: 'root' } | { kind: 'named'; name: string };

const VERBS: Record<string, ToolbarAction> = {
    edit: 'edit',
    delete: 'delete',
    remove: 'delete',
    archive: 'delete',
    move: 'move',
    relocate: 'move',
    duplicate: 'duplicate',
    copy: 'duplicate',
    clone: 'duplicate',
    preview: 'preview',
};

const ACTION_PATTERN = /^(edit|delete|remove|archive|move|relocate|duplicate|copy|clone|preview)(?:\s+(.*))?$/;
const YES_PATTERN = /^(?:yes|yeah|yep|sure|please|ok|okay|do it|go ahead|confirm|yes please)$/;
const NO_PATTERN = /^(?:no|nope|dont|do not|no thanks|no thank you)$/;
const RESTART_PATTERN = /^(?:lets|let us)?\s*(?:try again|start over|start again|restart)$/;
const ROOT_PATTERN = /^(?:(?:to|in|at|under|inside|into)\s+)?(?:the\s+)?(?:project\s+)?root(?:\s+(?:folder|level))?$/;
const MOVE_PREFIX = /^(?:to|under|in|inside|into|below)\s+(?:the\s+)?/;

export function parseToolbar(text: string): ToolbarArgs | null {
    const match = ACTION_PATTERN.exec(text);
    if (match == null) {
        return null;
    }
    return { action: VERBS[match[1]], target: (match[2] ?? '').trim() };
}

export function parseYesNo(text: string): YesNoArgs {
    if (YES_PATTERN.test(text)) return { kind: 'yes' };
    if (NO_PATTERN.test(text)) return { kind: 'no' };
    if (RESTART_PATTERN.test(text)) return { kind: 'restart' };
    return { kind: 'other' };
}

export function parseMoveTarget(text: string): MoveTargetArgs {
    if (RESTART_PATTERN.test(text)) return { kind: 'restart' };
    if (ROOT_PATTERN.test(text)) return { kind: 'root' };
    return { kind: 'named', name: text.replace(MOVE_PREFIX, '').trim() || text };
}

// Target specs from every recognition alternative that carries the same action.
function targetSpecs(args: ToolbarArgs, context: JukeContext): TargetSpec[] {
    return parseAlternatives(context.alternatives, `${args.action} ${args.target}`.trim(), (text) => {
        const parsed = parseToolbar(text);
        return parsed?.action === args.action ? parseTarget(parsed.target) : null;
    });
}

type TaskOutcome = { ok: boolean; message: string };

// Resolves a task-returning request and waits for the task to finish. Failures
// are shown as Content Studio's usual error notification.
async function runTask(request: ResultAsync<TaskId, AppError>, actionLabel: string): Promise<TaskOutcome> {
    const result = await request;
    if (result.isErr()) {
        console.error('[juke] action request failed', result.error);
        showError(result.error.message || i18n('notify.process.failed', actionLabel));
        return { ok: false, message: result.error.message };
    }
    return new Promise<TaskOutcome>((resolve) => {
        trackTask(result.value, {
            onComplete: (state, message) => {
                const ok = state !== 'ERROR';
                if (!ok) {
                    showError(message || i18n('notify.process.failed', actionLabel));
                }
                resolve({ ok, message });
            },
        });
    });
}

function ask(action: ActionFlow['action'], items: ContentSummary[], label: string): JukeReply {
    startActionFlow({ action, items, label });
    switch (action) {
        case 'delete':
            return {
                say:
                    items.length === 1
                        ? i18n('juke.reply.delete.confirmOne', label)
                        : i18n('juke.reply.delete.confirmMany', items.length),
                prompt: 'confirmDelete',
            };
        case 'move':
            return { say: i18n('juke.reply.move.where', label), prompt: 'moveTarget' };
        case 'duplicate':
            return { say: i18n('juke.reply.duplicate.children', label), prompt: 'duplicateChildren' };
    }
}

export const toolbarCommand: JukeCommand<ToolbarArgs> = {
    id: 'toolbar.action',
    modes: ['dialog'],
    prompts: [null, 'search', 'showResults'],
    match: (text) => parseToolbar(text),
    run: async (args, context) => {
        const resolution = await resolveTarget(targetSpecs(args, context));
        if (resolution.kind === 'reply') {
            return resolution.reply;
        }
        const { items, label } = resolution;

        switch (args.action) {
            case 'edit':
                items.forEach((item) => ContentUrlHelper.openEditContentTab(item.getContentId()));
                return {
                    say:
                        items.length === 1
                            ? i18n('juke.reply.edit.opening', label)
                            : i18n('juke.reply.edit.openingMany', items.length),
                };
            case 'preview':
                // Whether an item renders is only known by rendering it (most content
                // uses a page template and has no page of its own), so every target is
                // opened and the preview page itself reports what cannot render.
                new PreviewActionHelper().openWindows(items);
                return {
                    say:
                        items.length === 1
                            ? i18n('juke.reply.preview.opening', label)
                            : i18n('juke.reply.preview.openingMany', items.length),
                };
            case 'move':
                if (items.length > 1 && targetSpecs(args, context)[0]?.kind === 'all') {
                    return { say: i18n('juke.reply.move.notAll') };
                }
                return ask('move', items, label);
            case 'delete':
            case 'duplicate':
                return ask(args.action, items, label);
        }
    },
};

const flowOrNull = (action: ActionFlow['action']): ActionFlow | null => {
    const flow = $actionFlow.get();
    return flow?.action === action ? flow : null;
};

const finished = (say: string): JukeReply => {
    resetActionFlow();
    return { say, prompt: null };
};

export const confirmDeleteCommand: JukeCommand<YesNoArgs> = {
    id: 'toolbar.confirmDelete',
    modes: ['dialog'],
    prompts: ['confirmDelete'],
    match: (text) => parseYesNo(text),
    run: async (answer) => {
        const flow = flowOrNull('delete');
        if (flow == null) {
            return finished(i18n('juke.reply.cancel'));
        }
        if (answer.kind !== 'yes') {
            return finished(i18n('juke.reply.delete.cancelled'));
        }
        const { ok } = await runTask(
            archiveContent(flow.items.map((item) => item.getContentId())),
            i18n('action.delete'),
        );
        if (!ok) {
            return finished(i18n('juke.reply.action.failed'));
        }
        // Same toast the Delete dialog shows.
        const total = flow.items.length;
        showSuccess(
            total > 1
                ? i18n('dialog.archive.success.multiple', total)
                : i18n('dialog.archive.success.single', flow.items[0].getDisplayName()),
        );
        return finished(i18n('juke.reply.delete.done', flow.label));
    },
};

export const moveTargetCommand: JukeCommand<MoveTargetArgs> = {
    id: 'toolbar.moveTarget',
    modes: ['dialog'],
    prompts: ['moveTarget'],
    match: (text) => parseMoveTarget(text),
    run: async (answer, context) => {
        const flow = flowOrNull('move');
        if (flow == null) {
            return finished(i18n('juke.reply.cancel'));
        }
        if (answer.kind === 'restart') {
            return { say: i18n('juke.reply.move.where', flow.label) };
        }

        let destination: ContentSummary | undefined;
        let destinationName: string | undefined;
        if (answer.kind === 'named') {
            const movedIds = new Set(flow.items.map((item) => item.getContentId().toString()));
            const movedPaths = flow.items.map((item) => `${item.getPath().toString()}/`);
            const accept = (candidate: ContentSummary): boolean =>
                canHoldChildren(candidate) &&
                !movedIds.has(candidate.getContentId().toString()) &&
                !movedPaths.some((path) => candidate.getPath().toString().startsWith(path));

            const names = parseAlternatives(context.alternatives, answer.name, (text) => {
                const parsed = parseMoveTarget(text);
                return parsed.kind === 'named' ? parsed.name : null;
            });
            let ambiguous: string | null = null;
            for (const name of names) {
                const result = await findContentByName(name, { accept });
                if (result.kind === 'match') {
                    destination = result.value;
                    destinationName = spokenName(result.value, result.labelIndex);
                    break;
                }
                if (result.kind === 'ambiguous') {
                    ambiguous ??= name;
                }
            }
            if (destination == null) {
                return ambiguous != null
                    ? { say: i18n('juke.reply.move.targetAmbiguous', ambiguous) }
                    : { say: i18n('juke.reply.move.targetNotFound', answer.name) };
            }
        }

        const { ok } = await runTask(
            moveContent(
                flow.items.map((item) => item.getContentId()),
                destination?.getPath(),
            ),
            i18n('action.move'),
        );
        if (!ok) {
            return finished(i18n('juke.reply.action.failed'));
        }
        // Same toast the Move dialog shows.
        const total = flow.items.length;
        const destinationLabel = destination?.getPath().toString() || i18n('field.root');
        showSuccess(
            `${i18n(total > 1 ? 'notify.items.moved.to.multi' : 'notify.items.moved.to.single', total)} ${destinationLabel}`,
        );
        if (destination != null) {
            // Shows the moved items in their new place without changing the selection.
            await leaveFilterMode();
            await expandInTree(destination.getPath());
        }
        return finished(
            destination != null
                ? i18n('juke.reply.move.done', flow.label, destinationName ?? destination.getDisplayName())
                : i18n('juke.reply.move.doneRoot', flow.label),
        );
    },
};

export const duplicateChildrenCommand: JukeCommand<YesNoArgs> = {
    id: 'toolbar.duplicateChildren',
    modes: ['dialog'],
    prompts: ['duplicateChildren'],
    match: (text) => parseYesNo(text),
    run: async (answer) => {
        const flow = flowOrNull('duplicate');
        if (flow == null) {
            return finished(i18n('juke.reply.cancel'));
        }
        if (answer.kind === 'restart' || answer.kind === 'other') {
            return { say: i18n('juke.reply.duplicate.children', flow.label) };
        }
        const includeChildren = answer.kind === 'yes';
        // Duplicates appear next to their originals in the tree, so leave the
        // filtered list first and expand the originals' parent afterwards.
        await leaveFilterMode();
        const { ok } = await runTask(
            duplicateContent(flow.items.map((item) => ({ contentId: item.getContentId(), includeChildren }))),
            i18n('action.duplicate'),
        );
        if (!ok) {
            return finished(i18n('juke.reply.action.failed'));
        }
        // Same toast the Duplicate dialog shows.
        const total = flow.items.length;
        showSuccess(
            total > 1
                ? i18n('dialog.duplicate.success.multiple', total)
                : i18n('dialog.duplicate.success.single', flow.items[0].getDisplayName()),
        );
        await expandInTree(flow.items[0].getPath().getParentPath());
        return finished(
            includeChildren
                ? i18n('juke.reply.duplicate.doneWith', flow.label)
                : i18n('juke.reply.duplicate.doneWithout', flow.label),
        );
    },
};

export const toolbarCommands: readonly JukeCommand[] = [
    toolbarCommand,
    confirmDeleteCommand,
    moveTargetCommand,
    duplicateChildrenCommand,
];
