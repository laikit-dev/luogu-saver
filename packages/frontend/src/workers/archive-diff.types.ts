export interface ArchiveDiffRequest {
    id: number;
    before: string;
    after: string;
}

export interface ArchiveDiffLine {
    kind: 'context' | 'added' | 'removed';
    text: string;
    beforeLine: number | null;
    afterLine: number | null;
    ending: 'LF' | 'CRLF' | 'none';
}

export interface ArchiveDiffGap {
    kind: 'collapsed';
    lines: ArchiveDiffLine[];
}

export interface ArchiveDiffResult {
    identical: boolean;
    added: number;
    removed: number;
    rows: (ArchiveDiffLine | ArchiveDiffGap)[];
}

export type ArchiveDiffResponse =
    | { id: number; result: ArchiveDiffResult }
    | { id: number; error: 'calculation-failed' };
