import type { UserPrize } from '@/entities/user';
import type { ProfileSnapshotData } from '@/entities/user-profile-history';

/**
 * Normalizes public profile values into the retained snapshot shape: exactly the snapshot fields,
 * missing levels as 0, empty slogan/introduction as null, missing prizes as [], and each prize
 * reduced to its public fields. Key order is fixed, so equal snapshots serialize identically.
 */
export function toProfileSnapshot(
    data: Omit<ProfileSnapshotData, 'prizes'> & { prizes: UserPrize[] | null }
): ProfileSnapshotData {
    return {
        id: data.id,
        name: data.name,
        color: data.color,
        ccfLevel: data.ccfLevel ?? 0,
        xcpcLevel: data.xcpcLevel ?? 0,
        slogan: data.slogan || null,
        introduction: data.introduction || null,
        prizes: (data.prizes ?? []).map(prize => ({
            year: prize.year,
            contest: prize.contest,
            event: prize.event ?? null,
            prize: prize.prize,
            ...(prize.score !== undefined ? { score: prize.score } : {}),
            ...(prize.rank !== undefined ? { rank: prize.rank } : {})
        }))
    };
}
