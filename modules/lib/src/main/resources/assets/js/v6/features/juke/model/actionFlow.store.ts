import { atom } from 'nanostores';
import type { ContentSummary } from '../../../../app/content/ContentSummary';

//
// * Action flow
//
// The items a toolbar action was asked to work on while Juke waits for the
// user's answer to its follow-up question (confirm delete, move destination,
// duplicate children).
//

export type ActionKind = 'delete' | 'move' | 'duplicate';

export type ActionFlow = {
    action: ActionKind;
    items: ContentSummary[];
    // Display name of a single item, or "<n> items".
    label: string;
};

export const $actionFlow = atom<ActionFlow | null>(null);

export function startActionFlow(flow: ActionFlow): void {
    $actionFlow.set(flow);
}

export function resetActionFlow(): void {
    $actionFlow.set(null);
}
