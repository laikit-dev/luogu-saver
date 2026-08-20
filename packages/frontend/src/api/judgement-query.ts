export interface JudgementQueryParams {
    page?: number;
    limit?: number;
    uid?: number[];
    name?: string;
    reason?: string;
    start_time?: number;
    end_time?: number;
    rev_perm?: number[];
    add_perm?: number[];
    no_perm?: number;
}

export function serializeJudgementParams(params: JudgementQueryParams): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        query.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return query.toString();
}
