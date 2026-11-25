import { describe, expect, it } from 'vitest';
import {
    composeSearchQuery,
    extractInlineAuthorUid,
    normalizeSearchLimit,
    parseCategoryListQuery,
    parseExactPhrasesQuery,
    parseNonNegativeInt,
    parsePositiveInt,
    parseSearchSort,
    parseTagsQuery
} from './searchFilters.ts';

describe('searchFilters', () => {
    it('extracts inline author UID syntax without dropping remaining keywords', () => {
        expect(extractInlineAuthorUid('动态规划 uid:12345 树形')).toEqual({
            text: '动态规划 树形',
            authorId: 12345
        });
        expect(extractInlineAuthorUid('作者：99')).toEqual({
            text: '',
            authorId: 99
        });
        expect(extractInlineAuthorUid('线段树')).toEqual({
            text: '线段树',
            authorId: null
        });
    });

    it('composes exact phrases with quotes and strips embedded quotes', () => {
        expect(composeSearchQuery('图论', ['"最短路"', 'SPFA'])).toBe('图论 "最短路" "SPFA"');
        expect(composeSearchQuery('', ['动态规划'])).toBe('"动态规划"');
        expect(composeSearchQuery('  ', [])).toBe('');
    });

    it('parses multi-category CSV/array and tag lists with deduplication', () => {
        expect(parseCategoryListQuery('2,4,2,abc')).toEqual([2, 4]);
        expect(parseCategoryListQuery(['1', '3,1'])).toEqual([1, 3]);
        expect(parseTagsQuery('DP, 图论, DP, ')).toEqual(['DP', '图论']);
        expect(parseTagsQuery(['线段树', '数据结构,线段树'])).toEqual(['线段树', '数据结构']);
    });

    it('normalizes exact phrase query params with deduplication', () => {
        expect(parseExactPhrasesQuery(['DP', ' "DP" ', '', '网络流'])).toEqual(['DP', '网络流']);
        expect(parseExactPhrasesQuery('线段树')).toEqual(['线段树']);
        expect(parseExactPhrasesQuery(undefined)).toEqual([]);
    });

    it('validates integers, sort enum, and page limits', () => {
        expect(parsePositiveInt('42')).toBe(42);
        expect(parsePositiveInt('0')).toBeNull();
        expect(parseNonNegativeInt('0')).toBe(0);
        expect(parseNonNegativeInt('-1')).toBeNull();
        expect(parseSearchSort('views_desc')).toBe('views_desc');
        expect(parseSearchSort('unknown')).toBe('relevance');
        expect(normalizeSearchLimit('24')).toBe(24);
        expect(normalizeSearchLimit('100')).toBe(50);
        expect(normalizeSearchLimit(undefined)).toBe(12);
    });
});
