import type { UserSummary } from '@/types/luogu-api';
import { User } from '@/entities/user';
import { UserColor } from '@/shared/user';
import type { LuoguHttpError } from '@/utils/fetch';

export function buildUser(user: UserSummary): Partial<User> {
    return {
        id: user.uid,
        name: user.name,
        color: user.color as UserColor,
        ccfLevel: user.ccfLevel ?? 0,
        xcpcLevel: user.xcpcLevel ?? 0,
        badge: user.badge
    };
}

function formatLuoguStatusError(resourceLabel: string, status: number): string {
    if (status === 401) {
        return `${resourceLabel}未公开或无权访问`;
    }
    if (status === 403) {
        return '访问被拒绝';
    }
    if (status === 429) {
        return '请求过于频繁，请稍后重试';
    }
    return `获取${resourceLabel}失败`;
}

export function formatLuoguHttpError(resourceLabel: string, error: LuoguHttpError): string {
    return formatLuoguStatusError(resourceLabel, error.status);
}

export function formatMissingLuoguResourceError(resourceLabel: string, response: unknown): string {
    const record =
        response && typeof response === 'object' ? (response as Record<string, unknown>) : null;
    const data =
        record?.data && typeof record.data === 'object'
            ? (record.data as Record<string, unknown>)
            : null;
    const rawCode =
        typeof data?.errorCode === 'number' && Number.isFinite(data.errorCode)
            ? data.errorCode
            : typeof record?.status === 'number' && Number.isFinite(record.status)
              ? record.status
              : null;

    if (rawCode === 404 || rawCode === null || rawCode < 400) {
        return `${resourceLabel}不存在`;
    }
    return formatLuoguStatusError(resourceLabel, rawCode);
}
