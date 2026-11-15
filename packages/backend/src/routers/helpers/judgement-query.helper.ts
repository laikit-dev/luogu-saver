import type { JudgementPaginationQuery, JudgementQuery } from '@/services/judgement.service';

const UINT32_MAX = 0xffff_ffff;

export class JudgementQueryError extends Error {
    status = 400;
}

export function parseJudgementVisibilityUids(value: unknown): number[] {
    if (typeof value !== 'string') {
        throw new JudgementQueryError('uids must be a string');
    }

    const values = value
        .split(/[\r\n,]+/)
        .map(item => item.trim())
        .filter(Boolean);
    if (!values.length) {
        throw new JudgementQueryError('At least one Luogu UID is required');
    }

    const uids: number[] = [];
    const seen = new Set<number>();
    for (const rawUid of values) {
        if (!/^[1-9]\d*$/.test(rawUid)) {
            throw new JudgementQueryError('uids must contain positive Luogu UIDs');
        }
        const uid = Number(rawUid);
        if (!Number.isSafeInteger(uid) || uid > UINT32_MAX) {
            throw new JudgementQueryError('uids is out of range');
        }
        if (!seen.has(uid)) {
            seen.add(uid);
            uids.push(uid);
        }
    }
    return uids;
}

function singleQueryValue(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new JudgementQueryError(`${field} must be a string`);
    return value;
}

function parseInteger(
    value: unknown,
    field: string,
    defaultValue: number,
    maximum?: number
): number {
    const raw = singleQueryValue(value, field);
    if (raw === undefined) return defaultValue;
    if (!/^[1-9]\d*$/.test(raw)) {
        throw new JudgementQueryError(`${field} must be a positive integer`);
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) {
        throw new JudgementQueryError(`${field} is out of range`);
    }
    return parsed;
}

function parseIntegerList(value: unknown, field: string): number[] {
    const raw = singleQueryValue(value, field);
    if (raw === undefined) return [];
    if (!raw || raw.split(',').some(part => !/^[1-9]\d*$/.test(part))) {
        throw new JudgementQueryError(`${field} must contain positive integers`);
    }

    const values = raw.split(',').map(Number);
    if (values.some(item => !Number.isSafeInteger(item) || item > 0xffff_ffff)) {
        throw new JudgementQueryError(`${field} is out of range`);
    }
    return [...new Set(values)];
}

function parseOptionalInteger(value: unknown, field: string, maximum: number): number | undefined {
    const raw = singleQueryValue(value, field);
    if (raw === undefined) return undefined;
    return parseInteger(raw, field, 1, maximum);
}

export function parseJudgementPagination(query: Record<string, unknown>): JudgementPaginationQuery {
    return {
        page: parseInteger(query.page, 'page', 1),
        limit: parseInteger(query.limit, 'limit', 50, 500)
    };
}

export function parseJudgementQuery(query: Record<string, unknown>): JudgementQuery {
    const rawName = singleQueryValue(query.name, 'name');
    const name = rawName?.trim();
    if (name && name.length > 100) throw new JudgementQueryError('name is too long');

    const rawReason = singleQueryValue(query.reason, 'reason');
    const reason = rawReason?.trim();
    if (reason && reason.length > 200) throw new JudgementQueryError('reason is too long');

    const startTime = parseOptionalInteger(query.start_time, 'start_time', UINT32_MAX);
    const endTime = parseOptionalInteger(query.end_time, 'end_time', UINT32_MAX);
    if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
        throw new JudgementQueryError('start_time must not exceed end_time');
    }

    const rawNoPermission = singleQueryValue(query.no_perm, 'no_perm');
    if (rawNoPermission !== undefined && rawNoPermission !== '1') {
        throw new JudgementQueryError('no_perm must equal 1');
    }

    const group = singleQueryValue(query.group, 'group');
    if (group !== undefined && group !== 'card') {
        throw new JudgementQueryError('group must equal card');
    }

    return {
        ...parseJudgementPagination(query),
        uids: parseIntegerList(query.uid, 'uid'),
        name: name || undefined,
        reason: reason || undefined,
        startTime,
        endTime,
        revokedPermissions: parseIntegerList(query.rev_perm, 'rev_perm'),
        addedPermissions: parseIntegerList(query.add_perm, 'add_perm'),
        noPermission: rawNoPermission === '1',
        group
    };
}
