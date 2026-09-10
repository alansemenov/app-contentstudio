import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { JukeCommand, JukeContext } from './command.types';

//
// * Small talk
//
// Conversational phrases Juke answers in dialog mode. Each entry pairs a
// pattern over the normalized transcript with a phrase key; the user's name is
// always passed as {0}.
//

type SmallTalkEntry = {
    id: string;
    pattern: RegExp;
    phraseKey: string;
};

const SMALL_TALK: readonly SmallTalkEntry[] = [
    {
        id: 'smalltalk.howAreYou',
        pattern: /\b(how are you|how are you doing|how do you do|how is it going|hows it going|how are things)\b/,
        phraseKey: 'juke.reply.smalltalk.howAreYou',
    },
    {
        id: 'smalltalk.help',
        pattern:
            /\b(help me|i need help|i need some help|i would like some help|id like some help|i want some help|can you help|could you help|will you help|please help)\b/,
        phraseKey: 'juke.reply.smalltalk.help',
    },
    {
        id: 'smalltalk.capabilities',
        pattern: /\b(what can you do|what do you do|what are you able to do|what can i ask you|what can i say)\b/,
        phraseKey: 'juke.reply.smalltalk.capabilities',
    },
    {
        id: 'smalltalk.whoAreYou',
        pattern: /\b(who are you|what is your name|whats your name|what are you)\b/,
        phraseKey: 'juke.reply.smalltalk.whoAreYou',
    },
    {
        id: 'smalltalk.thanks',
        pattern: /\b(thank you|thanks|thank you very much|thanks a lot|cheers)\b/,
        phraseKey: 'juke.reply.smalltalk.thanks',
    },
    {
        id: 'smalltalk.niceToMeetYou',
        pattern: /\b(nice to meet you|pleased to meet you|good to meet you)\b/,
        phraseKey: 'juke.reply.smalltalk.niceToMeetYou',
    },
    {
        id: 'smalltalk.goodMorning',
        pattern: /\bgood morning\b/,
        phraseKey: 'juke.reply.smalltalk.goodMorning',
    },
    {
        id: 'smalltalk.goodAfternoon',
        pattern: /\bgood afternoon\b/,
        phraseKey: 'juke.reply.smalltalk.goodAfternoon',
    },
    {
        id: 'smalltalk.goodEvening',
        pattern: /\bgood evening\b/,
        phraseKey: 'juke.reply.smalltalk.goodEvening',
    },
    {
        id: 'smalltalk.greeting',
        pattern: /^(hello|hi|hey|hi there|hello there|hey there)$/,
        phraseKey: 'juke.reply.smalltalk.greeting',
    },
];

function toCommand(entry: SmallTalkEntry): JukeCommand<true> {
    return {
        id: entry.id,
        modes: ['dialog'],
        match: (text: string) => (entry.pattern.test(text) ? true : null),
        run: (_args: true, context: JukeContext) => ({ say: i18n(entry.phraseKey, context.userName) }),
    };
}

export const smallTalkCommands: readonly JukeCommand[] = SMALL_TALK.map(toCommand);
