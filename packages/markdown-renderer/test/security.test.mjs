import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../dist/index.js';

test('wraps only real table elements and never breaks out of attributes containing <table>', async () => {
    const md = [
        '<a href="https://example.com/<table>">link</a>',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |'
    ].join('\n');

    const html = await renderMarkdown(md);
    assert.match(html, /<a href="https:\/\/example\.com\/<table>">link<\/a>/);
    assert.doesNotMatch(html, /href="[^"]*table-container/);
    assert.match(html, /<div class="table-container"><table>/);
});

test('strips user-supplied iframes while allowing validated post-sanitize bilibili embeds', async () => {
    const rawIframes = await renderMarkdown(
        '<iframe src="https://example.com"></iframe>\n<iframe src="/auth/callback?code=abc"></iframe>'
    );
    assert.doesNotMatch(rawIframes, /<iframe\b/i);

    const validBilibili = await renderMarkdown('![](bilibili:BV1xx411c7mD?page=2&t=30)');
    assert.match(validBilibili, /<div class="bilibili-video-container"><iframe\b/);
    assert.match(
        validBilibili,
        /src="https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV1xx411c7mD(?:&amp;|&#x26;)page=2(?:&amp;|&#x26;)t=30(?:&amp;|&#x26;)high_quality=1(?:&amp;|&#x26;)autoplay=0"/
    );
    assert.match(validBilibili, /sandbox="allow-scripts allow-same-origin allow-presentation"/);
    assert.match(validBilibili, /referrerpolicy="no-referrer"/);

    const invalidBilibili = await renderMarkdown('![](bilibili:not-a-valid-id?page=1)');
    assert.doesNotMatch(invalidBilibili, /<iframe\b/i);
});

test('strips inline style, arbitrary classes, arbitrary data-* attributes, and raw math tags', async () => {
    const html = await renderMarkdown(
        [
            '<div style="position:fixed;inset:0" class="math-inline evil" data-custom="x">a+b</div>',
            '<span style="color:red" class="evil">text</span>',
            '<math><mi>x</mi></math>',
            '',
            'Inline math $a+b$ still renders.'
        ].join('\n')
    );

    assert.doesNotMatch(html, /position:fixed/i);
    assert.doesNotMatch(html, /color:red/i);
    assert.doesNotMatch(html, /data-custom/i);
    assert.doesNotMatch(html, /class="[^"]*evil/);
    // User div with class="math-inline" must not trigger KaTeX, while $a+b$ must.
    assert.match(html, /<div(?:\s+class="")?>a\+b<\/div>/);
    assert.match(html, /class="katex"/);
});

test('normalizes unknown align directive values and ignores Object.prototype language names', async () => {
    const alignHtml = await renderMarkdown(':::align{evil-class}\nhi\n:::');
    assert.match(alignHtml, /<div class="md-align-center">/);

    const protoLangHtml = await renderMarkdown('```constructor\nplain text\n```');
    assert.match(protoLangHtml, /plain text/);
});
