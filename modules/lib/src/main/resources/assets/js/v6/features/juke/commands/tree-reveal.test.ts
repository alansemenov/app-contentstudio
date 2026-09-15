import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentPath } from '../../../../app/content/ContentPath';
import { expandInTree, leaveFilterMode, MOVE_EVENT_TIMEOUT_MS, waitForMovedEvent } from './tree-reveal';

type MovedEvent = { timestamp: number; data: { item: { getContentSummary: () => { getId: () => string } } }[] };

const { mocks, filter, moved } = vi.hoisted(() => ({
    mocks: { revealContentByPath: vi.fn(), resetContentFilter: vi.fn() },
    filter: { active: false, listeners: [] as ((active: boolean) => void)[] },
    moved: {
        value: null as MovedEvent | null,
        listeners: [] as ((event: MovedEvent | null) => void)[],
        emit(timestamp: number, ...ids: string[]) {
            moved.value = {
                timestamp,
                data: ids.map((id) => ({ item: { getContentSummary: () => ({ getId: () => id }) } })),
            };
            moved.listeners.forEach((listener) => listener(moved.value));
        },
    },
}));

vi.mock('../../../shared/socket/socket.store', () => ({
    $contentMoved: {
        get: () => moved.value,
        subscribe: (listener: (event: MovedEvent | null) => void) => {
            moved.listeners.push(listener);
            listener(moved.value);
            return () => {
                moved.listeners = moved.listeners.filter((l) => l !== listener);
            };
        },
    },
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
        moved.value = null;
        moved.listeners = [];
    });

    afterEach(() => {
        vi.useRealTimers();
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

    it('should wait for the move report of every item', async () => {
        vi.useFakeTimers();
        let settled = false;
        const waiting = waitForMovedEvent(['a', 'b'], 1000).then(() => {
            settled = true;
        });

        moved.emit(1500, 'a');
        await Promise.resolve();
        expect(settled).toBe(false);

        moved.emit(1600, 'b');
        await waiting;
        expect(settled).toBe(true);
        expect(moved.listeners).toHaveLength(0);
    });

    it('should count a report that already arrived, but not an older one', async () => {
        vi.useFakeTimers();
        moved.emit(1500, 'a');
        await expect(waitForMovedEvent(['a'], 1000)).resolves.toBeUndefined();

        let settled = false;
        void waitForMovedEvent(['a'], 2000).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        vi.advanceTimersByTime(MOVE_EVENT_TIMEOUT_MS);
        await Promise.resolve();
        expect(settled).toBe(true);
    });

    it('should give up waiting after a while', async () => {
        vi.useFakeTimers();
        let settled = false;
        void waitForMovedEvent(['a'], 1000).then(() => {
            settled = true;
        });

        vi.advanceTimersByTime(MOVE_EVENT_TIMEOUT_MS - 1);
        await Promise.resolve();
        expect(settled).toBe(false);

        vi.advanceTimersByTime(1);
        await Promise.resolve();
        expect(settled).toBe(true);
        expect(moved.listeners).toHaveLength(0);
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
