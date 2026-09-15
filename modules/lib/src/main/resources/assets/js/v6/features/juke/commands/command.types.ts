//
// * Voice command contract
//
// A command matches a normalized transcript in a given mode (and, later, in a
// given pending prompt) and runs an editorial action, answering with a reply
// that Juke speaks. Mode and prompt changes carried by the reply are applied
// after the reply has been spoken.
//

export type JukeMode = 'off' | 'idle' | 'dialog';

export type JukePrompt =
    | 'createParent'
    | 'createName'
    | 'search'
    | 'showResults'
    | 'confirmDelete'
    | 'moveTarget'
    | 'duplicateChildren'
    | 'closeTab';

export type JukeContext = {
    mode: JukeMode;
    prompt: JukePrompt | null;
    userName: string;
    // Every recognition alternative for the utterance, best first, normalized.
    // Commands that look a name up should try each until one resolves, since
    // the alternative that matched the pattern may carry a misheard name.
    alternatives?: readonly string[];
};

// The tab Juke hands the conversation over to; only its closed state is read.
export type JukeHandoff = Pick<Window, 'closed'>;

export type JukeReply = {
    say: string;
    mode?: JukeMode;
    prompt?: JukePrompt | null;
    // Runs once the reply has been spoken, for actions that would cut the
    // speech off (closing the tab). May answer with a follow-up reply. Not
    // named "then" so a reply is never mistaken for a thenable.
    after?: () => Promise<JukeReply | undefined> | JukeReply | undefined;
    // Hands the conversation over to another tab: this tab's Juke goes quiet
    // after the reply and resumes when that tab is closed.
    handoff?: JukeHandoff;
};

export type JukeCommand<Args = unknown> = {
    id: string;
    // Modes in which the command is recognized.
    modes: readonly JukeMode[];
    // Pending prompts in which the command is recognized; omitted means any.
    prompts?: readonly (JukePrompt | null)[];
    match(text: string, context: JukeContext): Args | null;
    run(args: Args, context: JukeContext): Promise<JukeReply | null> | JukeReply | null;
};
