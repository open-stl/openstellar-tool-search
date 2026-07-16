import { describe, expect, it, vi } from 'vitest';
import { invalidatePackageCache } from '../src/hooks/auto-update-checker.js';
import {
    checkForUpdate,
    getPackageCacheTargets,
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

describe('auto-update-checker : cache targets', () => {
    it('builds only wrapper targets for the package and latest spec', () => {
        expect(getPackageCacheTargets('/tmp/packages')).toEqual([
            '/tmp/packages/@openstellar/tool-search',
            '/tmp/packages/@openstellar/tool-search@latest',
        ]);
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

    it('returns false for nonexistent, mixed, and failed filesystem targets', () => {
        expect(invalidatePackageCache(['/cache'], { existsSync: () => false, rmSync: vi.fn() })).toBe(false);
        expect(invalidatePackageCache(['/cache'], { existsSync: () => true, rmSync: () => { throw new Error('remove failed'); } })).toBe(false);
        let calls = 0;
        expect(invalidatePackageCache(['/cache', '/cache-2'], { existsSync: () => true, rmSync: () => { calls += 1; if (calls === 2) throw new Error('remove failed'); } })).toBe(false);
    });

    it('returns check-failed when getCurrentVersion throws', async () => {
        await expect(checkForUpdate({
            getCurrentVersion: () => { throw new Error('version read failed'); },
            getLatestVersion: async () => '1.0.1',
            invalidatePackageCache: () => true,
        })).resolves.toEqual({
            outcome: 'check-failed',
            currentVersion: null,
            latestVersion: null,
            error: 'version read failed',
        });
    });

    it('returns invalidation-failed when invalidatePackageCache throws', async () => {
        await expect(checkForUpdate({
            getCurrentVersion: () => '1.0.0',
            getLatestVersion: async () => '1.0.1',
            invalidatePackageCache: () => { throw new Error('remove exploded'); },
        })).resolves.toEqual({
            outcome: 'invalidation-failed',
            currentVersion: '1.0.0',
            latestVersion: '1.0.1',
            error: 'remove exploded',
        });
    });

    it.each([
        ['malformed current version', 'latest', '1.0.1'],
        ['malformed latest version', '1.0.0', 'latest'],
    ])('returns check-failed for %s', async (_label, currentVersion, latestVersion) => {
        await expect(checkForUpdate({
            getCurrentVersion: () => currentVersion,
            getLatestVersion: async () => latestVersion,
            invalidatePackageCache: () => true,
        })).resolves.toEqual({
            outcome: 'check-failed',
            currentVersion,
            latestVersion,
            error: 'Could not compare package versions',
        });
    });

    it('reports invalidation failure without staging an update', async () => {
        const result = await checkForUpdate({
            getCurrentVersion: () => '1.0.0',
            getLatestVersion: async () => '1.0.1',
            invalidatePackageCache: () => false,
        });

        expect(result).toMatchObject({
            outcome: 'invalidation-failed',
            error: 'Could not invalidate the package cache',
        });
    });

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
        expect(result.outcome).toBe(needsUpdate ? 'update-staged' : (result.error ? 'check-failed' : 'up-to-date'));
        expect(invalidations).toBe(needsUpdate ? 1 : 0);
    });
});
