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

test('supports selectable light and dark Shiki themes with safe fallback', async () => {
    const md = '```cpp\nconst int N = 1e5;\n```';
    const defaultHtml = await renderMarkdown(md);
    const oneDarkHtml = await renderMarkdown(md, {
        codeThemes: { light: 'one-light', dark: 'one-dark-pro' }
    });
    const fallbackHtml = await renderMarkdown(md, {
        codeThemes: { light: 'non-existent-theme', dark: 'invalid-dark' }
    });

    assert.notEqual(oneDarkHtml, defaultHtml);
    assert.match(oneDarkHtml, /one-dark-pro/);
    assert.match(oneDarkHtml, /--shiki-dark-bg:#282c34/i);
    assert.match(oneDarkHtml, /--shiki-light-bg:#FAFAFA/i);
    assert.equal(fallbackHtml, defaultHtml);
});

test('highlights all supported languages and aliases with JS regex engine', async () => {
    const samples = [
        ['bash', 'echo "hello" && ls -la'],
        ['c', '#include <stdio.h>\nint main(void) { return 0; }'],
        ['cpp', '#include <vector>\nint main() { std::vector<int> a{1, 2}; return 0; }'],
        ['css', '.card { color: #3b82f6; margin: 12px; }'],
        ['go', 'package main\nfunc main() { println("hi") }'],
        ['html', '<div class="box"><span>Hello</span></div>'],
        ['java', 'public class Main { public static void main(String[] args) {} }'],
        ['javascript', 'export const add = (a, b) => a + b;'],
        ['json', '{"name": "luogu-saver", "count": 42, "ok": true}'],
        ['markdown', '# Title\n\n- **Bold** item with `code`'],
        ['python', 'def fib(n: int) -> int:\n    return n if n <= 1 else fib(n - 1) + fib(n - 2)'],
        ['rust', 'fn main() { let x: i32 = 42; println!("{x}"); }'],
        ['typescript', 'interface User { id: number; name: string; }'],
        [
            'vue',
            '<template><div :title="msg">{{ msg }}</div></template>\n<script setup lang="ts">\nconst msg = "hi";\n</script>'
        ],
        ['yaml', 'name: ci-build\non:\n  push:\n    branches: [master]'],
        ['c++', 'int main() { return 0; }'],
        ['py', 'print(sum(range(10)))'],
        ['ts', 'type Id = string | number;'],
        ['js', 'const arr = [1, 2, 3].map(x => x * 2);'],
        ['sh', 'export PATH="$HOME/bin:$PATH"'],
        ['yml', 'enabled: true\nport: 3000'],
        ['rs', 'pub struct Point { pub x: f64, pub y: f64 }'],
        ['md', '> Quote with [link](https://example.com)']
    ];

    for (const [lang, code] of samples) {
        const html = await renderMarkdown(`\`\`\`${lang}\n${code}\n\`\`\``);
        assert.match(html, /class="shiki\b/, `Expected shiki class for language "${lang}"`);
        assert.match(html, /--shiki-light:/, `Expected light token styles for "${lang}"`);
        assert.match(html, /--shiki-dark:/, `Expected dark token styles for "${lang}"`);
    }
});

test('loads and renders all 16 selectable Shiki themes cleanly', async () => {
    const themes = [
        'github-light',
        'github-dark',
        'one-light',
        'one-dark-pro',
        'vitesse-light',
        'vitesse-dark',
        'catppuccin-latte',
        'catppuccin-mocha',
        'tokyo-night',
        'nord',
        'dracula',
        'gruvbox-light-medium',
        'gruvbox-dark-medium',
        'solarized-light',
        'solarized-dark',
        'monokai'
    ];
    const md = '```cpp\nint main() { return 42; }\n```';

    for (let i = 0; i < themes.length; i += 2) {
        const light = themes[i];
        const dark = themes[i + 1];
        const html = await renderMarkdown(md, { codeThemes: { light, dark } });
        assert.match(html, new RegExp(light), `Expected theme "${light}" in output`);
        assert.match(html, new RegExp(dark), `Expected theme "${dark}" in output`);
        assert.match(html, /--shiki-light-bg:/);
        assert.match(html, /--shiki-dark-bg:/);
    }
});
