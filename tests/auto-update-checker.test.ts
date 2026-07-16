import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../src/hooks/auto-update-checker.js';

describe('auto-update-checker : isNewerVersion', () => {
    it('returns false for equal versions', () => {
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });

    it('returns true when latest is greater than current', () => {
        expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
        expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
        expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true);
    });

    it('returns false when latest is older than current (downgrade)', () => {
        expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
        expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false);
        expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
    });

    it('handles pre-release correctly (clean release is newer than pre-release)', () => {
        expect(isNewerVersion('1.0.0', '1.0.0-alpha')).toBe(true);
        expect(isNewerVersion('1.0.0-alpha', '1.0.0')).toBe(false);
    });

    it('handles comparison between pre-releases', () => {
        expect(isNewerVersion('1.0.0-beta', '1.0.0-alpha')).toBe(true);
        expect(isNewerVersion('1.0.0-alpha', '1.0.0-beta')).toBe(false);
        expect(isNewerVersion('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(true);
    });
});
