//
// * Cross-tab channel
//
// Juke runs in several tabs but is meant to feel like one assistant, and the
// microphone in one tab hears what Juke says in another. Tabs tell each other
// what is being said so a reply spoken in the browse tab is filtered as echo in
// the editor tab it hands over to.
//

export type JukeChannelMessage =
    // A tab that has just started asks what is going on.
    | { kind: 'sync' }
    // The answer: whether the tab is speaking and its last replies.
    | { kind: 'state'; speaking: boolean; recent: string[] }
    // A reply has just been spoken to the end.
    | { kind: 'spoken'; text: string };

export type JukeChannel = {
    post(message: JukeChannelMessage): void;
    onMessage(handler: (message: JukeChannelMessage) => void): void;
    close(): void;
};

export const JUKE_CHANNEL_NAME = 'juke';

export function createChannel(): JukeChannel | null {
    if (typeof BroadcastChannel === 'undefined') {
        return null;
    }
    const channel = new BroadcastChannel(JUKE_CHANNEL_NAME);
    return {
        post: (message) => channel.postMessage(message),
        onMessage: (handler) => {
            channel.onmessage = (event: MessageEvent<JukeChannelMessage>) => handler(event.data);
        },
        close: () => channel.close(),
    };
}
