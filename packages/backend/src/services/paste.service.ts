import { Cacheable } from '@/decorators/cacheable';
import { Paste } from '@/entities/paste';
import { CacheEvict } from '@/decorators/cache-evict';
import { EntityManager } from 'typeorm';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import { markContentChecked, saveHashedContent } from '@/services/helpers/hashed-content.helper';
import { backfillPublishTime, normalizePublishTime } from '@/services/helpers/publish-time.helper';
import type { Paste as LuoguPaste } from '@/types/luogu-api';
import { retryOnTransactionConflict } from '@/utils/db-errors';

export class PasteService {
    @Cacheable(600, id => `paste:${id}`, Paste)
    static async getPasteById(id: string, manager?: EntityManager): Promise<Paste | null> {
        return await getServiceRepository<Paste>(Paste, manager).findOne({
            where: { id },
            relations: ['author']
        });
    }

    @Cacheable(600, () => 'paste:count')
    static async getPasteCount(manager?: EntityManager): Promise<number> {
        return await getServiceRepository<Paste>(Paste, manager).count({
            where: { deleted: false }
        });
    }

    static async getPasteByIdWithoutCache(id: string): Promise<Paste | null> {
        return await this.getPasteById(id, Paste.getRepository().manager);
    }

    @CacheEvict((paste: Paste) => [`paste:${paste.id}`, `paste:count`])
    static async savePaste(paste: Paste, manager?: EntityManager): Promise<Paste> {
        return await getServiceRepository<Paste>(Paste, manager).save(paste);
    }

    @CacheEvict((paste: LuoguPaste) => [`paste:${paste.id}`, `paste:count`])
    static async saveLuoguPaste(
        data: LuoguPaste,
        forceUpdate: boolean = false
    ): Promise<{ skipped: boolean; content: string }> {
        const publishTime = normalizePublishTime(data.time);
        return retryOnTransactionConflict(() =>
            Paste.transaction(async manager => {
                const checkedAt = new Date();
                const saveResult = await saveHashedContent<Paste>({
                    manager,
                    entity: Paste,
                    id: data.id,
                    content: data.data,
                    forceUpdate,
                    incomingData: {
                        authorId: data.user.uid,
                        checkedAt,
                        // Omitted rather than written as null: an unusable `time` must not
                        // erase a publish time an earlier payload already delivered.
                        ...(publishTime === null ? {} : { publishTime })
                    },
                    defaults: {
                        deleted: false
                    }
                });

                if (saveResult.skipped) {
                    await backfillPublishTime(manager, Paste, data.id, data.time);
                    await markContentChecked(manager, Paste, data.id, checkedAt);
                    return { skipped: true, content: '' };
                }

                return { skipped: false, content: saveResult.entity.content };
            })
        );
    }
}
