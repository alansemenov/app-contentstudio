import { AggregationSelection } from '@enonic/lib-admin-ui/aggregation/AggregationSelection';
import { Bucket } from '@enonic/lib-admin-ui/aggregation/Bucket';
import type { BucketAggregation } from '@enonic/lib-admin-ui/aggregation/BucketAggregation';
import { DateRangeBucket } from '@enonic/lib-admin-ui/aggregation/DateRangeBucket';
import { SearchInputValues } from '@enonic/lib-admin-ui/query/SearchInputValues';
import { PrincipalKey } from '@enonic/lib-admin-ui/security/PrincipalKey';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { ContentAggregation } from '../../../../app/browse/filter/ContentAggregation';
import { ContentAggregationsFetcher } from '../../../../app/browse/filter/ContentAggregationsFetcher';
import { WorkflowState } from '../../../../app/content/WorkflowState';
import { getPrincipalsByKeys } from '../../../entities/principal';
import {
    setContentFilterOpen,
    setContentFilterSelection,
    setContentFilterValue,
} from '../../../shared/app-state/contentFilter.store';
import type { LastModifiedRange, SearchCriteria } from '../model/searchFlow.store';

//
// * Search criteria -> filter panel
//
// Juke's criteria become exactly the `SearchInputValues` the browse filter panel
// builds from its own state, so the hit count Juke announces (from the same
// aggregation request the panel sends) equals what the panel shows once applied.
//

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type ModifierCandidate = { key: string; displayName: string };

export type SearchRun = {
    hits: number;
    modifierCandidates: ModifierCandidate[];
};

function lastModifiedBucket(range: LastModifiedRange, now: number): DateRangeBucket {
    const isDay = range === 'day';
    // The panel's buckets carry the server's ISO strings, and the range filter
    // serializes `from` with toString(), so a real Date would produce a locale
    // string the server rejects. Mirror the server shape: an ISO string.
    const from = new Date(now - (isDay ? DAY_MS : WEEK_MS)).toISOString() as unknown as Date;
    return DateRangeBucket.fromDateRangeJson({
        key: i18n(isDay ? 'field.lastModified.lessDay' : 'field.lastModified.lessWeek'),
        docCount: 0,
        from,
        to: null,
    });
}

function selection(name: string, buckets: Bucket[]): AggregationSelection {
    const aggregationSelection = new AggregationSelection(name);
    aggregationSelection.setValues(buckets);
    return aggregationSelection;
}

export function buildAggregationSelections(criteria: SearchCriteria, now = Date.now()): AggregationSelection[] {
    const selections: AggregationSelection[] = [];
    if (criteria.contentTypes.length > 0) {
        selections.push(
            selection(
                ContentAggregation.CONTENT_TYPE,
                criteria.contentTypes.map((type) => new Bucket(type.key, 0)),
            ),
        );
    }
    if (criteria.modifiers.length > 0) {
        selections.push(
            selection(
                ContentAggregation.MODIFIED_BY,
                criteria.modifiers.map((modifier) => new Bucket(modifier.key, 0)),
            ),
        );
    }
    if (criteria.lastModified != null) {
        selections.push(selection(ContentAggregation.LAST_MODIFIED, [lastModifiedBucket(criteria.lastModified, now)]));
    }
    if (criteria.inProgress) {
        selections.push(selection(ContentAggregation.WORKFLOW, [new Bucket(WorkflowState.IN_PROGRESS, 0)]));
    }
    return selections;
}

export function buildSearchText(criteria: SearchCriteria): string {
    return criteria.keywords.join(' ').trim();
}

export function buildSearchInputValues(criteria: SearchCriteria): SearchInputValues {
    const values = new SearchInputValues();
    values.setTextSearchFieldValue(buildSearchText(criteria));
    values.setAggregationSelections(buildAggregationSelections(criteria));
    return values;
}

async function resolveModifierCandidates(aggregations: readonly { getName(): string }[]): Promise<ModifierCandidate[]> {
    const modifierAggregation = aggregations.find(
        (aggregation) => aggregation.getName() === ContentAggregation.MODIFIED_BY.toString(),
    ) as BucketAggregation | undefined;
    const keys = modifierAggregation?.getBuckets().map((bucket) => bucket.getKey()) ?? [];
    if (keys.length === 0) {
        return [];
    }
    const principals = await getPrincipalsByKeys(keys.map((key) => PrincipalKey.fromString(key)));
    if (principals.isErr()) {
        return keys.map((key) => ({ key, displayName: key }));
    }
    return keys.map((key) => {
        const principal = principals.value.find((candidate) => candidate.getKey().toString() === key);
        return { key, displayName: principal?.getDisplayName() ?? key };
    });
}

// Runs the panel's aggregation request for the criteria: the total is the hit
// count, and the modifier buckets are the users Juke can match a name against.
export async function runSearch(criteria: SearchCriteria): Promise<SearchRun> {
    const result = await new ContentAggregationsFetcher()
        .setSearchInputValues(buildSearchInputValues(criteria))
        .getAggregations();
    return {
        hits: result.getMetadata().getTotalHits(),
        modifierCandidates: await resolveModifierCandidates(result.getAggregations()),
    };
}

export function applySearchToFilterPanel(criteria: SearchCriteria): void {
    setContentFilterOpen(true);
    setContentFilterValue(buildSearchText(criteria));
    setContentFilterSelection(buildAggregationSelections(criteria));
}
