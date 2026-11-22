import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../dist/index.js';

function getLineClasses(html) {
    return [...html.matchAll(/<span class="(line(?:\s+[^"]*)?)">/g)].map(match => match[1]);
}

test('highlights individual lines and inclusive ranges for Shiki code blocks', async () => {
    const md = [
        '```cpp lines=1,2,3-5,7',
        'int a = 1;',
        'int b = 2;',
        'int c = 3;',
        'int d = 4;',
        'int e = 5;',
        'int f = 6;',
        'int g = 7;',
        'int h = 8;',
        '```'
    ].join('\n');

    const html = await renderMarkdown(md);
    assert.deepEqual(getLineClasses(html), [
        'line highlighted',
        'line highlighted',
        'line highlighted',
        'line highlighted',
        'line highlighted',
        'line',
        'line highlighted',
        'line'
    ]);
    assert.doesNotMatch(html, /data-highlight-lines/);
});

test('supports quoted lines values, spaces, and sibling fence metadata', async () => {
    const md = [
        '```python title="demo.py" lines="1, 3-4" extra',
        'x = 1',
        'y = 2',
        'z = 3',
        'w = 4',
        '```'
    ].join('\n');

    const html = await renderMarkdown(md);
    assert.deepEqual(getLineClasses(html), [
        'line highlighted',
        'line',
        'line highlighted',
        'line highlighted'
    ]);
});

test('supports lines= on unlabeled fenced code blocks', async () => {
    const md = ['```lines=1,3', 'int x = 1;', 'int y = 2;', 'int z = 3;', '```'].join('\n');

    const html = await renderMarkdown(md);
    assert.match(html, /class="shiki\b/);
    assert.deepEqual(getLineClasses(html), ['line highlighted', 'line', 'line highlighted']);
});

test('supports lines= on special plaintext and unknown languages', async () => {
    const textHtml = await renderMarkdown('```text lines=2\nalpha\nbeta\ngamma\n```');
    assert.deepEqual(getLineClasses(textHtml), ['line', 'line highlighted', 'line']);

    const unknownHtml = await renderMarkdown('```unknownlang lines=1,3\nfoo\nbar\nbaz\n```');
    assert.deepEqual(getLineClasses(unknownHtml), ['line highlighted', 'line', 'line highlighted']);
    assert.doesNotMatch(unknownHtml, /data-highlight-lines/);
});

test('ignores invalid entries, out-of-range lines, and huge upper bounds safely', async () => {
    const md = [
        '```cpp lines=0,-2,5-3,abc,2,99,3-999999999',
        'int a = 1;',
        'int b = 2;',
        'int c = 3;',
        '```'
    ].join('\n');

    const html = await renderMarkdown(md);
    assert.deepEqual(getLineClasses(html), ['line', 'line highlighted', 'line highlighted']);
});
