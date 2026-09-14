import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import {
    $activeFlatNodes,
    $isFilterActive,
    collapseFilterNode,
    collapseNode,
    expandFilterNode,
    expandNode,
    fetchChildrenIdsOnly,
    fetchFilterChildrenIdsOnly,
    filterNodeNeedsChildrenLoad,
    nodeNeedsChildrenLoad,
} from '../../../entities/content';
import { type ContentData, isFlatTreeItemContentData } from '../../../entities/content/model/ContentData';
import type { FlatNode } from '../../../shared/lib/tree-store';
import type { JukeCommand } from './command.types';
import { bestUniqueMatch } from './matching';

//
// * Tree commands
//
// "Expand <name>" / "collapse <name>" act on an item that is already loaded and
// visible in the tree (main or filtered, whichever is shown). Pure client-side:
// only the tree store's expanded state changes; the tree's own lazy loading of
// children applies when a node is expanded for the first time.
//

export type TreeArgs = { action: 'expand' | 'collapse'; name: string };

const EXPAND_PATTERN = /^(?:expand|unfold|open up)\s+(?:the\s+)?(.+)$/;
const COLLAPSE_PATTERN = /^(?:collapse|fold|close)\s+(?:the\s+)?(.+)$/;

export function parseTreeCommand(text: string): TreeArgs | null {
    const expand = EXPAND_PATTERN.exec(text);
    if (expand) {
        return { action: 'expand', name: expand[1].trim() };
    }
    const collapse = COLLAPSE_PATTERN.exec(text);
    if (collapse) {
        return { action: 'collapse', name: collapse[1].trim() };
    }
    return null;
}

export type VisibleNode = FlatNode<ContentData> & { data: ContentData };

// Rows with loaded content data; loading placeholders and uploads are skipped.
export function getVisibleNodes(): VisibleNode[] {
    return $activeFlatNodes
        .get()
        .filter(isFlatTreeItemContentData)
        .filter((node): node is VisibleNode => node.data != null);
}

export function findVisibleNode(nodes: readonly VisibleNode[], spokenName: string) {
    return bestUniqueMatch(
        nodes.map((node) => ({ value: node, labels: [node.data.displayName, node.data.name] })),
        spokenName,
    );
}

function expand(id: string): void {
    if ($isFilterActive.get()) {
        expandFilterNode(id);
        if (filterNodeNeedsChildrenLoad(id)) {
            void fetchFilterChildrenIdsOnly(id).catch(() => undefined);
        }
        return;
    }
    expandNode(id);
    if (nodeNeedsChildrenLoad(id)) {
        void fetchChildrenIdsOnly(id).catch(() => undefined);
    }
}

function collapse(id: string): void {
    if ($isFilterActive.get()) {
        collapseFilterNode(id);
    } else {
        collapseNode(id);
    }
}

export const treeCommand: JukeCommand<TreeArgs> = {
    id: 'tree.toggle',
    modes: ['dialog'],
    prompts: [null],
    match: (text) => parseTreeCommand(text),
    run: ({ action, name }) => {
        const result = findVisibleNode(getVisibleNodes(), name);
        if (result.kind === 'none') {
            return { say: i18n('juke.reply.tree.notVisible', name) };
        }
        if (result.kind === 'ambiguous') {
            return { say: i18n('juke.reply.tree.ambiguous', name) };
        }

        const node = result.value;
        const displayName = node.data.displayName;
        if (!node.hasChildren) {
            return { say: i18n('juke.reply.tree.leaf', displayName) };
        }

        if (action === 'expand') {
            if (node.isExpanded) {
                return { say: i18n('juke.reply.tree.alreadyExpanded', displayName) };
            }
            expand(node.id);
            return { say: i18n('juke.reply.tree.expanding', displayName) };
        }

        if (!node.isExpanded) {
            return { say: i18n('juke.reply.tree.alreadyCollapsed', displayName) };
        }
        collapse(node.id);
        return { say: i18n('juke.reply.tree.collapsing', displayName) };
    },
};

export const treeCommands: readonly JukeCommand[] = [treeCommand];
