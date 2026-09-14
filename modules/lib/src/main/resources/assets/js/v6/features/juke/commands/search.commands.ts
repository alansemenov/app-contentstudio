import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { fetchAllContentTypes } from '../../../entities/schema/api/contentTypes.api';
import { $config } from '../../../shared/config/config.store';
import { resetContentFilter } from '../../../shared/app-state/contentFilter.store';
import {
    $searchFlow,
    emptySearchCriteria,
    resetSearchFlow,
    startSearchFlow,
    updateSearchFlow,
    type LastModifiedRange,
    type SearchCriteria,
} from '../model/searchFlow.store';
import type { JukeCommand, JukeReply } from './command.types';
import { findContentType } from './content.commands';
import { bestUniqueMatch } from './matching';
import { applySearchToFilterPanel, runSearch, type ModifierCandidate } from './search-query';

//
// * Search dialog
//
//   User: "New search"                        -> filter reset, prompt: search
//   Juke: "What are you looking for?"
//   User: "content type post last modified this week in progress summer"
//   Juke: "I found 3 content items matching your criteria. Do you want to see them?"   (prompt: showResults)
//   User: "Yes"                                -> filter panel opened and filled in
//
// Criteria accumulate across utterances while the search prompt is open. A
// search with no hits keeps the prompt open so the user can refine it.
//

export type ParsedCriteria = {
    keywords: string[];
    contentTypes: string[];
    modifiedBy: string[];
    lastModified?: LastModifiedRange;
    inProgress: boolean;
};

export type SearchAnswer = { kind: 'restart' } | { kind: 'criteria'; parsed: ParsedCriteria };
export type ShowAnswer = { kind: 'yes' } | { kind: 'no' };

const START_PATTERN = /^(?:(?:start\s+)?(?:a\s+)?new\s+search|start\s+(?:a\s+)?search|search)$/;
const RESTART_PATTERN = /^(?:lets|let us)?\s*(?:try again|start over|start again|restart)$/;
const YES_PATTERN = /^(?:yes|yeah|yep|sure|please|ok|okay|show me|show them|yes please|show)$/;

const CLAUSE_PATTERN =
    /\b(content type|last modified by|modified by|last modified today|modified today|last modified this week|modified this week|in progress)\b/g;

type Clause = { keyword: string; value: string };

