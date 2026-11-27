import { describe, expect, it } from 'vitest';
import {
    isBareOrIdLinkText,
    parseEnhancedLink,
    splitTextWithEnhancedLinks
} from './enhanced-links';

describe('parseEnhancedLink', () => {
    it('parses Luogu and relative user, article, and paste URLs into in-site routes', () => {
        expect(parseEnhancedLink('https://www.luogu.com.cn/user/12345')).toEqual({
            kind: 'user',
            id: '12345',
            numericId: 12345,
            inSitePath: '/user/12345',
            canonicalHref: '/user/12345',
            defaultLabel: '用户 12345'
        });

        expect(parseEnhancedLink('https://luogu.com/space/show?uid=7')).toMatchObject({
            kind: 'user',
            id: '7',
            numericId: 7,
            inSitePath: '/user/7'
        });

        expect(parseEnhancedLink('https://www.luogu.com.cn/article/abc12345?version=2')).toEqual({
            kind: 'article',
            id: 'abc12345',
            inSitePath: '/article/abc12345?version=2',
            canonicalHref: '/article/abc12345?version=2',
            defaultLabel: '文章 abc12345'
        });

        expect(parseEnhancedLink('/paste/pst00001')).toEqual({
            kind: 'paste',
            id: 'pst00001',
            inSitePath: '/paste/pst00001',
            canonicalHref: '/paste/pst00001',
            defaultLabel: '剪贴板 pst00001'
        });
    });

    it('parses Luogu problems, trainings, contests, discussions, teams, and records', () => {
        expect(parseEnhancedLink('/problem/P3372')).toEqual({
            kind: 'problem',
            id: 'P3372',
            inSitePath: null,
            canonicalHref: 'https://www.luogu.com.cn/problem/P3372',
            defaultLabel: 'P3372'
        });

        expect(parseEnhancedLink('https://luogu.com.cn/contest/123456')).toMatchObject({
            kind: 'contest',
            id: '123456',
            defaultLabel: '比赛 #123456'
        });

        expect(parseEnhancedLink('https://www.luogu.com.cn/record/139634319')).toMatchObject({
            kind: 'record',
            id: '139634319',
            defaultLabel: '记录 #139634319'
        });
    });

    it('ignores unsupported external sites, anchor hashes, and non-http schemes', () => {
        expect(parseEnhancedLink('https://example.com/user/123')).toBeNull();
        expect(parseEnhancedLink('#heading-1')).toBeNull();
        expect(parseEnhancedLink('javascript:alert(1)')).toBeNull();
    });
});

describe('isBareOrIdLinkText', () => {
    it('distinguishes bare URLs and raw IDs from custom prose labels', () => {
        const userLink = parseEnhancedLink('https://www.luogu.com.cn/user/42')!;
        expect(
            isBareOrIdLinkText(
                'https://www.luogu.com.cn/user/42',
                'https://www.luogu.com.cn/user/42',
                userLink
            )
        ).toBe(true);
        expect(isBareOrIdLinkText('/user/42', '/user/42', userLink)).toBe(true);
        expect(isBareOrIdLinkText('@42', '/user/42', userLink)).toBe(true);
        expect(isBareOrIdLinkText('作者主页', 'https://www.luogu.com.cn/user/42', userLink)).toBe(
            false
        );
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
