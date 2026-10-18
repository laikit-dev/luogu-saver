import { describe, expect, it } from 'vitest';
import {
    parseArchiveUid,
    parseArchiveVersion,
    parseAuthorArticlesQuery,
    parseTimelineQuery,
    toArchiveArticleSummary
} from '../src/utils/archive-query';

describe('archive request boundaries', () => {
    it.each([0, -1, 4_294_967_296, 1.5, '1.5', '1e2', '', ['1'], null, undefined])(
        'rejects non-uint32 user and version input %j',
        value => {
            for (const parse of [parseArchiveUid, parseArchiveVersion]) {
                try {
                    parse(value);
                    expect.unreachable('Invalid unsigned input was accepted');
                } catch (error) {
                    expect(error).toMatchObject({ status: 400 });
                }
            }
        }
    );

    it('accepts the full unsigned range, including article versions above four', () => {
        expect(parseArchiveUid('4294967295')).toBe(4_294_967_295);
        expect(parseArchiveVersion('7')).toBe(7);
        expect(parseArchiveVersion(4_294_967_295)).toBe(4_294_967_295);
    });

    it.each([
        { from: '2026-02-30T00:00:00Z' },
        { from: '2026-09-01T00:00:00+08:00' },
        { from: '2026-09-01' },
        { from: '2026-09-01T24:00:00Z' },
        { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
        { from: '2026-09-01T00:00:00Z', to: '2026-09-01T00:00:00.000Z' },
        { kinds: 'article,clipboard' },
        { kinds: ['article', 'profile'] },
        { kinds: '' },
        { cursor: '=' },
        { limit: '0' },
        { limit: '51' }
    ])('rejects malformed timeline filters %j', query => {
        try {
            parseTimelineQuery(query);
            expect.unreachable('Invalid timeline query was accepted');
        } catch (error) {
            expect(error).toMatchObject({ status: 400 });
        }
    });

    it('normalizes equivalent time and kind filters for cursor binding', () => {
        const first = parseTimelineQuery({
            from: '2026-09-01T00:00:00Z',
            to: '2026-09-02T00:00:00.1Z',
            kinds: 'profile,article,profile'
        });
        const second = parseTimelineQuery({
            from: '2026-09-01T00:00:00.000Z',
            to: '2026-09-02T00:00:00.100Z',
            kinds: 'article,profile'
        });
        expect(first).toEqual(second);
    });

    it.each([{ category: '2.5' }, { sort: 'unknown' }, { category: ['1', '2'] }])(
        'rejects malformed author article filters %j',
        query => expect(() => parseAuthorArticlesQuery(query)).toThrow()
    );
});

describe('public article card projection', () => {
    it('keeps publication unknown rather than inventing an archive-time publication', () => {
        const row = {
            id: 'article1',
            title: 'Title',
            category: 1,
            summary: '**Summary** [preview](https://example.test) <b>only</b>',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            content: 'Private full body',
            deleteReason: 'Private reason'
        };
        expect(toArchiveArticleSummary(row)).toEqual({
            id: 'article1',
            title: 'Title',
            category: 1,
            summary: 'Summary preview only',
            createdAt: '2026-09-01T00:00:00.000Z',
            publishedAt: null
        });
        expect(toArchiveArticleSummary({ ...row, publishTime: 1 }).publishedAt).toBe(
            '1970-01-01T00:00:01.000Z'
        );
        expect(toArchiveArticleSummary({ ...row, publishTime: 0 }).publishedAt).toBeNull();
    });

    it('caps plain previews without returning the rest of a summary', () => {
        const card = toArchiveArticleSummary({
            id: 'article1',
            title: 'Title',
            category: 1,
            createdAt: '2026-09-01T00:00:00.000Z',
            summary: `**${'a'.repeat(200)}** secret tail`
        });
        expect(card.summary).toBe('a'.repeat(200));
    });
});
