import { beforeEach, describe, expect, it } from 'vitest';
import type { Extension } from '@enonic/lib-admin-ui/extension/Extension';
import { $config } from '../../../shared/config/config.store';
import { isSiblingStudioAppKey, isSiblingStudioExtension } from './siblingExtensions';

const extensionWithKey = (key: string): Readonly<Extension> =>
    ({
        getDescriptorKey: () => ({ getApplicationKey: () => ({ toString: () => key.split(':')[0] }) }),
    }) as unknown as Extension;

describe('siblingExtensions', () => {
    describe('running as the hackathon app', () => {
        beforeEach(() => {
            $config.setKey('appId', 'com.enonic.app.hackathon');
        });

        it('should treat the original Content Studio as a sibling', () => {
            expect(isSiblingStudioAppKey('com.enonic.app.contentstudio')).toBe(true);
            expect(isSiblingStudioExtension(extensionWithKey('com.enonic.app.contentstudio:preview-json'))).toBe(true);
        });

        it('should keep its own and third-party extensions', () => {
            expect(isSiblingStudioAppKey('com.enonic.app.hackathon')).toBe(false);
            expect(isSiblingStudioAppKey('com.enonic.app.contentstudio.plus')).toBe(false);
            expect(isSiblingStudioExtension(extensionWithKey('com.example.nextjs:preview'))).toBe(false);
        });
    });

    describe('running as the original Content Studio', () => {
        beforeEach(() => {
            $config.setKey('appId', 'com.enonic.app.contentstudio');
        });

        it('should treat the hackathon app as a sibling and keep itself', () => {
            expect(isSiblingStudioAppKey('com.enonic.app.hackathon')).toBe(true);
            expect(isSiblingStudioAppKey('com.enonic.app.contentstudio')).toBe(false);
        });
    });
});
