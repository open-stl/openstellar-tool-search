import { describe, expect, it, vi } from 'vitest';
import { invalidatePackageCache } from '../src/hooks/auto-update-checker.js';
import {
    checkForUpdate,
    getLatestVersion,
    getPackageCacheTargets,
    isNewerVersion,
} from '../src/hooks/auto-update-checker.js';
import {
    parseRegistryUrl,
    buildDistTagsUrl,
    resolveRegistryUrl,
} from '../src/hooks/npm-registry.js';

// ---------------------------------------------------------------------------
// Existing tests – unchanged
// ---------------------------------------------------------------------------

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

    it('returns true when target cache directories do not exist on disk', () => {
        expect(invalidatePackageCache(['/cache'], { existsSync: () => false, rmSync: vi.fn() })).toBe(true);
    });

    it('returns false for failed filesystem targets', () => {
        expect(invalidatePackageCache(['/cache'], { existsSync: () => true, rmSync: () => { throw new Error('remove failed'); } })).toBe(false);
        let calls = 0;
        expect(invalidatePackageCache(['/cache', '/cache-2'], { existsSync: () => true, rmSync: () => { calls += 1; if (calls === 2) throw new Error('remove failed'); } })).toBe(false);
    });

    it('returns update-staged when a newer version is available and cache directories do not exist initially', async () => {
        const result = await checkForUpdate({
            getCurrentVersion: () => '1.0.0',
            getLatestVersion: async () => '1.0.1',
            invalidatePackageCache: () => invalidatePackageCache(['/cache'], { existsSync: () => false, rmSync: vi.fn() }),
        });

        expect(result).toEqual({
            outcome: 'update-staged',
            currentVersion: '1.0.0',
            latestVersion: '1.0.1',
        });
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

// ---------------------------------------------------------------------------
// npm-registry : parseRegistryUrl
// ---------------------------------------------------------------------------

describe('npm-registry : parseRegistryUrl', () => {
    it('accepts a valid https URL', () => {
        expect(parseRegistryUrl('https://registry.npmjs.org')).toBe(
            'https://registry.npmjs.org/',
        );
    });

    it('accepts a valid http URL', () => {
        expect(parseRegistryUrl('http://localhost:4873')).toBe(
            'http://localhost:4873/',
        );
    });

    it('accepts a URL with a base path', () => {
        expect(parseRegistryUrl('https://my.company.com/npm')).toBe(
            'https://my.company.com/npm',
        );
    });

    it('returns null for a URL with credentials', () => {
        expect(parseRegistryUrl('https://token:secret@registry.npmjs.org')).toBeNull();
    });

    it('returns null for a URL with a username only', () => {
        expect(parseRegistryUrl('https://user@registry.npmjs.org')).toBeNull();
    });

    it('returns null for a URL with a query string', () => {
        expect(parseRegistryUrl('https://registry.npmjs.org?q=1')).toBeNull();
    });

    it('returns null for a URL with a fragment', () => {
        expect(parseRegistryUrl('https://registry.npmjs.org#section')).toBeNull();
    });

    it('returns null for a malformed URL', () => {
        expect(parseRegistryUrl('not-a-url')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(parseRegistryUrl('')).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
        expect(parseRegistryUrl('   ')).toBeNull();
    });

    it('returns null for CRLF-only input', () => {
        expect(parseRegistryUrl('\r\n')).toBeNull();
    });

    it('trims whitespace before validating', () => {
        expect(parseRegistryUrl('  https://registry.npmjs.org  ')).toBe(
            'https://registry.npmjs.org/',
        );
    });

    it('trims trailing newlines before validating', () => {
        expect(parseRegistryUrl('https://registry.npmjs.org\n')).toBe(
            'https://registry.npmjs.org/',
        );
    });

    it('returns null for a non-http protocol', () => {
        expect(parseRegistryUrl('ftp://registry.npmjs.org')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// npm-registry : buildDistTagsUrl
// ---------------------------------------------------------------------------

describe('npm-registry : buildDistTagsUrl', () => {
    it('builds a dist-tags URL preserving the base path', () => {
        const url = buildDistTagsUrl(
            'https://my-company.com/npm',
            'my-package',
        );
        expect(url).toBe(
            'https://my-company.com/npm/-/package/my-package/dist-tags',
        );
    });

    it('strips trailing slash from the registry base', () => {
        const url = buildDistTagsUrl(
            'https://registry.npmjs.org/',
            'my-package',
        );
        expect(url).toBe(
            'https://registry.npmjs.org/-/package/my-package/dist-tags',
        );
    });

    it('percent-encodes a scoped package once', () => {
        const url = buildDistTagsUrl(
            'https://registry.npmjs.org',
            '@scope/my-package',
        );
        expect(url).toBe(
            'https://registry.npmjs.org/-/package/%40scope%2Fmy-package/dist-tags',
        );
    });

    it('returns null when the registry URL is invalid', () => {
        expect(buildDistTagsUrl('not-a-url', 'pkg')).toBeNull();
    });

    it('returns null when the registry URL has credentials', () => {
        expect(
            buildDistTagsUrl('https://user:pass@registry.npmjs.org', 'pkg'),
        ).toBeNull();
    });

    it('returns null when the package name is empty', () => {
        expect(
            buildDistTagsUrl('https://registry.npmjs.org', ''),
        ).toBeNull();
    });

    it('returns null when the package name is whitespace', () => {
        expect(
            buildDistTagsUrl('https://registry.npmjs.org', '   '),
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// npm-registry : resolveRegistryUrl
// ---------------------------------------------------------------------------

describe('npm-registry : resolveRegistryUrl', () => {
    it('returns the scoped registry when npm config provides one', async () => {
        const execFile = vi.fn().mockResolvedValue({
            stdout: 'https://scoped-registry.example.com/npm\n',
            stderr: '',
        });
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://scoped-registry.example.com/npm',
            source: 'scoped',
        });
        expect(execFile).toHaveBeenCalledWith(
            'npm',
            ['config', 'get', '@openstellar:registry'],
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });

    it('falls through to default registry when scoped is empty', async () => {
        const execFile = vi.fn()
            .mockResolvedValueOnce({ stdout: '\n', stderr: '' }) // scoped → empty
            .mockResolvedValueOnce({ stdout: 'https://default-registry.example.com\n', stderr: '' }); // default
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://default-registry.example.com/',
            source: 'default',
        });
    });

    it('falls through to fallback when both are empty', async () => {
        const execFile = vi.fn().mockResolvedValue({ stdout: '\n', stderr: '' });
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://registry.npmjs.org',
            source: 'fallback',
        });
    });

    it('falls through to fallback when npm is unavailable', async () => {
        const execFile = vi.fn().mockRejectedValue(
            new Error('ENOENT: npm not found'),
        );
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://registry.npmjs.org',
            source: 'fallback',
        });
    });

    it('falls through to fallback on subprocess timeout', async () => {
        const execFile = vi.fn().mockRejectedValue(
            new Error('spawn npm ENOENT'),
        );
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://registry.npmjs.org',
            source: 'fallback',
        });
    });

    it('falls through to fallback on non-zero exit', async () => {
        const execFile = vi.fn().mockRejectedValue(
            new Error('command failed'),
        );
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://registry.npmjs.org',
            source: 'fallback',
        });
    });

    it('rejects scoped registry output with credentials', async () => {
        const execFile = vi.fn().mockResolvedValue({
            stdout: 'https://token:secret@registry.npmjs.org\n',
            stderr: '',
        });
        const result = await resolveRegistryUrl({ execFile });
        // Scoped registry is invalid (has credentials), so falls to default
        // Default also returns empty since we only called scoped
        expect(result.source).toBe('fallback');
    });

    it('rejects invalid URL from npm config', async () => {
        const execFile = vi.fn()
            .mockResolvedValueOnce({ stdout: 'not-a-url\n', stderr: '' }) // scoped → invalid
            .mockResolvedValueOnce({ stdout: 'https://default-registry.example.com\n', stderr: '' }); // default
        const result = await resolveRegistryUrl({ execFile });
        expect(result).toEqual({
            url: 'https://default-registry.example.com/',
            source: 'default',
        });
    });
});

// ---------------------------------------------------------------------------
// auto-update-checker : latest-version retrieval seam
// ---------------------------------------------------------------------------

describe('auto-update-checker : latest-version retrieval seam', () => {
    it('resolves the registry, builds the endpoint, and fetches through one effect', async () => {
        const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ latest: '1.0.1' }) }) as Response);
        const resolveRegistryUrl = vi.fn(async () => ({ url: 'https://custom-registry.example.com/npm', source: 'scoped' as const }));

        await expect(getLatestVersion({ resolveRegistryUrl, fetch })).resolves.toBe('1.0.1');
        expect(resolveRegistryUrl).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            'https://custom-registry.example.com/npm/-/package/%40openstellar%2Ftool-search/dist-tags',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('uses the injected latest-version retrieval effect for the complete check', async () => {
        const getLatestVersion = vi.fn(async () => '1.0.1');

        const result = await checkForUpdate({
            getCurrentVersion: () => '1.0.0',
            getLatestVersion,
            invalidatePackageCache: () => true,
        });

        expect(getLatestVersion).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            outcome: 'update-staged',
            currentVersion: '1.0.0',
            latestVersion: '1.0.1',
        });
    });

    it('returns check-failed when the retrieval effect cannot provide a version', async () => {
        const result = await checkForUpdate({
            getCurrentVersion: () => '1.0.0',
            getLatestVersion: async () => null,
            invalidatePackageCache: () => true,
        });

        expect(result).toMatchObject({
            outcome: 'check-failed',
            error: 'Could not fetch latest version from npm',
        });
    });
});
