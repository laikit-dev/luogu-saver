export type DiffLineKind = 'equal' | 'add' | 'remove';

export interface DiffLine {
    kind: DiffLineKind;
    oldLine: number | null;
    newLine: number | null;
    text: string;
}

export interface LineDiffResult {
    lines: DiffLine[];
    added: number;
    removed: number;
    identical: boolean;
}

export type DisplayDiffItem =
    | { type: 'line'; line: DiffLine }
    | { type: 'collapsed'; id: number; lines: DiffLine[] };

export interface FieldDiffItem {
    label: string;
    before: string;
    after: string;
}

export interface ListDiffResult {
    added: string[];
    removed: string[];
}

const MAX_LCS_CELLS = 2_500_000;

function splitNormalizedLines(text: string): string[] {
    if (!text) return [];
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Computes a line-level diff using prefix/suffix trimming plus flat Int32Array LCS DP.
 * Falls back to block replace when the non-matching core exceeds MAX_LCS_CELLS to keep UI responsive.
 */
export function computeLineDiff(oldText: string, newText: string): LineDiffResult {
    const oldLines = splitNormalizedLines(oldText);
    const newLines = splitNormalizedLines(newText);

    if (oldLines.length === 0 && newLines.length === 0) {
        return { lines: [], added: 0, removed: 0, identical: true };
    }

    let prefix = 0;
    const minLen = Math.min(oldLines.length, newLines.length);
    while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
        prefix += 1;
    }

    let suffix = 0;
    while (
        suffix < minLen - prefix &&
        oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    const lines: DiffLine[] = [];
    for (let i = 0; i < prefix; i++) {
        lines.push({ kind: 'equal', oldLine: i + 1, newLine: i + 1, text: oldLines[i]! });
    }

    const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
    const newMid = newLines.slice(prefix, newLines.length - suffix);
    let added = 0;
    let removed = 0;

    if (oldMid.length === 0 && newMid.length === 0) {
        // Only suffix remains (identical input).
    } else if (oldMid.length === 0) {
        for (let j = 0; j < newMid.length; j++) {
            lines.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, text: newMid[j]! });
            added += 1;
        }
    } else if (newMid.length === 0) {
        for (let i = 0; i < oldMid.length; i++) {
            lines.push({
                kind: 'remove',
                oldLine: prefix + i + 1,
                newLine: null,
                text: oldMid[i]!
            });
            removed += 1;
        }
    } else if (oldMid.length * newMid.length > MAX_LCS_CELLS) {
        for (let i = 0; i < oldMid.length; i++) {
            lines.push({
                kind: 'remove',
                oldLine: prefix + i + 1,
                newLine: null,
                text: oldMid[i]!
            });
            removed += 1;
        }
        for (let j = 0; j < newMid.length; j++) {
            lines.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, text: newMid[j]! });
            added += 1;
        }
    } else {
        const m = oldMid.length;
        const n = newMid.length;
        const cols = n + 1;
        const dp = new Int32Array((m + 1) * cols);

        for (let i = m - 1; i >= 0; i--) {
            const rowOffset = i * cols;
            const nextRowOffset = (i + 1) * cols;
            const oldLine = oldMid[i];
            for (let j = n - 1; j >= 0; j--) {
                if (oldLine === newMid[j]) {
                    dp[rowOffset + j] = dp[nextRowOffset + j + 1]! + 1;
                } else {
                    const down = dp[nextRowOffset + j]!;
                    const right = dp[rowOffset + j + 1]!;
                    dp[rowOffset + j] = down >= right ? down : right;
                }
            }
        }

        let i = 0;
        let j = 0;
        while (i < m && j < n) {
            if (oldMid[i] === newMid[j]) {
                lines.push({
                    kind: 'equal',
                    oldLine: prefix + i + 1,
                    newLine: prefix + j + 1,
                    text: oldMid[i]!
                });
                i += 1;
                j += 1;
            } else if (dp[(i + 1) * cols + j]! >= dp[i * cols + j + 1]!) {
                lines.push({
                    kind: 'remove',
                    oldLine: prefix + i + 1,
                    newLine: null,
                    text: oldMid[i]!
                });
                removed += 1;
                i += 1;
            } else {
                lines.push({
                    kind: 'add',
                    oldLine: null,
                    newLine: prefix + j + 1,
                    text: newMid[j]!
                });
                added += 1;
                j += 1;
            }
        }
        while (i < m) {
            lines.push({
                kind: 'remove',
                oldLine: prefix + i + 1,
                newLine: null,
                text: oldMid[i]!
            });
            removed += 1;
            i += 1;
        }
        while (j < n) {
            lines.push({
                kind: 'add',
                oldLine: null,
                newLine: prefix + j + 1,
                text: newMid[j]!
            });
            added += 1;
            j += 1;
        }
    }

    const oldSuffixStart = oldLines.length - suffix;
    const newSuffixStart = newLines.length - suffix;
    for (let k = 0; k < suffix; k++) {
        lines.push({
            kind: 'equal',
            oldLine: oldSuffixStart + k + 1,
            newLine: newSuffixStart + k + 1,
            text: oldLines[oldSuffixStart + k]!
        });
    }

    return {
        lines,
        added,
        removed,
        identical: added === 0 && removed === 0
    };
}

export function collapseUnchangedLines(
    lines: readonly DiffLine[],
    contextRadius: number = 3
): DisplayDiffItem[] {
    if (lines.length === 0) return [];

    const visible = new Uint8Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.kind !== 'equal') {
            const start = Math.max(0, i - contextRadius);
            const end = Math.min(lines.length - 1, i + contextRadius);
            for (let k = start; k <= end; k++) {
                visible[k] = 1;
            }
        }
    }

    const items: DisplayDiffItem[] = [];
    let collapsedId = 0;
    let i = 0;
    while (i < lines.length) {
        if (visible[i]) {
            items.push({ type: 'line', line: lines[i]! });
            i += 1;
            continue;
        }
        const hidden: DiffLine[] = [];
        while (i < lines.length && !visible[i]) {
            hidden.push(lines[i]!);
            i += 1;
        }
        // Avoid collapsing a tiny 1–2 line gap when a single collapse bar takes the same height.
        if (hidden.length <= 2) {
            for (const line of hidden) {
                items.push({ type: 'line', line });
            }
        } else {
            items.push({ type: 'collapsed', id: collapsedId++, lines: hidden });
        }
    }

    return items;
}

export function computeFieldDiffs(fields: readonly FieldDiffItem[]): FieldDiffItem[] {
    return fields.filter(field => field.before !== field.after);
}

export function computeListDiff(
    oldItems: readonly string[],
    newItems: readonly string[]
): ListDiffResult {
    const oldCounts = new Map<string, number>();
    for (const item of oldItems) {
        oldCounts.set(item, (oldCounts.get(item) ?? 0) + 1);
    }

    const added: string[] = [];
    for (const item of newItems) {
        const remaining = oldCounts.get(item) ?? 0;
        if (remaining > 0) {
            oldCounts.set(item, remaining - 1);
        } else {
            added.push(item);
        }
    }

    const removed: string[] = [];
    for (const [item, remaining] of oldCounts.entries()) {
        for (let i = 0; i < remaining; i++) {
            removed.push(item);
        }
    }

    return { added, removed };
}
