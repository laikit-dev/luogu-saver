import { describe, expect, it } from 'vitest';
import { paginateJudgementCards } from '../src/services/helpers/judgement-card.helper';
import { parseJudgementQuery } from '../src/routers/helpers/judgement-query.helper';

const record = {
    id: 1,
    uid: 1,
    time: 100,
    reason: 'Reason',
    revokedPermission: 65536,
    addedPermission: 0
};

describe('judgement card pagination', () => {
    it('keeps a group larger than the page size together across interleaved records', () => {
        const records = [
            record,
            { ...record, id: 2, reason: 'Other' },
            ...Array.from({ length: 60 }, (_, i) => ({ ...record, id: i + 3, uid: i + 3 }))
        ];
        expect(paginateJudgementCards(records, { page: 1, limit: 1 })).toEqual({
            ids: [1, ...Array.from({ length: 60 }, (_, i) => i + 3)],
            total: 2
        });
        expect(paginateJudgementCards(records, { page: 2, limit: 1 })).toEqual({
            ids: [2],
            total: 2
        });
        expect(paginateJudgementCards(records, { page: 3, limit: 1 })).toEqual({
            ids: [],
            total: 2
        });
    });

    it('compares exact reasons and both masks', () => {
        const records = [
            record,
            { ...record, id: 2, reason: 'reason' },
            { ...record, id: 3, reason: 'Reason ' },
            { ...record, id: 4, reason: null },
            { ...record, id: 5, reason: '' },
            { ...record, id: 6, revokedPermission: 0 },
            { ...record, id: 7, addedPermission: 1 },
            { ...record, id: 10, uid: 8, time: 101 }
        ];
        const result = paginateJudgementCards(records, { page: 1, limit: 1 });
        expect(result).toEqual({ ids: [1, 10], total: 7 });
        expect(paginateJudgementCards([], { page: 1, limit: 50 })).toEqual({
            ids: [],
            total: 0
        });
    });

    it('validates the optional grouping mode without changing the default', () => {
        expect(parseJudgementQuery({}).group).toBeUndefined();
        expect(parseJudgementQuery({ group: 'card' }).group).toBe('card');
        for (const group of ['', 'table', ['card'], '1']) {
            expect(() => parseJudgementQuery({ group })).toThrow('group');
        }
    });
});
