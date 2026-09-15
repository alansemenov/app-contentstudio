import type { ContentPath } from '../../../../app/content/ContentPath';
import { $isFilterActive, revealContentByPath } from '../../../entities/content';
import { resetContentFilter } from '../../../shared/app-state/contentFilter.store';
import { $contentMoved } from '../../../shared/socket/socket.store';

//
// * Showing results in the tree
//
// Actions that change the tree (create, move, duplicate) make their result
// visible: the filtered list hides the tree, so an active filter is cleared
// first, then the relevant parent is expanded without changing the selection.
//

export const FILTER_RESET_TIMEOUT_MS = 3000;
export const MOVE_EVENT_TIMEOUT_MS = 3000;

export async function leaveFilterMode(): Promise<void> {
    if (!$isFilterActive.get()) {
        return;
    }
    resetContentFilter();
    await new Promise<void>((resolve) => {
        const timer = setTimeout(done, FILTER_RESET_TIMEOUT_MS);
        const unsubscribe = $isFilterActive.subscribe((active) => {
            if (!active) done();
        });
        function done(): void {
            clearTimeout(timer);
            unsubscribe();
            resolve();
        }
    });
}

// The server reports a move over the socket a moment after the move task has
// finished, and the tree rebuilds both parents from that report. Expanding the
// destination before the report arrives is undone by it (the item stays where
// it was and the destination collapses again), so callers wait for the report
// of every moved item since `since` first, or give up after a while.
export function waitForMovedEvent(ids: readonly string[], since: number): Promise<void> {
    const pending = new Set(ids);
    return new Promise<void>((resolve) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;
        const timer = setTimeout(done, MOVE_EVENT_TIMEOUT_MS);
        // The store replays the last report on subscribe, so this may settle at once.
        unsubscribe = $contentMoved.subscribe((event) => {
            if (event == null || event.timestamp < since) return;
            for (const moved of event.data) {
                pending.delete(moved.item.getContentSummary().getId());
            }
            if (pending.size === 0) done();
        });
        if (settled) unsubscribe();
        function done(): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe?.();
            resolve();
        }
    });
}

// Expands the path down to `path` and `path` itself; the root needs nothing.
export async function expandInTree(path: ContentPath): Promise<void> {
    if (path.isRoot()) {
        return;
    }
    await revealContentByPath(path.toString(), { select: false, expandTarget: true }).catch(() => undefined);
}
