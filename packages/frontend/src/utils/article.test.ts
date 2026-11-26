import { describe, expect, it } from 'vitest';
import { hasMarkdownHeadings } from './article';

describe('hasMarkdownHeadings', () => {
    it('detects ATX, setext, and HTML headings', () => {
        expect(hasMarkdownHeadings('# Title\n\nBody')).toBe(true);
        expect(hasMarkdownHeadings('   ### Section 3')).toBe(true);
        expect(hasMarkdownHeadings('Heading\n---')).toBe(true);
        expect(hasMarkdownHeadings('<h2>Section</h2>')).toBe(true);
    });

    it('ignores hash comments and underlines inside fenced code blocks', () => {
        expect(
            hasMarkdownHeadings('```cpp\n#include <iostream>\n// ---\n```\n\n普通正文内容')
        ).toBe(false);
        expect(hasMarkdownHeadings('~~~\n# python comment\n~~~\n')).toBe(false);
        expect(hasMarkdownHeadings('没有标题的短文\n\n只有正文段落。')).toBe(false);
    });
});
