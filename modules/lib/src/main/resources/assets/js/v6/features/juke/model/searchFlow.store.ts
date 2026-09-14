import { atom } from 'nanostores';

//
// * Search flow
//
// Criteria collected during the "new search" dialog. Content types and
// modifiers are stored as the keys the filter panel expects (content type
// name, principal key) together with the names Juke uses in replies.
//

export type LastModifiedRange = 'day' | 'week';

export type SearchCriteria = {
    keywords: string[];
    contentTypes: { key: string; title: string }[];
    modifiers: { key: string; displayName: string }[];
    lastModified?: LastModifiedRange;
    inProgress: boolean;
    hits?: number;
};

export const emptySearchCriteria = (): SearchCriteria => ({
    keywords: [],
    contentTypes: [],
    modifiers: [],
    inProgress: false,
});

export const $searchFlow = atom<SearchCriteria | null>(null);

export function startSearchFlow(): void {
    $searchFlow.set(emptySearchCriteria());
}

export function updateSearchFlow(criteria: SearchCriteria): void {
    $searchFlow.set(criteria);
}

export function resetSearchFlow(): void {
    $searchFlow.set(null);
}
