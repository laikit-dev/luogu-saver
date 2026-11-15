import type { JudgementRecord } from '@/entities/judgement-record';
import type { JudgementPaginationQuery } from '@/services/judgement.service';

export function paginateJudgementCards(
    records: Pick<JudgementRecord, 'id' | 'reason' | 'revokedPermission' | 'addedPermission'>[],
    query: JudgementPaginationQuery
): { ids: number[]; total: number } {
    const groups = new Map<string, number>();
    const ids: number[] = [];
    const start = (query.page - 1) * query.limit;
    const end = start + query.limit;
    for (const record of records) {
        const key = JSON.stringify([
            record.revokedPermission,
            record.addedPermission,
            record.reason
        ]);
        let index = groups.get(key);
        if (index === undefined) {
            index = groups.size;
            groups.set(key, index);
        }
        if (index >= start && index < end) ids.push(record.id);
    }
    return { ids, total: groups.size };
}
