import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { ContentSummary } from '../../../../app/content/ContentSummary';
import { getContent, getCurrentItems } from '../../../entities/content';
import type { JukeReply } from './command.types';
import { findContentByName, spokenName } from './content-lookup';
import { bestUniqueMatch } from './matching';
import { getVisibleNodes } from './tree.commands';

//
// * Spoken target
//
// What a toolbar action applies to: a position in the list as displayed, a
// name (visible rows first, then the whole project), the current selection,
// or every visible row.
//

export type TargetSpec =
    | { kind: 'position'; index: number; fromBottom: boolean }
    | { kind: 'name'; name: string }
    | { kind: 'implicit' }
    | { kind: 'all' };

export type TargetResolution =
    | { kind: 'items'; items: ContentSummary[]; label: string }
    | { kind: 'reply'; reply: JukeReply };

const ORDINALS: Record<string, number> = {
    first: 1,
    top: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
};

const IMPLICIT_PATTERN =
    /^(?:it|them|this|that|this one|that one|these|those|(?:the\s+)?(?:selected(?:\s+(?:one|ones|items?))?|selection|current(?:\s+(?:one|item))?))?$/;
const ALL_PATTERN = /^(?:all|everything|all of them|all items|all the items)$/;
const POSITION_PATTERN =
    /^(?:the\s+)?(?:(last|bottom)|(first|top|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|(?:number\s+)?(\d+)(?:st|nd|rd|th)?)(?:\s+(?:one|item|row))?(?:\s+from\s+(?:the\s+)?(top|bottom))?$/;

export function parseTarget(text: string): TargetSpec {
    const target = text.trim();
    if (IMPLICIT_PATTERN.test(target)) {
        return { kind: 'implicit' };
    }
    if (ALL_PATTERN.test(target)) {
        return { kind: 'all' };
    }
    const position = POSITION_PATTERN.exec(target);
    if (position) {
        const [, last, ordinal, digits, from] = position;
        if (last) {
            return { kind: 'position', index: 1, fromBottom: true };
        }
        const index = ordinal ? ORDINALS[ordinal] : Number(digits);
        return { kind: 'position', index, fromBottom: from === 'bottom' };
    }
    return { kind: 'name', name: target };
}

function visibleItems(): ContentSummary[] {
    return getVisibleNodes()
        .map((node) => node.data.item ?? getContent(node.id))
        .filter((item): item is ContentSummary => item != null);
}

export function labelFor(items: readonly ContentSummary[]): string {
    return items.length === 1 ? items[0].getDisplayName() : i18n('juke.reply.target.items', items.length);
}

const items = (list: ContentSummary[]): TargetResolution => ({ kind: 'items', items: list, label: labelFor(list) });
const reply = (say: string): TargetResolution => ({ kind: 'reply', reply: { say } });

async function resolveOne(spec: TargetSpec): Promise<TargetResolution> {
    switch (spec.kind) {
        case 'implicit': {
            const current = [...getCurrentItems()];
            if (current.length > 0) {
                return items(current);
            }
            // With a single row on screen "it" can only mean that row.
            const visible = visibleItems();
            return visible.length === 1 ? items(visible) : reply(i18n('juke.reply.target.noSelection'));
        }
        case 'all': {
            const visible = visibleItems();
            return visible.length > 0 ? items(visible) : reply(i18n('juke.reply.target.outOfRange', 0));
        }
        case 'position': {
            const visible = visibleItems();
            const index = spec.fromBottom ? visible.length - spec.index : spec.index - 1;
            const item = visible[index];
            return item != null && spec.index > 0
                ? items([item])
                : reply(i18n('juke.reply.target.outOfRange', visible.length));
        }
        case 'name': {
            const nodes = getVisibleNodes();
            const visible = bestUniqueMatch(
                nodes.map((node) => ({ value: node, labels: [node.data.displayName, node.data.name] })),
                spec.name,
            );
            if (visible.kind === 'match') {
                const item = visible.value.data.item ?? getContent(visible.value.id);
                if (item != null) {
                    return { kind: 'items', items: [item], label: spokenName(item, visible.labelIndex) };
                }
            }
            if (visible.kind === 'ambiguous') {
                return reply(i18n('juke.reply.target.ambiguous', spec.name));
            }
            const anywhere = await findContentByName(spec.name);
            if (anywhere.kind === 'match') {
                return {
                    kind: 'items',
                    items: [anywhere.value],
                    label: spokenName(anywhere.value, anywhere.labelIndex),
                };
            }
            if (anywhere.kind === 'ambiguous') {
                return reply(i18n('juke.reply.target.ambiguous', spec.name));
            }
            return reply(i18n('juke.reply.target.notFound', spec.name));
        }
    }
}

// Tries each spec (one per recognition alternative, best first) until one
// yields items; otherwise answers with the first spec's failure reply.
export async function resolveTarget(specs: readonly TargetSpec[]): Promise<TargetResolution> {
    let first: TargetResolution | null = null;
    for (const spec of specs) {
        const resolution = await resolveOne(spec);
        if (resolution.kind === 'items') {
            return resolution;
        }
        first ??= resolution;
    }
    return first ?? reply(i18n('juke.reply.target.noSelection'));
}
