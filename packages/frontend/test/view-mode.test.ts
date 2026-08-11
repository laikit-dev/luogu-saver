import { describe, expect, it } from 'vitest';
import { canUseFocusView, normalizeViewMode } from '../src/composables/useViewMode';

describe('content view mode', () => {
    it('does not restore focus mode on a narrow viewport', () => {
        expect(normalizeViewMode('focus', 767)).toBe('default');
        expect(normalizeViewMode('focus', 768)).toBe('focus');
    });

    it('allows the default mode at every width and guards focus mode separately', () => {
        expect(normalizeViewMode('default', 320)).toBe('default');
        expect(canUseFocusView(320)).toBe(false);
        expect(canUseFocusView(1920)).toBe(true);
    });
});
