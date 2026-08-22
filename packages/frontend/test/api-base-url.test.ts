import { describe, expect, it } from 'vitest';
import { resolvePublicApiBaseUrl } from '../src/utils/api-base-url';

describe('public API base URL', () => {
    it('resolves the default relative API path against the current page origin', () => {
        expect(resolvePublicApiBaseUrl('/api', 'http://localhost:5173')).toBe(
            'http://localhost:5173/api/'
        );
    });

    it('preserves an absolute configured API URL', () => {
        expect(resolvePublicApiBaseUrl('https://api.luogu.me/', 'http://localhost:5173')).toBe(
            'https://api.luogu.me/'
        );
    });
});
