import { describe, expect, it } from 'vitest';
import {
    createJudgementDedupKey,
    escapeLikeLiteral,
    LuoguJudgementResponseSchema,
    parseJudgementQuery
} from '../src/shared/judgement';

describe('judgement domain helpers', () => {
    it('creates stable keys and normalizes an absent reason', () => {
        const base = {
            uid: 42,
            time: 1_700_000_000,
            revokedPermission: 64,
            addedPermission: 0
        };
        expect(createJudgementDedupKey(base)).toBe(
            createJudgementDedupKey({ ...base, reason: null })
        );
        expect(createJudgementDedupKey(base)).not.toBe(
            createJudgementDedupKey({ ...base, reason: 'different' })
        );
    });

    it('parses strict filters and removes duplicate masks', () => {
        expect(
            parseJudgementQuery({
                page: '2',
                limit: '100',
                uid: '3,3,7',
                name: '  a%b_!  ',
                rev_perm: '64,32768',
                no_perm: '1'
            })
        ).toEqual({
            page: 2,
            limit: 100,
            uids: [3, 7],
            name: 'a%b_!',
            revokedPermissions: [64, 32768],
            addedPermissions: [],
            noPermission: true
        });
        expect(escapeLikeLiteral('a%b_!')).toBe('a!%b!_!!');
    });

    it('rejects permissive numeric forms', () => {
        expect(() => parseJudgementQuery({ page: '1.5' })).toThrow();
        expect(() => parseJudgementQuery({ limit: '501' })).toThrow();
        expect(() => parseJudgementQuery({ uid: '1,,2' })).toThrow();
        expect(() => parseJudgementQuery({ no_perm: 'true' })).toThrow();
    });

    it('validates required upstream fields while preserving snapshots', () => {
        const parsed = LuoguJudgementResponseSchema.parse({
            logs: [
                {
                    user: { uid: 1, name: 'user', color: 'Blue' },
                    reason: null,
                    revokedPermission: 0,
                    addedPermission: 64,
                    time: 1_700_000_000,
                    extra: 'preserved'
                }
            ]
        });
        expect(parsed.logs[0].user.color).toBe('Blue');
        expect(parsed.logs[0].extra).toBe('preserved');
    });

    it('rejects upstream values that cannot fit unsigned database columns', () => {
        const record = {
            user: { uid: 1, name: 'user' },
            revokedPermission: 0,
            addedPermission: 0,
            time: 1_700_000_000
        };
        expect(() =>
            LuoguJudgementResponseSchema.parse({
                logs: [{ ...record, user: { ...record.user, uid: 0x1_0000_0000 } }]
            })
        ).toThrow();
        expect(() =>
            LuoguJudgementResponseSchema.parse({
                logs: [{ ...record, addedPermission: 0x1_0000_0000 }]
            })
        ).toThrow();
        expect(() =>
            LuoguJudgementResponseSchema.parse({
                logs: [{ ...record, time: 0x1_0000_0000 }]
            })
        ).toThrow();
    });
});
