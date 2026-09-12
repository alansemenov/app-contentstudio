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
    | 'duplicateChildren';

export type JukeContext = {
    mode: JukeMode;
    prompt: JukePrompt | null;
    userName: string;
};

export type JukeReply = {
    say: string;
    mode?: JukeMode;
    prompt?: JukePrompt | null;
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
