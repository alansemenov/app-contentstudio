import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentPath } from '../../../../app/content/ContentPath';
import { expandInTree, leaveFilterMode } from './tree-reveal';

const { mocks, filter } = vi.hoisted(() => ({
    mocks: { revealContentByPath: vi.fn(), resetContentFilter: vi.fn() },
    filter: { active: false, listeners: [] as ((active: boolean) => void)[] },
}));

vi.mock('../../../entities/content', () => ({
    revealContentByPath: mocks.revealContentByPath,
    $isFilterActive: {
        get: () => filter.active,
        subscribe: (listener: (active: boolean) => void) => {
            filter.listeners.push(listener);
            return () => {
                filter.listeners = filter.listeners.filter((l) => l !== listener);
            };
        },
    },
}));
vi.mock('../../../shared/app-state/contentFilter.store', () => ({ resetContentFilter: mocks.resetContentFilter }));

const path = (value: string): ContentPath =>
    ({ toString: () => value, isRoot: () => value === '/' }) as unknown as ContentPath;

describe('tree-reveal', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.revealContentByPath.mockResolvedValue(undefined);
        filter.active = false;
        filter.listeners = [];
    });

    it('should do nothing when no filter is active', async () => {
        await leaveFilterMode();
        expect(mocks.resetContentFilter).not.toHaveBeenCalled();
    });

    it('should reset the filter and wait until the tree is back', async () => {
        filter.active = true;
        mocks.resetContentFilter.mockImplementation(() => {
            queueMicrotask(() => {
                filter.active = false;
                filter.listeners.forEach((listener) => listener(false));
            });
        });

        await leaveFilterMode();

        expect(mocks.resetContentFilter).toHaveBeenCalledTimes(1);
        expect(filter.listeners).toHaveLength(0);
    });

    it('should expand a path without selecting and skip the root', async () => {
        await expandInTree(path('/superhero/blogs'));
        expect(mocks.revealContentByPath).toHaveBeenCalledWith('/superhero/blogs', {
            select: false,
            expandTarget: true,
        });

        await expandInTree(path('/'));
        expect(mocks.revealContentByPath).toHaveBeenCalledTimes(1);
    });
});
