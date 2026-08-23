import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown as renderNodeMarkdown } from '../dist/index.js';
import { renderMarkdown as renderWorkerMarkdown } from '../dist/worker/index.mjs';

test('worker entry matches the node renderer', async () => {
    const markdown = [
        '# Heading',
        '',
        ':::success[Result]{open}',
        '$x^2$',
        ':::',
        '',
        '```ts',
        'const answer: number = 42;',
        '```',
        '',
        '<img src="x" onerror="globalThis.compromised = true">'
    ].join('\n');

    const [nodeHtml, workerHtml] = await Promise.all([
        renderNodeMarkdown(markdown),
        renderWorkerMarkdown(markdown)
    ]);

    assert.equal(workerHtml, nodeHtml);
    assert.match(workerHtml, /class="shiki/);
    assert.match(workerHtml, /class="katex/);
    assert.doesNotMatch(workerHtml, /onerror/);
});
