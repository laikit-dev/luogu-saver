import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../dist/index.js';

test('renders the right-hand rowspan in the cute table from issue #96', async () => {
    const html = await renderMarkdown(
        ['::cute-table{tuack}', '|1|2|', '|:-:|:-:|', '|1|2|', '|3|^|'].join('\n')
    );

    assert.match(html, /<table class="cute-table">/);
    assert.match(html, /<td\b(?=[^>]*\browspan="2")[^>]*>2<\/td>/);
    assert.match(html, /<tr>\s*<td align="center">3<\/td>\s*<\/tr>/);
});
