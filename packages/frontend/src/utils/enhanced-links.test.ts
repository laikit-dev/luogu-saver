import { describe, expect, it } from 'vitest';
import {
    isBareUrlText,
    parseEnhancedLink,
    shouldAppendAnnotation,
    splitTextWithEnhancedLinks
} from './enhanced-links';

describe('parseEnhancedLink', () => {
    it('parses Luogu and relative user, article, and paste URLs into in-site routes', () => {
        expect(parseEnhancedLink('https://www.luogu.com.cn/user/12345')).toEqual({
            kind: 'user',
            iconGroup: 'user',
            id: '12345',
            numericId: 12345,
            inSitePath: '/user/12345',
            canonicalHref: '/user/12345',
            parsedLabel: null,
            matchToken: '12345'
        });

        expect(parseEnhancedLink('https://luogu.com/space/show?uid=7')).toMatchObject({
            kind: 'user',
            iconGroup: 'user',
            id: '7',
            numericId: 7,
            inSitePath: '/user/7'
        });

        expect(parseEnhancedLink('https://www.luogu.com.cn/article/abc12345?version=2')).toEqual({
            kind: 'article',
            iconGroup: 'article',
            id: 'abc12345',
            inSitePath: '/article/abc12345?version=2',
            canonicalHref: '/article/abc12345?version=2',
            parsedLabel: null,
            matchToken: 'abc12345'
        });

        expect(parseEnhancedLink('/paste/pst00001')).toEqual({
            kind: 'paste',
            iconGroup: 'paste',
            id: 'pst00001',
            inSitePath: '/paste/pst00001',
            canonicalHref: '/paste/pst00001',
            parsedLabel: null,
            matchToken: 'pst00001'
        });
    });

    it('parses Luogu entities and generic Luogu pages with Luogu icon', () => {
        expect(parseEnhancedLink('/problem/P1000')).toEqual({
            kind: 'luogu-problem',
            iconGroup: 'luogu',
            id: 'P1000',
            inSitePath: null,
            canonicalHref: 'https://www.luogu.com.cn/problem/P1000',
            parsedLabel: '题目 P1000',
            matchToken: 'P1000'
        });

        expect(parseEnhancedLink('https://luogu.com.cn/contest/123456')).toMatchObject({
            kind: 'luogu-contest',
            iconGroup: 'luogu',
            parsedLabel: '比赛 #123456',
            matchToken: '123456'
        });

        expect(parseEnhancedLink('https://www.luogu.com.cn/help/rules')).toMatchObject({
            kind: 'luogu-other',
            iconGroup: 'luogu',
            parsedLabel: null,
            inSitePath: null
        });
    });

    it('parses major competitive programming OJs (Codeforces, AtCoder, UOJ, QOJ, LOJ, SPOJ, VJudge, Hydro)', () => {
        expect(parseEnhancedLink('https://codeforces.com/problemset/problem/1895/g')).toMatchObject(
            {
                kind: 'codeforces',
                iconGroup: 'codeforces',
                parsedLabel: 'CF 1895G',
                matchToken: '1895G'
            }
        );
        expect(parseEnhancedLink('https://codeforces.com/contest/1900/problem/A')).toMatchObject({
            kind: 'codeforces',
            parsedLabel: 'CF 1900A'
        });
        expect(parseEnhancedLink('https://codeforces.com/gym/104000/problem/B')).toMatchObject({
            kind: 'codeforces',
            parsedLabel: 'CF Gym 104000B'
        });
        expect(
            parseEnhancedLink('https://atcoder.jp/contests/abc258/tasks/abc258_e')
        ).toMatchObject({
            kind: 'atcoder',
            iconGroup: 'atcoder',
            parsedLabel: 'AtCoder ABC258_E'
        });
        expect(parseEnhancedLink('https://uoj.ac/problem/123')).toMatchObject({
            kind: 'uoj',
            iconGroup: 'uoj',
            parsedLabel: 'UOJ #123'
        });
        expect(parseEnhancedLink('https://qoj.ac/contest/56/problem/789')).toMatchObject({
            kind: 'qoj',
            iconGroup: 'qoj',
            parsedLabel: 'QOJ #789'
        });
        expect(parseEnhancedLink('https://loj.ac/p/100')).toMatchObject({
            kind: 'loj',
            iconGroup: 'loj',
            parsedLabel: 'LOJ #100'
        });
        expect(parseEnhancedLink('https://www.spoj.com/problems/PRIME1/')).toMatchObject({
            kind: 'spoj',
            iconGroup: 'spoj',
            parsedLabel: 'SPOJ PRIME1'
        });
        expect(parseEnhancedLink('https://vjudge.net/problem/CodeForces-1A')).toMatchObject({
            kind: 'vjudge',
            iconGroup: 'vjudge',
            parsedLabel: 'VJudge CodeForces-1A'
        });
        expect(parseEnhancedLink('https://hydro.ac/d/bzoj/p/1000')).toMatchObject({
            kind: 'hydro',
            iconGroup: 'hydro',
            parsedLabel: 'Hydro 1000'
        });
    });

    it('treats ordinary external http(s) links as external and ignores hashes/relative non-entity paths', () => {
        expect(parseEnhancedLink('https://github.com/laikit-dev/luogu-saver')).toEqual({
            kind: 'external',
            iconGroup: 'external',
            id: '',
            inSitePath: null,
            canonicalHref: 'https://github.com/laikit-dev/luogu-saver',
            parsedLabel: null,
            matchToken: null
        });
        expect(parseEnhancedLink('/unknown/route')).toBeNull();
        expect(parseEnhancedLink('#heading-1')).toBeNull();
        expect(parseEnhancedLink('javascript:alert(1)')).toBeNull();
    });
});

