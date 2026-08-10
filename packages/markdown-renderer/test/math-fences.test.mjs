import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../dist/index.js';

test('recovers from an unclosed display math fence', async () => {
    const html = await renderMarkdown(
        ['normal text', '', '$$', 'inline math: $$ a = b $$', '', 'following text'].join('\n')
    );

    assert.match(html, /<p>\$\$\s+inline math:/);
    assert.match(html, /class="katex"/);
    assert.match(html, /<p>following text<\/p>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('preserves valid display math fences', async () => {
    const html = await renderMarkdown(['$$', 'a = b', '$$'].join('\r\n'));

    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /katex-error/);
});

test('preserves attached content in multiline display math fences', async () => {
    const html = await renderMarkdown(
        [
            '$$\\begin{aligned}a&=\\begin{vmatrix}',
            '    1 & 0 \\\\',
            '    0 & 1',
            '\\end{vmatrix}\\end{aligned}$$'
        ].join('\n')
    );

    assert.match(html, /class="katex-display"/);
    assert.match(html, /<mi>a<\/mi>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('does not normalize attached multiline dollar signs in fenced code', async () => {
    const markdown = ['```text', '$$not math', 'still not math$$', '```'].join('\n');
    const html = await renderMarkdown(markdown);

    assert.match(html, /\$\$not math/);
    assert.match(html, /still not math\$\$/);
    assert.doesNotMatch(html, /class="katex(?:-display)?"/);
});

test('does not join consecutive single-line double-dollar formulas', async () => {
    const html = await renderMarkdown(['$$a = b$$', '', 'between', '', '$$c = d$$'].join('\n'));

    assert.equal((html.match(/class="katex"/g) || []).length, 2);
    assert.equal((html.match(/class="katex-display"/g) || []).length, 2);
    assert.match(html, /<p>between<\/p>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('keeps a prose paragraph with one single-dollar formula inline', async () => {
    const html = await renderMarkdown('connect the given $k$ key points');

    assert.match(html, /^<p>connect the given <span class="katex">/);
    assert.match(html, / key points<\/p>$/);
    assert.doesNotMatch(html, /class="katex-display"/);
});

test('separates inline prose math from a standalone DP formula', async () => {
    const html = await renderMarkdown(
        [
            'connect the given $k$ key points',
            '',
            'define $dp(i,S)$ as the minimum cost',
            '',
            '$$dp(j,S)+w(j,i)\\to dp(i,S)$$',
            '',
            'relax the graph once for every $S$'
        ].join('\n')
    );

    assert.equal((html.match(/class="katex-display"/g) || []).length, 1);
    assert.match(html, /^<p>connect the given <span class="katex">/);
    assert.match(html, /<p>define <span class="katex">/);
    assert.match(html, /<p>relax the graph once for every <span class="katex">/);
    assert.doesNotMatch(html, /katex-error/);
});

test('preserves list indentation around a single-line display formula', async () => {
    const html = await renderMarkdown(
        ['1. item', '', '    $$a = b$$', '', '    following'].join('\n')
    );

    assert.match(html, /<li>[\s\S]*class="katex-display"[\s\S]*<p>following<\/p>[\s\S]*<\/li>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('parses code and links after an unclosed math fence', async () => {
    const html = await renderMarkdown(
        [
            '$$',
            'inline math: $$ x + y $$',
            '',
            '```text',
            '$$',
            '```',
            '',
            '[link](https://example.com)'
        ].join('\n')
    );

    assert.match(html, /class="katex"/);
    assert.match(html, /<pre/);
    assert.match(html, /\$\$/);
    assert.match(html, /<a href="https:\/\/example.com">link<\/a>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('does not treat dollar signs in code blocks as math fences', async () => {
    const html = await renderMarkdown(['```text', '$$', 'not math', '```'].join('\n'));

    assert.match(html, /\$\$/);
    assert.doesNotMatch(html, /class="katex(?:-display)?"/);
});

test('does not use indented code as a closing math fence', async () => {
    const html = await renderMarkdown(
        ['$$', 'text', '', '    $$', '', 'following text'].join('\n')
    );

    assert.match(html, /<pre><code>\$\$/);
    assert.match(html, /<p>following text<\/p>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('recovers multiple unmatched fence widths in one document', async () => {
    const fences = Array.from({ length: 40 }, (_, index) => '$'.repeat(42 - index));
    const html = await renderMarkdown([...fences, '', 'following text'].join('\n'));

    assert.match(html, /<p>following text<\/p>/);
    assert.doesNotMatch(html, /katex-error/);
});

test('recovers an unclosed math fence inside a blockquote', async () => {
    const html = await renderMarkdown(
        ['> $$', '> inline math: $$ a = b $$', '>', '> following text'].join('\n')
    );

    assert.match(html, /<blockquote>/);
    assert.match(html, /class="katex"/);
    assert.match(html, /following text/);
    assert.doesNotMatch(html, /katex-error/);
});

test('preserves valid display math inside a list item', async () => {
    const html = await renderMarkdown(['- $$', '  a = b', '  $$'].join('\n'));

    assert.match(html, /<li>/);
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /katex-error/);
});

test('preserves table merge processing with the normalized source file', async () => {
    const html = await renderMarkdown(
        ['| value | other |', '| --- | --- |', '| top | right |', '| ^ | bottom |'].join('\n')
    );

    assert.match(html, /class="md-table-merged-cell"/);
    assert.match(html, /rowspan="2"/);
    assert.doesNotMatch(html, /<td>\^<\/td>/);
});

// 接下来是测试关于宏定义

test('isolates global macros between render calls', async () => {
    const html1 = await renderMarkdown('$\\gdef\\foo{bar}$');
    const html2 = await renderMarkdown('$\\foo$');
    assert.doesNotMatch(html1, /katex-error/);
    assert.match(html2, /color:#cc0000[^>]*>\\foo</);
});

test('shares global macros across math blocks in the same render and redefines', async () => {
    const html = await renderMarkdown(
        [
            // Inline → Inline
            '$\\gdef\\a{\\alpha} \\a$',
            '$\\a$',
            '',
            // Display → Display
            '$$\\gdef\\b{\\beta} \\b$$',
            '$$\\b$$',
            '',
            // Inline → Display
            '$\\gdef\\c{\\gamma} \\c$',
            '$$\\c$$',
            '',
            // Display → Inline
            '$$\\gdef\\d{\\Delta} \\gdef\\d{\\delta} \\d$$',
            '$\\d$'
        ].join('\n')
    );

    // 确保重定义宏用新的
    assert.match(html, /δ/);
    assert.doesNotMatch(html, /Δ/);
    // 所有四种方向都不应该有 KaTeX 报错
    assert.doesNotMatch(html, /katex-error/);
    // 确认没有未定义的宏被红色高亮
    assert.doesNotMatch(html, /color:#cc0000/);
});
