import { describe, expect, it } from 'vitest';
import {
    checkForUpdate,
    isNewerVersion,
} from '../src/hooks/auto-update-checker.js';

describe('auto-update-checker : isNewerVersion', () => {
    it.each([
        ['1.0.1', '1.0.0', true],
        ['1.0.0', '1.0.0', false],
        ['1.0.0', '1.0.1', false],
        ['1.0.0', '1.0.0-alpha', true],
        ['1.0.0-alpha', '1.0.0', false],
        ['1.0.0-alpha.10', '1.0.0-alpha.2', true],
        ['1.0.0-alpha.1', '1.0.0-alpha.beta', false],
        ['1.0.0-beta.2', '1.0.0-beta.11', false],
        ['1.0.0-beta.2', '1.0.0-beta.1', true],
        ['1.0.0-1', '1.0.0-alpha', false],
        ['1.0.0+new-build', '1.0.0+old-build', false],
        ['not-semver', '1.0.0', false],
        ['1.0.0', 'not-semver', false],
    ])('compares latest %s against current %s as %s', (latest, current, expected) => {
        expect(isNewerVersion(latest, current)).toBe(expected);
    });
});

describe('auto-update-checker : checkForUpdate lifecycle', () => {
    const runCheck = async (
        currentVersion: string | null,
        latestVersion: string | null,
        fetchError = false,
    ) => {
        let invalidations = 0;
        const result = await checkForUpdate({
            getCurrentVersion: () => currentVersion,
            getLatestVersion: async () => {
                if (fetchError) throw new Error('network failure');
                return latestVersion;
            },
            invalidatePackageCache: () => {
                invalidations += 1;
                return true;
            },
        });
        return { result, invalidations };
    };

    it.each([
        ['newer remote version', '1.0.0', '1.0.1', false, true],
        ['equal remote version', '1.0.0', '1.0.0', false, false],
        ['older remote version', '1.0.1', '1.0.0', false, false],
        ['malformed remote version', '1.0.0', 'latest', false, false],
        ['malformed current version', 'latest', '1.0.1', false, false],
        ['unavailable remote version', '1.0.0', null, false, false],
        ['fetch error result', '1.0.0', null, true, false],
        ['missing current version', null, '1.0.1', false, false],
    ])('invalidates only for %s', async (_caseName, current, latest, fetchError, needsUpdate) => {
        const { result, invalidations } = await runCheck(current, latest, fetchError);
        expect(result.needsUpdate).toBe(needsUpdate);
        expect(invalidations).toBe(needsUpdate ? 1 : 0);
    });
});
