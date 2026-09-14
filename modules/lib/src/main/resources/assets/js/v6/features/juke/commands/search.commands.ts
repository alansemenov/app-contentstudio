import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { fetchAllContentTypes } from '../../../entities/schema/api/contentTypes.api';
import { $config } from '../../../shared/config/config.store';
import { resetContentFilter, setContentFilterOpen } from '../../../shared/app-state/contentFilter.store';
import { resetActionFlow } from '../model/actionFlow.store';
import { resetCreateFlow } from '../model/createFlow.store';
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
// Filter criteria accumulate across utterances while the search prompt is open;
// keywords are replaced by each utterance. A search with no hits keeps the prompt
// open so the user can refine it, and "new search" restarts at any point.
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

// "new search", "start a new search", "let's do a new search", "search again", "another search",
// "reset the search", plus what recognition makes of it: "surge" for "search", "you"/"use"/"knew"/"and you"
// for "new", and "usage" for the whole phrase.
const START_PATTERN =
    /^(?:(?:lets|let us|please)\s+)?(?:(?:do|start|make|begin|run)\s+)?(?:a\s+|another\s+|and\s+)?(?:(?:new|you|use|knew|nu)\s+)?(?:search|surge)(?:\s+again)?$|^(?:reset|restart|clear)\s+(?:the\s+)?search$|^usage$/;

// Short aliases that recognition gets right more often than "new search". With
// criteria after the verb ("find posts modified today") the search runs at once.
const FIND_PATTERN = /^(?:find|look up|lookup|look for|search for)(?:\s+(.+))?$/;

export type SearchStartArgs = { criteria?: string };
export type SearchPanelArgs = { open: boolean };

// "hide search" / "show search" toggle the filter panel; the applied filter stays.
const PANEL_PATTERN =
    /^(?:(hide|close|collapse)|(show|open|expand))\s+(?:the\s+)?(?:search|filter|filters)(?:\s+panel)?$/;

export function parseSearchPanel(text: string): SearchPanelArgs | null {
    const match = PANEL_PATTERN.exec(text);
    return match ? { open: match[2] != null } : null;
}

export function parseSearchStart(text: string): SearchStartArgs | null {
    if (START_PATTERN.test(text)) {
        return {};
    }
    const find = FIND_PATTERN.exec(text);
    if (find) {
        return find[1] ? { criteria: find[1].trim() } : {};
    }
    return null;
}

const RESTART_PATTERN = /^(?:lets|let us)?\s*(?:try again|start over|start again|restart)$/;
const YES_PATTERN = /^(?:yes|yeah|yep|sure|please|ok|okay|show me|show them|yes please|show)$/;

// "last" is often heard as "life", "lost" or "less"; "modified" sometimes as "modify".
const LAST = '(?:last|lost|life|less|lust)';
const MODIFIED = 'modif(?:ied|y|ies)';
const CLAUSE_PATTERN = new RegExp(
    `\\b(content type|(?:${LAST}\\s+)?${MODIFIED}\\s+by|(?:${LAST}\\s+)?${MODIFIED}\\s+today|(?:${LAST}\\s+)?${MODIFIED}\\s+this week|in progress)\\b`,
    'g',
);

type ClauseKind = 'contentType' | 'modifiedBy' | 'modifiedToday' | 'modifiedThisWeek' | 'inProgress';

function clauseKind(keyword: string): ClauseKind {
    if (keyword === 'content type') return 'contentType';
    if (keyword === 'in progress') return 'inProgress';
    if (keyword.endsWith(' by')) return 'modifiedBy';
    if (keyword.endsWith(' today')) return 'modifiedToday';
    return 'modifiedThisWeek';
}

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

// An utterance with filter clauses is a filter command: words around the
// clauses are recognition noise ("life modified by me"), not keywords. Only a
// clause-free utterance is free text.
export function parseCriteria(text: string): ParsedCriteria {
    const parsed: ParsedCriteria = { keywords: [], contentTypes: [], modifiedBy: [], inProgress: false };
    const { leading, clauses } = splitClauses(text);
    if (clauses.length === 0) {
        if (leading.length > 0) {
            parsed.keywords.push(leading);
        }
        return parsed;
    }
    clauses.forEach(({ keyword, value }) => {
        switch (clauseKind(keyword)) {
            case 'contentType':
                if (value) parsed.contentTypes.push(value);
                break;
            case 'modifiedBy':
                if (value) parsed.modifiedBy.push(value);
                break;
            case 'modifiedToday':
                parsed.lastModified = 'day';
                break;
            case 'modifiedThisWeek':
                parsed.lastModified = 'week';
                break;
            case 'inProgress':
                parsed.inProgress = true;
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
    // Filters accumulate across utterances; free text is replaced by the latest
    // utterance's keywords, so a misheard phrase does not poison the search.
    const criteria: SearchCriteria = {
        ...base,
        keywords: parsed.keywords.length > 0 ? parsed.keywords : base.keywords,
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

    criteria.contentTypes = uniqueBy(criteria.contentTypes, (type) => type.key);
    criteria.modifiers = uniqueBy(criteria.modifiers, (modifier) => modifier.key);
    return { criteria };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const k = key(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

async function searchWith(parsed: ParsedCriteria): Promise<JukeReply> {
    const resolution = await resolveCriteria($searchFlow.get() ?? emptySearchCriteria(), parsed);
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
}

// Accepted in every prompt so "new search" always resets and starts afresh,
// whatever question was open.
export const searchStartCommand: JukeCommand<SearchStartArgs> = {
    id: 'search.start',
    modes: ['dialog'],
    match: (text) => parseSearchStart(text),
    run: async ({ criteria }) => {
        resetContentFilter();
        resetCreateFlow();
        resetActionFlow();
        startSearchFlow();
        if (criteria != null) {
            const reply = await searchWith(parseCriteria(criteria));
            return reply.prompt === undefined ? { ...reply, prompt: 'search' } : reply;
        }
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

        return searchWith(answer.parsed);
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
        const hits = criteria.hits ?? 0;
        return {
            say: hits === 1 ? i18n('juke.reply.search.showingOne') : i18n('juke.reply.search.showing', hits),
            prompt: null,
        };
    },
};

export const searchPanelCommand: JukeCommand<SearchPanelArgs> = {
    id: 'search.panel',
    modes: ['dialog'],
    prompts: [null, 'search', 'showResults'],
    match: (text) => parseSearchPanel(text),
    run: ({ open }) => {
        setContentFilterOpen(open);
        return { say: i18n(open ? 'juke.reply.search.panelShown' : 'juke.reply.search.panelHidden') };
    },
};

export const searchCommands: readonly JukeCommand[] = [searchStartCommand, searchPanelCommand];

// Registered after every other command: inside a search, anything that is not a
// recognizable command is free text.
export const searchPromptCommands: readonly JukeCommand[] = [searchCriteriaCommand, searchShowCommand];
