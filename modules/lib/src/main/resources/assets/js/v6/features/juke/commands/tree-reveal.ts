import type { ContentPath } from '../../../../app/content/ContentPath';
import { $isFilterActive, revealContentByPath } from '../../../entities/content';
import { resetContentFilter } from '../../../shared/app-state/contentFilter.store';

//
// * Showing results in the tree
//
// Actions that change the tree (create, move, duplicate) make their result
// visible: the filtered list hides the tree, so an active filter is cleared
// first, then the relevant parent is expanded without changing the selection.
//

export const FILTER_RESET_TIMEOUT_MS = 3000;

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

// Expands the path down to `path` and `path` itself; the root needs nothing.
export async function expandInTree(path: ContentPath): Promise<void> {
    if (path.isRoot()) {
        return;
    }
    await revealContentByPath(path.toString(), { select: false, expandTarget: true }).catch(() => undefined);
}
