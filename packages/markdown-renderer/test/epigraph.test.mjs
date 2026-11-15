import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../dist/index.js';

test('preserves an emphasized epigraph attribution without duplicating its dash prefix', async () => {
    const html = await renderMarkdown(':::epigraph[*——某同学*]\n*那只不过是你的幻想罢了。*\n:::');
    assert.match(html, /class="epigraph-body">\s*<p><em>那只不过是你的幻想罢了。<\/em><\/p>/);
    assert.match(html, /class="epigraph-author"><em>——某同学<\/em><\/span>/);
    assert.equal(html.split('某同学').length - 1, 1);
});

test('renders inline Markdown in the attribution through the normal sanitization pipeline', async () => {
    const html = await renderMarkdown(
        ':::epigraph[**某同学** 与 `code` 和 [链接](https://example.com)]\n正文\n:::'
    );
    assert.match(html, /class="epigraph-author">——<strong>某同学<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<a href="https:\/\/example.com">链接<\/a>/);
});

test('uses a literal author attribute in preference to the label', async () => {
    const html = await renderMarkdown(':::epigraph[不应显示]{author="<em>作者</em>"}\n正文\n:::');
    assert.doesNotMatch(html, /不应显示/);
    assert.match(html, /class="epigraph-author">——&#x3C;em>作者&#x3C;\/em>/);
});

test('supports plain attribution and omits missing attribution', async () => {
    const html = await renderMarkdown(':::epigraph[某同学]\n正文\n:::');
    assert.match(html, /class="epigraph-author">——某同学<\/span>/);
    const withoutAuthor = await renderMarkdown(':::epigraph\n正文\n:::');
    assert.match(withoutAuthor, /class="epigraph-body"/);
    assert.doesNotMatch(withoutAuthor, /epigraph-author/);
});
