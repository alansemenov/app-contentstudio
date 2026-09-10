import type { Extension } from '@enonic/lib-admin-ui/extension/Extension';
import { $config } from '../../../shared/config/config.store';

//
// * Sibling Content Studio installations
//
// This build can run next to the original Content Studio on the same XP. Both
// ship the same built-in extensions (previews, settings, context widgets) under
// the shared `contentstudio.*` interfaces, so each would list the other's copies.
// Extensions owned by a sibling installation are dropped; third-party apps are kept.
//

const STUDIO_APP_KEYS: readonly string[] = ['com.enonic.app.contentstudio', 'com.enonic.app.hackathon'];

export function isSiblingStudioAppKey(appKey: string): boolean {
    return appKey !== $config.get().appId && STUDIO_APP_KEYS.includes(appKey);
}

export function isSiblingStudioExtension(extension: Readonly<Extension>): boolean {
    return isSiblingStudioAppKey(extension.getDescriptorKey().getApplicationKey().toString());
}
