import { User } from '@/entities/user';
import { UserProfileHistory, type ProfileSnapshotData } from '@/entities/user-profile-history';
import { evictCache } from '@/decorators/cache-evict';
import { retryOnTransactionConflict } from '@/utils/db-errors';

export interface ProfileVersionMetadata {
    version: number;
    observedAt: string;
    name: string;
}

export interface ProfileVersionSnapshot {
    version: number;
    observedAt: string;
    profile: ProfileSnapshotData;
}

export class UserProfileHistoryService {
    static async listVersions(uid: number): Promise<{
        versions: ProfileVersionMetadata[];
        latestVersion: number | null;
    } | null> {
        const user = await User.getRepository().findOne({
            where: { id: uid },
            select: { id: true }
        });
        if (!user) return null;

        const rows = await UserProfileHistory.getRepository()
            .createQueryBuilder('history')
            .select('history.version', 'version')
            .addSelect('history.created_at', 'observedAt')
            .addSelect("JSON_UNQUOTE(JSON_EXTRACT(history.snapshot, '$.name'))", 'name')
            .where('history.user_id = :uid', { uid })
            .orderBy('history.version', 'DESC')
            .getRawMany<{ version: number; observedAt: Date | string; name: string }>();
        const versions = rows.map(row => ({
            version: Number(row.version),
            observedAt: new Date(row.observedAt).toISOString(),
            name: row.name
        }));
        return { versions, latestVersion: versions[0]?.version ?? null };
    }

    static async getVersion(uid: number, version: number): Promise<ProfileVersionSnapshot | null> {
        const history = await UserProfileHistory.getRepository().findOne({
            where: { userId: uid, version }
        });
        if (!history) return null;
        return {
            version: history.version,
            observedAt: history.createdAt.toISOString(),
            profile: history.snapshot
        };
    }

    static async getSettings(uid: number): Promise<{ recordingEnabled: boolean } | null> {
        const user = await User.getRepository().findOne({
            where: { id: uid },
            select: { profileHistoryEnabled: true }
        });
        return user ? { recordingEnabled: user.profileHistoryEnabled } : null;
    }

    static async setRecordingEnabled(
        uid: number,
        recordingEnabled: boolean
    ): Promise<{ recordingEnabled: boolean } | null> {
        const result = await retryOnTransactionConflict(() =>
            User.transaction(async manager => {
                const repository = manager.getRepository(User);
                const user = await repository.findOne({
                    where: { id: uid },
                    lock: { mode: 'pessimistic_write' }
                });
                if (!user) return null;
                if (user.profileHistoryEnabled !== recordingEnabled) {
                    await repository.update(uid, { profileHistoryEnabled: recordingEnabled });
                }
                return { recordingEnabled };
            })
        );
        if (result) await evictCache(`user:${uid}`);
        return result;
    }
}
