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
    hidden: boolean;
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

export interface JudgementFetchLogItem {
    id: number;
    fetched_at: string;
    record_count: number;
    new_record_count: number;
    skipped_count: number;
    status: 'success' | 'error';
    error_message: string | null;
}

export interface JudgementLogListData {
    items: JudgementFetchLogItem[];
    pagination: PaginationMeta;
}

export interface JudgementStats {
    totalJudgements: number;
    totalFetchLogs: number;
    lastFetchAt: string | null;
    lastFetchStatus: 'success' | 'error' | null;
}

export async function getJudgements(
    params: JudgementQueryParams = {}
): Promise<ApiResponse<JudgementListData>> {
    return (await apiFetch.get('/judgement', {
        params,
        paramsSerializer: { serialize: serializeJudgementParams }
    })) as ApiResponse<JudgementListData>;
}

export async function getJudgementLogs(
    params: Pick<JudgementQueryParams, 'page' | 'limit'> = {}
): Promise<ApiResponse<JudgementLogListData>> {
    return (await apiFetch.get('/judgement/logs', {
        params,
        paramsSerializer: { serialize: serializeJudgementParams }
    })) as ApiResponse<JudgementLogListData>;
}

export async function getJudgementStats(): Promise<ApiResponse<JudgementStats>> {
    return (await apiFetch.get('/judgement/stats')) as ApiResponse<JudgementStats>;
}

export async function hideMyJudgementHistory(): Promise<
    ApiResponse<{ uid: number; hiddenUntil: number }>
> {
    return (await apiFetch.post('/judgement/hide-mine')) as ApiResponse<{
        uid: number;
        hiddenUntil: number;
    }>;
}
