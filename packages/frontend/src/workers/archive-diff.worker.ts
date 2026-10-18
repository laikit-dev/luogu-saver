import { diffLines } from 'diff';
import type {
    ArchiveDiffLine,
    ArchiveDiffRequest,
    ArchiveDiffResponse,
    ArchiveDiffResult
} from './archive-diff.types';

type ArchiveDiffWorkerScope = {
    addEventListener(
        type: 'message',
        listener: (event: MessageEvent<ArchiveDiffRequest>) => void
    ): void;
    postMessage(message: ArchiveDiffResponse): void;
};

const workerScope = self as unknown as ArchiveDiffWorkerScope;

workerScope.addEventListener('message', event => {
    const { id, before, after } = event.data;
    try {
        const result: ArchiveDiffResult = {
            identical: before === after,
            added: 0,
            removed: 0,
            rows: []
        };
        if (!result.identical) {
            const changes = diffLines(before, after);
            let beforeLine = 1;
            let afterLine = 1;
            for (let index = 0; index < changes.length; index++) {
                const change = changes[index]!;
                const kind = change.added ? 'added' : change.removed ? 'removed' : 'context';
                const sourceLines = change.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
                const lines: ArchiveDiffLine[] = sourceLines.map(source => {
                    const ending = source.endsWith('\r\n')
                        ? 'CRLF'
                        : source.endsWith('\n')
                          ? 'LF'
                          : 'none';
                    return {
                        kind,
                        text:
                            ending === 'CRLF'
                                ? source.slice(0, -2)
                                : ending === 'LF'
                                  ? source.slice(0, -1)
                                  : source,
                        beforeLine: kind === 'added' ? null : beforeLine++,
                        afterLine: kind === 'removed' ? null : afterLine++,
                        ending
                    };
                });
                if (kind === 'added') result.added += lines.length;
                if (kind === 'removed') result.removed += lines.length;
                if (kind === 'context' && lines.length > 8) {
                    const leading = index === 0 ? 0 : 3;
                    const trailing = index === changes.length - 1 ? 0 : 3;
                    for (const line of lines.slice(0, leading)) result.rows.push(line);
                    result.rows.push({
                        kind: 'collapsed',
                        lines: lines.slice(leading, lines.length - trailing)
                    });
                    for (const line of lines.slice(lines.length - trailing)) {
                        result.rows.push(line);
                    }
                } else {
                    for (const line of lines) result.rows.push(line);
                }
            }
        }
        workerScope.postMessage({ id, result });
    } catch {
        workerScope.postMessage({ id, error: 'calculation-failed' });
    }
});
