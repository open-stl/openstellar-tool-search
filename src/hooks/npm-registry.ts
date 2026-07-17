import { execFile as nodeExecFile } from 'node:child_process';

function execFileAsync(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        nodeExecFile(cmd, args, opts, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
        });
    });
}

const FALLBACK_REGISTRY = 'https://registry.npmjs.org';
const NPM_CONFIG_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// ResolveEffects – injected execFile for testability (no real npm in tests)
// ---------------------------------------------------------------------------

export interface ResolveEffects {
    execFile: (
        cmd: string,
        args: string[],
        opts: { cwd?: string; timeout?: number },
    ) => Promise<{ stdout: string; stderr: string }>;
}

async function defaultExecFile(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
    const { stdout } = await execFileAsync(cmd, args, opts);
    return { stdout, stderr: '' };
}

// ---------------------------------------------------------------------------
// parseRegistryUrl
// ---------------------------------------------------------------------------

/**
 * Validate a raw registry URL string.
 *
 * Accepts already-trimmed output (trims internally).  Returns the normalised
 * URL on success, `null` when the input is invalid: non-http(s) protocol,
 * contains credentials, query-string, fragment, or is otherwise malformed.
 */
export function parseRegistryUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.search !== '' || url.hash !== '') return null;

    return url.href;
}

// ---------------------------------------------------------------------------
// buildDistTagsUrl
// ---------------------------------------------------------------------------

/**
 * Build a dist-tags endpoint URL from a validated registry base and a package
 * name.  Preserves the registry's base path, percent-encodes the scoped
 * package name exactly once, and rejects invalid / unsupported inputs.
 *
 * Returns `null` when either argument is invalid.
 */
export function buildDistTagsUrl(
    registryBase: string,
    packageName: string,
): string | null {
    const validBase = parseRegistryUrl(registryBase);
    if (!validBase) return null;

    const trimmedPkg = packageName.trim();
    if (!trimmedPkg) return null;

    const base = validBase.endsWith('/') ? validBase.slice(0, -1) : validBase;
    // Percent-encode the scoped prefix once: @scope/pkg → %40scope%2Fpkg
    const encoded = trimmedPkg.replace(/@/g, '%40').replace(/\//g, '%2F');

    return `${base}/-/package/${encoded}/dist-tags`;
}

// ---------------------------------------------------------------------------
// tryParseRegistryConfig – parse stdout of `npm config get`
// ---------------------------------------------------------------------------

function tryParseRegistryConfig(output: string): string | null {
    return parseRegistryUrl(output);
}

// ---------------------------------------------------------------------------
// resolveRegistryUrl
// ---------------------------------------------------------------------------

/**
 * Determine the npm registry base URL by probing `npm config` for the scoped
 * `@openstellar:registry`, then the global `registry`, falling back to the
 * public npmjs registry when either is missing or npm is unavailable.
 *
 * Uses injected `effects.execFile` so tests never invoke the real npm binary.
 */
export async function resolveRegistryUrl(
    effects?: ResolveEffects,
): Promise<{ url: string; source: 'scoped' | 'default' | 'fallback' }> {
    const exec = effects?.execFile ?? defaultExecFile;

    // 1. Scoped registry: @openstellar:registry
    try {
        const { stdout } = await exec('npm', ['config', 'get', '@openstellar:registry'], {
            timeout: NPM_CONFIG_TIMEOUT,
        });
        const url = tryParseRegistryConfig(stdout);
        if (url) return { url, source: 'scoped' };
    } catch {
        // npm unavailable, timeout, or non-zero exit – fall through
    }

    // 2. Default registry: registry
    try {
        const { stdout } = await exec('npm', ['config', 'get', 'registry'], {
            timeout: NPM_CONFIG_TIMEOUT,
        });
        const url = tryParseRegistryConfig(stdout);
        if (url) return { url, source: 'default' };
    } catch {
        // fall through
    }

    // 3. Hard-coded fallback
    return { url: FALLBACK_REGISTRY, source: 'fallback' };
}
