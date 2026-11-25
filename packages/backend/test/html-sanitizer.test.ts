import { describe, expect, it } from 'vitest';
import { sanitizeSiteHtml } from '../src/utils/html-sanitizer';

describe('sanitizeSiteHtml', () => {
    it('strips dangerous tags, event attributes, inline styles, and unsafe URL schemes', () => {
        const dirty = [
            '<p style="position:fixed">Hello <strong>world</strong></p>',
            '<iframe src="https://example.com"></iframe>',
            '<svg><desc>x</desc></svg>',
            '<a href="javascript:void(0)" target="_blank">bad</a>',
            '<img src="data:text/html,abc" alt="bad">'
        ].join('');

        const clean = sanitizeSiteHtml(dirty);
        expect(clean).toContain('<p>Hello <strong>world</strong></p>');
        expect(clean).not.toContain('position:fixed');
        expect(clean).not.toContain('<iframe');
        expect(clean).not.toContain('<svg');
        expect(clean).not.toContain('javascript:');
        expect(clean).not.toContain('data:text/html');
    });

    it('preserves safe links and enforces rel="noopener noreferrer" on target="_blank"', () => {
        const clean = sanitizeSiteHtml(
            '<a href="https://example.com" target="_blank">Open</a> <a href="/settings" target="_self">Local</a>'
        );
        expect(clean).toContain(
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Open</a>'
        );
        expect(clean).toContain('<a href="/settings">Local</a>');
        expect(clean).not.toContain('target="_self"');
    });
});