describe('isBareUrlText & shouldAppendAnnotation', () => {
    it('replaces bare URLs only while keeping custom link text intact', () => {
        expect(
            isBareUrlText(
                'https://www.luogu.com.cn/problem/P1000',
                'https://www.luogu.com.cn/problem/P1000'
            )
        ).toBe(true);
        expect(isBareUrlText('/problem/P1000', '/problem/P1000')).toBe(true);
        expect(isBareUrlText('P1000', 'https://www.luogu.com.cn/problem/P1000')).toBe(false);
        expect(isBareUrlText('点这看题', 'https://www.luogu.com.cn/problem/P1000')).toBe(false);
    });

    it('suppresses duplicate annotations when original text already mentions the target token', () => {
        expect(shouldAppendAnnotation('点这看题', '题目 P1000', 'P1000')).toBe(true);
        expect(shouldAppendAnnotation('P1000 题解', '题目 P1000', 'P1000')).toBe(false);
        expect(shouldAppendAnnotation('CF1895G', 'CF 1895G', '1895G')).toBe(false);
    });
});

describe('splitTextWithEnhancedLinks', () => {
    it('splits plain-text URLs cleanly while keeping trailing Chinese and ASCII punctuation outside', () => {
        const segments = splitTextWithEnhancedLinks(
            '看看 https://www.luogu.com.cn/article/abc12345，还有 (https://www.luogu.com.cn/user/1001).'
        );
        expect(segments).toEqual([
            { type: 'text', text: '看看 ' },
            {
                type: 'link',
                rawUrl: 'https://www.luogu.com.cn/article/abc12345',
                trailing: '',
                parsed: parseEnhancedLink('https://www.luogu.com.cn/article/abc12345')
            },
            { type: 'text', text: '，还有 (' },
            {
                type: 'link',
                rawUrl: 'https://www.luogu.com.cn/user/1001',
                trailing: ').',
                parsed: parseEnhancedLink('https://www.luogu.com.cn/user/1001')
            }
        ]);
    });
});
