import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import { serializeJudgementParams, type JudgementQueryParams } from '@/api/judgement-query.ts';

export interface JudgementItem {
    id: number;
    uid: number;
    name: string;
    reason: string | null;
    revoked_permission: number;
    added_permission: number;
    time: number;
    user: JudgementUser;
    fetch_log_id: number;
    log_fetched_at: string | null;
    created_at: string;
}

export interface JudgementUser {
    color?: string;
    badge?: string;
    ccfLevel?: number;
    xcpcLevel?: number;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface JudgementListData {
    items: JudgementItem[];
    pagination: PaginationMeta;
}

export async function getJudgements(
    params: JudgementQueryParams = {},
    signal?: AbortSignal
): Promise<ApiResponse<JudgementListData>> {
    return (await apiFetch.get('/judgement', {
        params,
        paramsSerializer: { serialize: serializeJudgementParams },
        signal
    })) as ApiResponse<JudgementListData>;
}
