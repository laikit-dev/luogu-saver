import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { DataSource, EntitySchema } from 'typeorm';
import {
    backfillPublishTime,
    normalizePublishTime
} from '../src/services/helpers/publish-time.helper';

type ArchivedRow = {
    id: string;
    publishTime: number | null;
    updatedAt: Date;
};

// The helper addresses columns through entity metadata rather than a concrete class, so the
// archived-document shape is declared here instead of importing `Article` or `Paste`: what is under
// test is the statement the helper emits against a real engine, not either entity's own mapping.
const ArchivedDocument = new EntitySchema<ArchivedRow>({
    name: 'archived_document',
    tableName: 'archived_document',
    columns: {
        id: { type: String, primary: true },
        publishTime: { name: 'publish_time', type: Number, nullable: true },
        updatedAt: { name: 'updated_at', type: Date, updateDate: true }
    }
});

const LAST_UPDATE = new Date('2020-01-01T00:00:00.000Z');

let dataSource: DataSource;

async function seed(id: string, publishTime: number | null): Promise<void> {
    const repository = dataSource.getRepository(ArchivedDocument);
    await repository.insert({ id, publishTime, updatedAt: LAST_UPDATE });
    // The insert lets TypeORM stamp the update date, so pin it to a known past instant. A helper
    // that touches the column moves it to now, which no clock resolution can hide.
    await repository.query('UPDATE archived_document SET updated_at = ? WHERE id = ?', [
        LAST_UPDATE.toISOString(),
        id
    ]);
}

async function read(id: string): Promise<{ publishTime: number | null; updatedAt: string }> {
    const [row] = await dataSource
        .getRepository(ArchivedDocument)
        .query(
            'SELECT publish_time AS publishTime, updated_at AS updatedAt FROM ' +
                'archived_document WHERE id = ?',
            [id]
        );
    return row;
}

beforeEach(async () => {
    dataSource = new DataSource({
        type: 'sqljs',
        entities: [ArchivedDocument],
        synchronize: true
    });
    await dataSource.initialize();
});

afterEach(async () => {
    await dataSource.destroy();
});

describe('normalizePublishTime', () => {
    it('accepts a Unix second inside the INT UNSIGNED range', () => {
        expect(normalizePublishTime(1_759_276_800)).toBe(1_759_276_800);
        expect(normalizePublishTime(1)).toBe(1);
        expect(normalizePublishTime(4_294_967_295)).toBe(4_294_967_295);
    });

    it('rejects every value that would store a fabricated instant', () => {
        for (const value of [
            0,
            -1,
            1.5,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            4_294_967_296,
            1_759_276_800_000,
            null,
            undefined,
            '1759276800',
            {}
        ]) {
            expect(normalizePublishTime(value)).toBeNull();
        }
    });
});

describe('backfillPublishTime', () => {
    it('fills a row whose publish time is still NULL', async () => {
        await seed('a', null);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_800);

        expect((await read('a')).publishTime).toBe(1_759_276_800);
    });

    it('leaves the update date untouched, because filling it is not an archive update', async () => {
        await seed('a', null);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_800);

        expect(new Date((await read('a')).updatedAt).getTime()).toBe(LAST_UPDATE.getTime());
    });

    it('never overwrites a publish time that is already stored', async () => {
        await seed('a', 1_000_000_000);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_800);

        expect((await read('a')).publishTime).toBe(1_000_000_000);
    });

    it('writes nothing when Luogu reports a time that cannot be trusted', async () => {
        await seed('a', null);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 0);
        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', undefined);

        const row = await read('a');
        expect(row.publishTime).toBeNull();
        expect(new Date(row.updatedAt).getTime()).toBe(LAST_UPDATE.getTime());
    });

    it('is idempotent across repeated skipped saves', async () => {
        await seed('a', null);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_800);
        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_801);

        const row = await read('a');
        expect(row.publishTime).toBe(1_759_276_800);
        expect(new Date(row.updatedAt).getTime()).toBe(LAST_UPDATE.getTime());
    });

    it('touches no other row', async () => {
        await seed('a', null);
        await seed('b', null);

        await backfillPublishTime(dataSource.manager, ArchivedDocument, 'a', 1_759_276_800);

        expect((await read('b')).publishTime).toBeNull();
    });
});
