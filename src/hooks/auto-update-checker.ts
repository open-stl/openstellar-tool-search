import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { env } from 'node:process';

const PACKAGE_SCOPE = '@openstellar';
const PACKAGE_NAME = '@openstellar/tool-search';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/dist-tags`;
const NPM_FETCH_TIMEOUT = 5000;

export interface UpdateCheckResult {
    needsUpdate: boolean;
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

export async function getLatestVersion(): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT);

    try {
        const response = await fetch(NPM_REGISTRY_URL, {
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

export function invalidatePackageCache(): boolean {
    const cacheRoots = getPossibleCacheRoots();
    const seen = new Set<string>();
    let removed = false;

    for (const root of cacheRoots) {
        if (seen.has(root)) continue;
        seen.add(root);
        if (!existsSync(root)) continue;

        const scopeDir = join(root, PACKAGE_SCOPE);
        if (existsSync(scopeDir)) {
            try {
                rmSync(scopeDir, { recursive: true, force: true });
                removed = true;
            } catch {
            }
            continue;
        }

        const specDir = join(root, `${PACKAGE_NAME}@latest`);
        if (existsSync(specDir)) {
            try {
                rmSync(specDir, { recursive: true, force: true });
                removed = true;
            } catch {
            }
        }
    }
    return removed;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = getCurrentVersion();
    if (!currentVersion) {
        return {
            needsUpdate: false,
            currentVersion: null,
            latestVersion: null,
            error: 'Could not determine current version',
        };
    }

    const latestVersion = await getLatestVersion();
    if (!latestVersion) {
        return {
            needsUpdate: false,
            currentVersion,
            latestVersion: null,
            error: 'Could not fetch latest version from npm',
        };
    }

    if (currentVersion === latestVersion) {
        return { needsUpdate: false, currentVersion, latestVersion };
    }

    invalidatePackageCache();
    return { needsUpdate: true, currentVersion, latestVersion };
}

export function formatUpdateMessage(result: UpdateCheckResult): {
    title: string;
    message: string;
    variant: 'info' | 'success' | 'warning';
} {
    if (!result.needsUpdate || !result.latestVersion) {
        return { title: 'Tool Search', message: 'Up-to-date', variant: 'info' };
    }
    return {
        title: 'Tool Search Update',
        message: `v${result.currentVersion} -> v${result.latestVersion}. Restart OpenCode to apply.`,
        variant: 'warning',
    };
}
