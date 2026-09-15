import { atom } from 'nanostores';

//
// * Editor bridge
//
// What Juke needs from the content wizard while running in an editor tab. The
// wizard lives in the pages layer and the legacy panel, both out of reach for a
// feature, so the app root injects this small interface at wizard startup.
//

export type JukeEditorBridge = {
    hasUnsavedChanges(): boolean;
    // Resolves when the wizard has saved; rejects when saving failed.
    save(): Promise<void>;
    // Closes the tab without the browser's unsaved-changes prompt.
    close(): void;
};

export const $editorBridge = atom<JukeEditorBridge | null>(null);

export function setJukeEditorBridge(bridge: JukeEditorBridge | null): void {
    $editorBridge.set(bridge);
}

export function getJukeEditorBridge(): JukeEditorBridge | null {
    return $editorBridge.get();
}
