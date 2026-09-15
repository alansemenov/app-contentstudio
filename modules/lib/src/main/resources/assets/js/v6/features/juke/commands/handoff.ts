import { showWarning } from '@enonic/lib-admin-ui/notify/MessageBus';
import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import { UrlAction } from '../../../../app/UrlAction';
import { ContentUrlHelper } from '../../../../app/util/ContentUrlHelper';
import type { ContentEditParams } from '../../../../app/wizard/ContentEditParams';
import { openTabOrFocusExisting } from '../../../shared/lib/url/navigation';

//
// * Hand-over to the editor
//
// An edit tab opened by Juke carries a URL marker so the wizard starts its own
// Juke straight in dialog mode; the browse tab goes quiet until that tab closes.
//

export const JUKE_HANDOFF_PARAM = 'juke';

export function withJukeMarker(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}${JUKE_HANDOFF_PARAM}=1`;
}

export function readJukeMarker(search: string = window.location.search): boolean {
    return new URLSearchParams(search).get(JUKE_HANDOFF_PARAM) === '1';
}

// A tab that was already open was not started with the marker unless its URL
// carries it; a freshly opened tab is still blank.
function hasJuke(win: Window): boolean {
    try {
        return win.location.href === 'about:blank' || readJukeMarker(win.location.search);
    } catch {
        return false;
    }
}

// Opens (or focuses) the edit tab and returns it when it runs Juke, so the
// caller can hand the conversation over; null when nothing to hand over to.
export function openEditTabWithJuke(params: ContentEditParams): Window | null {
    const url = withJukeMarker(ContentUrlHelper.generateEditContentUrl(params));
    const name = `${UrlAction.EDIT}:${params.getProjectName()}:${params.getContentId().toString()}`;
    const win = openTabOrFocusExisting(url, name);
    if (win == null || win.closed) {
        showWarning(i18n('notify.popupBlocker.admin'), false);
        return null;
    }
    return hasJuke(win) ? win : null;
}
