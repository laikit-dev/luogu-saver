import { createHash } from 'crypto';
import {
    DeepPartial,
    EntityManager,
    EntityTarget,
    FindOptionsSelect,
    FindOptionsWhere,
    ObjectLiteral,
    QueryDeepPartialEntity
} from 'typeorm';
import { isDuplicateKeyError } from '@/utils/db-errors';

type HashedContentEntity = ObjectLiteral & {
    id: string;
    content: string;
    contentHash?: string;
};

type SaveHashedContentOptions<TEntity extends HashedContentEntity> = {
    manager: EntityManager;
    entity: EntityTarget<TEntity>;
    id: string;
    content: string;
    forceUpdate?: boolean;
    incomingData: DeepPartial<TEntity>;
    defaults?: DeepPartial<TEntity>;
    isUnchanged?: (entity: TEntity, hash: string) => boolean;
    comparisonFields?: Array<keyof TEntity>;
};

/**
 * Records that an unchanged archived document was compared with Luogu at `checkedAt`.
 *
 * Assigning the update date column to itself suppresses the `= CURRENT_TIMESTAMP` that
 * UpdateQueryBuilder appends otherwise: a comparison that found no change is not an update of the
 * archived document and must not reorder listings sorted by `updated_at`.
 */
export async function markContentChecked(
    manager: EntityManager,
    entity: EntityTarget<ObjectLiteral>,
    id: string,
    checkedAt: Date
): Promise<void> {
    const values: ObjectLiteral = { checkedAt };
    const updateDateColumn = manager.connection.getMetadata(entity).updateDateColumn;
    if (updateDateColumn) {
        const column = manager.connection.driver.escape(updateDateColumn.databaseName);
        values[updateDateColumn.propertyName] = () => column;
    }
    await manager.update(entity, { id }, values);
}

export async function saveHashedContent<TEntity extends HashedContentEntity>(
    options: SaveHashedContentOptions<TEntity>
): Promise<{ skipped: boolean; entity: TEntity }> {
    const repository = options.manager.getRepository<TEntity>(options.entity);
    const hash = createHash('sha256').update(options.content).digest('hex');
    const select = { id: true, contentHash: true } as FindOptionsSelect<TEntity>;
    for (const field of options.comparisonFields || []) {
        (select as Record<keyof TEntity, boolean>)[field] = true;
    }

    const findExisting = (lock: boolean) =>
        repository.findOne({
            where: { id: options.id } as FindOptionsWhere<TEntity>,
            select,
            ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {})
        });

    const incomingData = {
        ...options.incomingData,
        id: options.id,
        content: options.content,
        contentHash: hash
    } as DeepPartial<TEntity>;

    let entity = await findExisting(false);
    if (!entity) {
        const insertData = {
            ...options.defaults,
            ...incomingData
        } as QueryDeepPartialEntity<TEntity>;
        try {
            await repository.insert(insertData);
            return {
                skipped: false,
                entity: repository.create(insertData as DeepPartial<TEntity>)
            };
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
        }
    }

    entity = await findExisting(true);
    if (!entity) throw new Error(`Concurrent row for ${options.id} disappeared before update`);

    const isUnchanged = options.isUnchanged || ((item: TEntity) => item.contentHash === hash);
    if (!options.forceUpdate && isUnchanged(entity, hash)) {
        return { skipped: true, entity };
    }

    await repository.update(
        { id: options.id } as FindOptionsWhere<TEntity>,
        incomingData as QueryDeepPartialEntity<TEntity>
    );
    return { skipped: false, entity: repository.create({ ...entity, ...incomingData }) };
}
