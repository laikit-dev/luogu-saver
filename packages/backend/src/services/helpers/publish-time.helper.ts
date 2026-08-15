import { EntityManager, EntityTarget, IsNull, ObjectLiteral } from 'typeorm';

const PUBLISH_TIME_MAX = 4_294_967_295;

/**
 * Narrows a Luogu `time` field to a value that may be stored in a `publish_time` column.
 *
 * @param value The `time` field of a Luogu article or paste payload.
 * @return `value` when it is an integer in `[1, 4294967295]`, the range of the `INT UNSIGNED`
 *     column; `null` for every other input, including `0`, which Luogu uses for no value.
 */
export function normalizePublishTime(value: unknown): number | null {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= PUBLISH_TIME_MAX
        ? value
        : null;
}

/**
 * Stores `time` as the publish time of one archived document, but only while the stored value is
 * still `NULL`.
 *
 * A save whose content hash is unchanged returns without writing, so rows archived before
 * `publish_time` existed would keep `NULL` for as long as their content never changes. This fills
 * them from the payload that save already fetched.
 *
 * @param manager The manager of the transaction that owns the row.
 * @param entity An archived document entity carrying an `id` primary key and a nullable
 *     `publishTime` property. TypeORM's `EntityTarget` accepts any `Function`, so this requirement
 *     cannot be expressed as a type constraint.
 * @param id Primary key of the row.
 * @param time The `time` field of the Luogu payload; an unusable value writes nothing.
 */
export async function backfillPublishTime(
    manager: EntityManager,
    entity: EntityTarget<ObjectLiteral>,
    id: string,
    time: unknown
): Promise<void> {
    const publishTime = normalizePublishTime(time);
    if (publishTime === null) return;

    const values: ObjectLiteral = { publishTime };
    const updateDateColumn = manager.connection.getMetadata(entity).updateDateColumn;
    if (updateDateColumn) {
        // Assigning the update date to itself suppresses the `= CURRENT_TIMESTAMP` that
        // UpdateQueryBuilder appends otherwise: giving a row the publish time it always had is not
        // an update of the archived document, and must not reorder listings sorted by that column.
        const column = manager.connection.driver.escape(updateDateColumn.databaseName);
        values[updateDateColumn.propertyName] = () => column;
    }

    // The `IS NULL` predicate is what makes this safe to run after every skipped save: it cannot
    // overwrite a stored publish time, so no read of the current value is needed and a concurrent
    // writer cannot lose one.
    await manager.update(entity, { id, publishTime: IsNull() }, values);
}
