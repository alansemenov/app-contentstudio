//
// * Web Speech API access
//
// TypeScript's DOM lib ships the result/error event types but not the
// `SpeechRecognition` interface itself, so a minimal shape is declared here.
//

export type JukeRecognitionResultEvent = {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
};

export type JukeRecognitionErrorEvent = {
    readonly error: string;
};

export type JukeRecognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: JukeRecognitionResultEvent) => void) | null;
    onerror: ((event: JukeRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
};

export type JukeRecognitionCtor = new () => JukeRecognition;

type SpeechWindow = Window & {
    SpeechRecognition?: JukeRecognitionCtor;
    webkitSpeechRecognition?: JukeRecognitionCtor;
};

export function getRecognitionCtor(): JukeRecognitionCtor | null {
    if (typeof window === 'undefined') {
        return null;
    }
    const speechWindow = window as SpeechWindow;
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function getSynthesis(): SpeechSynthesis | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return null;
    }
    return window.speechSynthesis ?? null;
}

export function isSpeechSupported(): boolean {
    return getRecognitionCtor() != null && getSynthesis() != null;
}
