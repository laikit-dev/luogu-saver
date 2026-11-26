import { describe, expect, it } from 'vitest';
import {
    collapseUnchangedLines,
    computeFieldDiffs,
    computeLineDiff,
    computeListDiff
} from './version-diff';

describe('version-diff utilities', () => {
    it('detects identical, added, removed, and modified lines accurately', () => {
        expect(computeLineDiff('a\nb', 'a\nb')).toMatchObject({
            added: 0,
            removed: 0,
            identical: true
        });

        const diff = computeLineDiff('line1\nold\nline3', 'line1\nnew1\nnew2\nline3');
        expect(diff.identical).toBe(false);
        expect(diff.removed).toBe(1);
        expect(diff.added).toBe(2);
        expect(diff.lines.map(line => `${line.kind}:${line.text}`)).toEqual([
            'equal:line1',
            'remove:old',
            'add:new1',
            'add:new2',
            'equal:line3'
        ]);
    });

    it('collapses long unchanged spans while keeping context around edits', () => {
        const oldLines = Array.from({ length: 15 }, (_, i) => `L${i + 1}`);
        const newLines = [...oldLines];
        newLines[7] = 'L8-edited';

        const diff = computeLineDiff(oldLines.join('\n'), newLines.join('\n'));
        const items = collapseUnchangedLines(diff.lines, 2);
        const collapsed = items.filter(item => item.type === 'collapsed');
        expect(collapsed).toHaveLength(2);
        expect(collapsed[0]?.type === 'collapsed' && collapsed[0].lines.length).toBe(5);
        expect(collapsed[1]?.type === 'collapsed' && collapsed[1].lines.length).toBe(5);
    });

    it('computes field and multiset list diffs for profile snapshots', () => {
        expect(
            computeFieldDiffs([
                { label: '用户名', before: 'Alice', after: 'Bob' },
                { label: '名字颜色', before: 'Red', after: 'Red' }
            ])
        ).toEqual([{ label: '用户名', before: 'Alice', after: 'Bob' }]);

        expect(
            computeListDiff(
                ['[2024] NOIP 一等奖', '[2023] CSP-S 一等奖'],
                ['[2024] NOIP 一等奖', '[2025] NOI 银牌']
            )
        ).toEqual({
            added: ['[2025] NOI 银牌'],
            removed: ['[2023] CSP-S 一等奖']
        });
    });
});
