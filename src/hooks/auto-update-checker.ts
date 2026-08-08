import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, rmSync, promises as fsPromises } from 'node:fs';
import { homedir, platform } from 'node:os';
import { env } from 'node:process';
import { gt, valid } from 'semver';
import { resolveRegistryUrl, buildDistTagsUrl } from './npm-registry.js';

const PACKAGE_NAME = '@openstellar/tool-search';
const NPM_FETCH_TIMEOUT = 5000;

export type UpdateCheckOutcome = 'up-to-date' | 'update-staged' | 'invalidation-failed' | 'check-failed';

export interface UpdateCheckResult {
    outcome: UpdateCheckOutcome;
    currentVersion: string | null;
    latestVersion: string | null;
    error?: string;
}

export function getCurrentVersion(): string | null {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const dir = dirname(__filename);
        const candidates = [
            join(dir, '..', 'package.json'),
            join(dir, '..', '..', 'package.json'),
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
                if (pkg.version) return pkg.version;
            }
        }
    } catch {
    }
    return null;
}

export interface LatestVersionEffects {
    resolveRegistryUrl: typeof resolveRegistryUrl;
    fetch: typeof fetch;
}

const defaultLatestVersionEffects: LatestVersionEffects = {
    resolveRegistryUrl,
    fetch,
};

export async function getLatestVersion(
    effects: LatestVersionEffects = defaultLatestVersionEffects,
): Promise<string | null> {
    const { url } = await effects.resolveRegistryUrl();
    const distTagsUrl = buildDistTagsUrl(url, PACKAGE_NAME);
    if (!distTagsUrl) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT);

    try {
        const response = await effects.fetch(distTagsUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const data = (await response.json()) as Record<string, string>;
        return data.latest ?? null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

function getPossibleCacheRoots(): string[] {
    const cacheDirs = [
        join(homedir(), '.cache', 'opencode', 'packages'),
        join(homedir(), '.config', 'opencode', 'packages'),
    ];
    if (platform() === 'win32' && env.APPDATA) {
        cacheDirs.push(join(env.APPDATA, 'opencode', 'packages'));
    }
    return cacheDirs;
}

export function getPackageCacheTargets(cacheRoot: string): string[] {
    return [join(cacheRoot, PACKAGE_NAME), join(cacheRoot, `${PACKAGE_NAME}@latest`)];
}

export interface CacheInvalidationEffects {
    existsSync: typeof existsSync;
    rmSync: typeof rmSync;
}

const defaultCacheInvalidationEffects: CacheInvalidationEffects = { existsSync, rmSync };

export function invalidatePackageCache(
    cacheRoots = getPossibleCacheRoots(),
    effects: CacheInvalidationEffects = defaultCacheInvalidationEffects,
): boolean {
    const seen = new Set<string>();
    let removalFailed = false;

    for (const root of cacheRoots) {
        if (seen.has(root)) continue;
        seen.add(root);
        for (const target of getPackageCacheTargets(root)) {
            let exists: boolean;
            try {
                exists = effects.existsSync(target);
            } catch {
                removalFailed = true;
                continue;
            }
            if (!exists) continue;
            try {
                effects.rmSync(target, { recursive: true, force: true });
            } catch {
                removalFailed = true;
            }
        }
    }
    return !removalFailed;
}

export function isNewerVersion(latest: string, current: string): boolean {
    return valid(latest) !== null && valid(current) !== null && gt(latest, current);
}

export interface UpdateCheckEffects {
    getCurrentVersion: () => string | null;
    getLatestVersion: () => Promise<string | null>;
    invalidatePackageCache: () => boolean;
}

const defaultUpdateCheckEffects: UpdateCheckEffects = {
    getCurrentVersion,
    getLatestVersion,
    invalidatePackageCache,
};

export async function checkForUpdate(
    effects: UpdateCheckEffects = defaultUpdateCheckEffects,
): Promise<UpdateCheckResult> {
    let currentVersion: string | null;
    try {
        currentVersion = effects.getCurrentVersion();
    } catch (error) {
        return { outcome: 'check-failed', currentVersion: null, latestVersion: null, error: error instanceof Error ? error.message : 'Could not determine current version' };
    }
    if (!currentVersion) {
        return { outcome: 'check-failed', currentVersion: null, latestVersion: null, error: 'Could not determine current version' };
    }

    let latestVersion: string | null;
    try {
        latestVersion = await effects.getLatestVersion();
    } catch {
        latestVersion = null;
    }
    if (!latestVersion) {
        return { outcome: 'check-failed', currentVersion, latestVersion: null, error: 'Could not fetch latest version from npm' };
    }
    if (valid(currentVersion) === null || valid(latestVersion) === null) {
        return {
            outcome: 'check-failed',
            currentVersion,
            latestVersion,
            error: 'Could not compare package versions',
        };
    }

    if (!isNewerVersion(latestVersion, currentVersion)) {
        return { outcome: 'up-to-date', currentVersion, latestVersion };
    }

    let invalidated: boolean;
    try {
        invalidated = effects.invalidatePackageCache();
    } catch (error) {
        return {
            outcome: 'invalidation-failed',
            currentVersion,
            latestVersion,
            error: error instanceof Error ? error.message : 'Could not invalidate the package cache',
        };
    }
    if (!invalidated) {
        return { outcome: 'invalidation-failed', currentVersion, latestVersion, error: 'Could not invalidate the package cache' };
    }
    return { outcome: 'update-staged', currentVersion, latestVersion };
}

export function formatUpdateMessage(result: UpdateCheckResult): {
    title: string;
    message: string;
    variant: 'info' | 'success' | 'warning' | 'error';
} {
    if (result.outcome === 'update-staged' && result.latestVersion) {
        return {
            title: 'Tool Search Update',
            message: `v${result.currentVersion} -> v${result.latestVersion}. Restart OpenCode to apply.`,
            variant: 'warning',
        };
    }
    if (result.outcome === 'check-failed' || result.outcome === 'invalidation-failed') {
        return { title: 'Tool Search Update Check', message: result.error ?? 'Update check failed.', variant: 'error' };
    }
    return { title: 'Tool Search', message: 'Up-to-date', variant: 'info' };
}
