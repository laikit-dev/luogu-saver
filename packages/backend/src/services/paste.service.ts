import { Cacheable } from '@/decorators/cacheable';
import { Paste } from '@/entities/paste';
import { CacheEvict } from '@/decorators/cache-evict';
import { EntityManager } from 'typeorm';
import {
    findOneServiceEntity,
    getServiceRepository,
    saveServiceEntity
} from '@/services/helpers/repository.helper';
import { saveHashedContent } from '@/services/helpers/hashed-content.helper';
import type { Paste as LuoguPaste } from '@/types/luogu-api';
import { retryOnTransactionConflict } from '@/utils/db-errors';

export class PasteService {
    @Cacheable(600, id => `paste:${id}`, Paste)
    static async getPasteById(id: string, manager?: EntityManager): Promise<Paste | null> {
        return await findOneServiceEntity<Paste>(
            Paste,
            { where: { id }, relations: ['author'] },
            manager
        );
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
        return await saveServiceEntity<Paste>(Paste, paste, manager);
    }

    @CacheEvict((paste: LuoguPaste) => [`paste:${paste.id}`, `paste:count`])
    static async saveLuoguPaste(
        data: LuoguPaste,
        forceUpdate: boolean = false
    ): Promise<{ skipped: boolean; content: string }> {
        return retryOnTransactionConflict(() =>
            Paste.transaction(async manager => {
                const saveResult = await saveHashedContent<Paste>({
                    manager,
                    entity: Paste,
                    id: data.id,
                    content: data.data,
                    forceUpdate,
                    incomingData: {
                        authorId: data.user.uid,
                        publishTime: data.time
                    },
                    defaults: {
                        deleted: false
                    }
                });

                if (saveResult.skipped || !saveResult.entity) {
                    return { skipped: true, content: '' };
                }

                return { skipped: false, content: saveResult.entity.content };
            })
        );
    }
}
