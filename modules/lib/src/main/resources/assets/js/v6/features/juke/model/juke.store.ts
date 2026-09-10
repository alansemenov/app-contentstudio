import { atom, computed } from 'nanostores';
import { $config } from '../../../shared/config/config.store';
import type { JukeContext, JukeMode, JukePrompt } from '../commands/command.types';
import { isSpeechSupported } from '../speech/support';

//
// * Juke state
//
// off    - not listening (operator missing, unsupported browser, microphone denied)
// idle   - listening for the wake phrase only; no icon
// dialog - icon visible; commands accepted
//

export type JukeActivity = 'listening' | 'speaking';

export const $jukeMode = atom<JukeMode>('off');

export const $jukeActivity = atom<JukeActivity>('listening');

export const $jukePrompt = atom<JukePrompt | null>(null);

// Last recognized phrase, normalized. Diagnostic; not used for matching.
export const $jukeTranscript = atom<string>('');

export const $jukeSpeechSupported = atom<boolean>(isSpeechSupported());

// Juke may run only in the browse view, only when the Juke Operator app is
// installed and started, and only where the browser exposes both recognition
// and synthesis. On the browse page the server sets `aiEnabled` from the
// operator's running state alone (the translator counts only in the wizard).
export const $jukeAvailable = computed(
    [$config, $jukeSpeechSupported],
    (config, supported): boolean => supported && config.browseMode && config.aiEnabled,
);

export const $isJukeVisible = computed($jukeMode, (mode) => mode === 'dialog');

export function setJukeMode(mode: JukeMode): void {
    $jukeMode.set(mode);
}

export function setJukeActivity(activity: JukeActivity): void {
    $jukeActivity.set(activity);
}

export function setJukePrompt(prompt: JukePrompt | null): void {
    $jukePrompt.set(prompt);
}

export function setJukeTranscript(transcript: string): void {
    $jukeTranscript.set(transcript);
}

export function getJukeUserName(): string {
    return $config.get().user?.getDisplayName() ?? '';
}

export function getJukeContext(): JukeContext {
    return {
        mode: $jukeMode.get(),
        prompt: $jukePrompt.get(),
        userName: getJukeUserName(),
    };
}

export function resetJukeState(): void {
    $jukeMode.set('off');
    $jukeActivity.set('listening');
    $jukePrompt.set(null);
    $jukeTranscript.set('');
}
