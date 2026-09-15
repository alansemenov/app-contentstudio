import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentEditParams } from '../../../../app/wizard/ContentEditParams';
import { openEditTabWithJuke, readJukeMarker, withJukeMarker } from './handoff';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        generateEditContentUrl: vi.fn(),
        openTabOrFocusExisting: vi.fn(),
        showWarning: vi.fn(),
    },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('@enonic/lib-admin-ui/notify/MessageBus', () => ({
    showWarning: mocks.showWarning,
}));

vi.mock('../../../../app/util/ContentUrlHelper', () => ({
    ContentUrlHelper: { generateEditContentUrl: mocks.generateEditContentUrl },
}));

vi.mock('../../../shared/lib/url/navigation', () => ({
    openTabOrFocusExisting: mocks.openTabOrFocusExisting,
}));

const params = {
    getProjectName: () => 'superhero',
    getContentId: () => ({ toString: () => 'c1' }),
} as unknown as ContentEditParams;

const tab = (href: string, closed = false): Window => ({ closed, location: { href, search: '' } }) as unknown as Window;

describe('withJukeMarker', () => {
    it('should append the marker to plain and parameterized URLs', () => {
        expect(withJukeMarker('/admin/tool/p/edit/c1')).toBe('/admin/tool/p/edit/c1?juke=1');
        expect(withJukeMarker('/admin/tool/p/edit/c1?displayAsNew=true')).toBe(
            '/admin/tool/p/edit/c1?displayAsNew=true&juke=1',
        );
    });
});

describe('readJukeMarker', () => {
    it('should detect the marker in a query string', () => {
        expect(readJukeMarker('?displayAsNew=true&juke=1')).toBe(true);
        expect(readJukeMarker('?displayAsNew=true')).toBe(false);
        expect(readJukeMarker('')).toBe(false);
    });
});

describe('openEditTabWithJuke', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.generateEditContentUrl.mockReturnValue('/admin/tool/superhero/edit/c1?displayAsNew=true');
    });

    it('should open the marked URL under the wizard tab name and return the new tab', () => {
        const opened = tab('about:blank');
        mocks.openTabOrFocusExisting.mockReturnValue(opened);

        expect(openEditTabWithJuke(params)).toBe(opened);
        expect(mocks.generateEditContentUrl).toHaveBeenCalledWith(params);
        expect(mocks.openTabOrFocusExisting).toHaveBeenCalledWith(
            '/admin/tool/superhero/edit/c1?displayAsNew=true&juke=1',
            'edit:superhero:c1',
        );
        expect(mocks.showWarning).not.toHaveBeenCalled();
    });

    it('should warn and return null when the popup was blocked', () => {
        mocks.openTabOrFocusExisting.mockReturnValue(null);
        expect(openEditTabWithJuke(params)).toBeNull();
        expect(mocks.showWarning).toHaveBeenCalledWith('notify.popupBlocker.admin', false);

        mocks.openTabOrFocusExisting.mockReturnValue(tab('about:blank', true));
        expect(openEditTabWithJuke(params)).toBeNull();
    });

    it('should not hand over to an already open editor that runs without Juke', () => {
        const existing = tab('http://localhost/admin/tool/superhero/edit/c1');
        mocks.openTabOrFocusExisting.mockReturnValue(existing);
        expect(openEditTabWithJuke(params)).toBeNull();

        const withJuke = {
            closed: false,
            location: { href: 'http://localhost/admin/tool/superhero/edit/c1?juke=1', search: '?juke=1' },
        } as unknown as Window;
        mocks.openTabOrFocusExisting.mockReturnValue(withJuke);
        expect(openEditTabWithJuke(params)).toBe(withJuke);
    });
});
