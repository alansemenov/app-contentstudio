import type { JukeCommand, JukeContext } from './command.types';

//
// * Command registry
//
// Ordered: earlier commands win. Session commands (hello/goodbye) register
// first so they take precedence over any pending prompt.
//

const commands: JukeCommand[] = [];

export type ResolvedCommand = {
    command: JukeCommand;
    args: unknown;
};

export function registerCommands(...toRegister: JukeCommand[]): void {
    toRegister.forEach((command) => {
        const index = commands.findIndex((existing) => existing.id === command.id);
        if (index >= 0) {
            commands[index] = command;
        } else {
            commands.push(command);
        }
    });
}

export function clearCommands(): void {
    commands.length = 0;
}

export function getCommands(): readonly JukeCommand[] {
    return commands;
}

// Tries each command against every transcript alternative, best alternative
// first, and returns the first match.
export function resolveCommand(alternatives: readonly string[], context: JukeContext): ResolvedCommand | null {
    for (const command of commands) {
        if (!command.modes.includes(context.mode)) {
            continue;
        }
        if (command.prompts != null && !command.prompts.includes(context.prompt)) {
            continue;
        }
        for (const text of alternatives) {
            const args = command.match(text, context);
            if (args != null) {
                return { command, args };
            }
        }
    }
    return null;
}
