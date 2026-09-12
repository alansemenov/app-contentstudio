import type { ContentTypeSummary } from '@enonic/lib-admin-ui/schema/content/ContentTypeSummary';
import { atom } from 'nanostores';
import type { ContentSummary } from '../../../../app/content/ContentSummary';

//
// * Create flow
//
// State collected across the "create" dialog: the type is settled first, then
// the parent (undefined means the project root), then the name triggers creation.
//

export type CreateFlow = {
    type: ContentTypeSummary;
    parent?: ContentSummary;
};

export const $createFlow = atom<CreateFlow | null>(null);

export function startCreateFlow(type: ContentTypeSummary): void {
    $createFlow.set({ type });
}

export function setCreateFlowParent(parent: ContentSummary | undefined): void {
    const flow = $createFlow.get();
    if (flow == null) {
        return;
    }
    $createFlow.set({ ...flow, parent });
}

export function resetCreateFlow(): void {
    $createFlow.set(null);
}
