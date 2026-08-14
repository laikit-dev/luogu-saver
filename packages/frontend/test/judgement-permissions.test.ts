import { describe, expect, it } from 'vitest';
import { getJudgementPermissionNames } from '../src/utils/judgement';

describe('judgement permission names', () => {
    it('expands every known bit in a permission mask', () => {
        expect(getJudgementPermissionNames(64 | 32768)).toEqual(['秩序管理', '自由发言']);
    });

    it('returns an explicit fallback for an unknown mask', () => {
        expect(getJudgementPermissionNames(1024)).toEqual(['未知权限 (1024)']);
    });

    it('returns no labels for an empty mask', () => {
        expect(getJudgementPermissionNames(0)).toEqual([]);
    });
});