function splitClauses(text: string): { leading: string; clauses: Clause[] } {
    const matches = [...text.matchAll(CLAUSE_PATTERN)];
    if (matches.length === 0) {
        return { leading: text, clauses: [] };
    }
    const leading = text.slice(0, matches[0].index).trim();
    const clauses = matches.map((match, i) => {
        const start = match.index + match[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        return { keyword: match[1], value: text.slice(start, end).trim() };
    });
    return { leading, clauses };
}

export function parseCriteria(text: string): ParsedCriteria {
    const parsed: ParsedCriteria = { keywords: [], contentTypes: [], modifiedBy: [], inProgress: false };
    const { leading, clauses } = splitClauses(text);
    if (leading.length > 0) {
        parsed.keywords.push(leading);
    }
    clauses.forEach(({ keyword, value }) => {
        switch (keyword) {
            case 'content type':
                if (value) parsed.contentTypes.push(value);
                break;
            case 'last modified by':
            case 'modified by':
                if (value) parsed.modifiedBy.push(value);
                break;
            case 'last modified today':
            case 'modified today':
                parsed.lastModified = 'day';
                if (value) parsed.keywords.push(value);
                break;
            case 'last modified this week':
            case 'modified this week':
                parsed.lastModified = 'week';
                if (value) parsed.keywords.push(value);
                break;
            case 'in progress':
                parsed.inProgress = true;
                if (value) parsed.keywords.push(value);
                break;
        }
    });
    return parsed;
}

export function parseSearchAnswer(text: string): SearchAnswer {
    if (RESTART_PATTERN.test(text)) return { kind: 'restart' };
    return { kind: 'criteria', parsed: parseCriteria(text) };
}

export function parseShowAnswer(text: string): ShowAnswer {
    return YES_PATTERN.test(text) ? { kind: 'yes' } : { kind: 'no' };
}

export function findModifier(candidates: readonly ModifierCandidate[], spokenName: string): ModifierCandidate | null {
    const result = bestUniqueMatch(
        candidates.map((candidate) => ({ value: candidate, labels: [candidate.displayName] })),
        spokenName,
    );
    return result.kind === 'match' ? result.value : null;
}

function currentUser(): ModifierCandidate | null {
    const user = $config.get().user;
    return user ? { key: user.getKey().toString(), displayName: user.getDisplayName() } : null;
}

type Resolution = { criteria: SearchCriteria } | { reply: JukeReply };

async function resolveCriteria(base: SearchCriteria, parsed: ParsedCriteria): Promise<Resolution> {
    const criteria: SearchCriteria = {
        ...base,
        keywords: [...base.keywords, ...parsed.keywords],
        contentTypes: [...base.contentTypes],
        modifiers: [...base.modifiers],
        lastModified: parsed.lastModified ?? base.lastModified,
        inProgress: base.inProgress || parsed.inProgress,
        hits: undefined,
    };

    if (parsed.contentTypes.length > 0) {
        const types = await fetchAllContentTypes();
        if (types.isErr()) {
            throw types.error;
        }
        for (const spoken of parsed.contentTypes) {
            const type = findContentType(types.value, spoken);
            if (type == null) {
                return { reply: { say: i18n('juke.reply.search.typeNotFound', spoken) } };
            }
            criteria.contentTypes.push({ key: type.getContentTypeName().toString(), title: type.getTitle() });
        }
    }

    const byOthers = parsed.modifiedBy.filter((name) => name !== 'me');
    if (parsed.modifiedBy.includes('me')) {
        const me = currentUser();
        if (me != null) {
            criteria.modifiers.push(me);
        }
    }
    if (byOthers.length > 0) {
        // Candidates come from the modifier buckets of the search without a modifier constraint.
        const { modifierCandidates } = await runSearch({ ...criteria, modifiers: [] });
        for (const spoken of byOthers) {
            const modifier = findModifier(modifierCandidates, spoken);
            if (modifier == null) {
                return { reply: { say: i18n('juke.reply.search.userNotFound', spoken) } };
            }
            criteria.modifiers.push(modifier);
        }
    }

    return { criteria };
}

export const searchStartCommand: JukeCommand<true> = {
    id: 'search.start',
    modes: ['dialog'],
    prompts: [null],
    match: (text) => (START_PATTERN.test(text) ? true : null),
    run: () => {
        resetContentFilter();
        startSearchFlow();
        return { say: i18n('juke.reply.search.start'), prompt: 'search' };
    },
};

export const searchCriteriaCommand: JukeCommand<SearchAnswer> = {
    id: 'search.criteria',
    modes: ['dialog'],
    prompts: ['search'],
    match: (text) => parseSearchAnswer(text),
    run: async (answer) => {
        if (answer.kind === 'restart') {
            resetContentFilter();
            startSearchFlow();
            return { say: i18n('juke.reply.search.start'), prompt: 'search' };
        }

        const resolution = await resolveCriteria($searchFlow.get() ?? emptySearchCriteria(), answer.parsed);
        if ('reply' in resolution) {
            return resolution.reply;
        }

        const { hits } = await runSearch(resolution.criteria);
        console.info('[juke] search', JSON.stringify(resolution.criteria), '-> hits', hits);
        updateSearchFlow({ ...resolution.criteria, hits });
        if (hits === 0) {
            return { say: i18n('juke.reply.search.none') };
        }
        return { say: i18n('juke.reply.search.found', hits), prompt: 'showResults' };
    },
};

export const searchShowCommand: JukeCommand<ShowAnswer> = {
    id: 'search.show',
    modes: ['dialog'],
    prompts: ['showResults'],
    match: (text) => parseShowAnswer(text),
    run: (answer) => {
        const criteria = $searchFlow.get();
        resetSearchFlow();
        if (answer.kind !== 'yes' || criteria == null) {
            return { say: i18n('juke.reply.search.dismissed'), prompt: null };
        }
        applySearchToFilterPanel(criteria);
        return { say: i18n('juke.reply.search.showing', criteria.hits ?? 0), prompt: null };
    },
};

export const searchCommands: readonly JukeCommand[] = [searchStartCommand, searchCriteriaCommand, searchShowCommand];
