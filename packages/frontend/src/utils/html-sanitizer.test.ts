import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl } from './html-sanitizer';
import { parseMarkedText } from './render';

describe('isSafeHttpUrl', () => {
    it('accepts http/https and rejects unsafe or protocol-relative URLs', () => {
        expect(isSafeHttpUrl('https://example.com/a')).toBe(true);
        expect(isSafeHttpUrl('http://example.com')).toBe(true);
        expect(isSafeHttpUrl('//example.com/a')).toBe(false);
        expect(isSafeHttpUrl('javascript:void(0)')).toBe(false);
        expect(isSafeHttpUrl('data:text/html,hi')).toBe(false);
        expect(isSafeHttpUrl('/settings', { allowRelative: true })).toBe(true);
        expect(isSafeHttpUrl('//evil.example', { allowRelative: true })).toBe(false);
        expect(isSafeHttpUrl('mailto:test@example.com', { allowMailto: true })).toBe(true);
    });
});

describe('parseMarkedText', () => {
    it('splits marked segments while keeping HTML syntax as plain text', () => {
        expect(parseMarkedText('a <mark>b</mark> <b>c</b>')).toEqual([
            { text: 'a ', marked: false },
            { text: 'b', marked: true },
            { text: ' <b>c</b>', marked: false }
        ]);
    });
});
