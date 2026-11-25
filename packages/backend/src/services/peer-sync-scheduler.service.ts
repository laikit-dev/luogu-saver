import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { evictCache } from '@/decorators/cache-evict';
import { normalizeErrorReason } from '@/utils/error-reason';
import { SearchService } from '@/services/search.service';
import { PeerExportService } from '@/services/peer-export.service';
import {
    PeerImportService,
    PeerMissingUsersError,
    type PeerImportLimits
} from '@/services/peer-import.service';
import {
    createPeerItemSchemas,
    PEER_STREAMS,
    type PeerItemSchemas,
    type PeerStream
} from '@/services/helpers/peer-items.helper';

const LOCK_KEY = 'scheduler:peer-sync';
const FINISHED_AT_KEY = 'scheduler:peer-sync:finished-at';
const LOCK_TTL_MS = 15 * 60_000;
const TICK_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MEDIUMTEXT_MAX_BYTES = 16_777_215;
const STATEMENT_TEXT_BUDGET = 4 * 1024 * 1024;

const RELEASE_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const EXTEND_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

interface FeedPage {
    items: unknown[];
    next: string;
    more: boolean;
}

/** Thrown to stop a round while keeping every stored cursor (spec Section 5.4). */
class RoundStop extends Error {}

/**
 * Pulls the other peer's feed (`spec/peering-system.spec.md` Section 12). One round runs at a
 * time across processes, guarded by a Redis lock; rounds start at least `intervalMinutes` after
 * the previous round finished.
 */
export class PeerSyncScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static running = false;

    private static get enabled() {
        return config.peer.baseUrl !== '' && config.peer.token !== '';
    }

    static start() {
        if (!this.enabled) {
            logger.info('Peer synchronization disabled: peer.baseUrl or peer.token is empty');
            return;
        }
        if (this.timer) return;
        void this.tick();
        this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
        this.timer.unref();
        logger.info(
            { baseUrl: config.peer.baseUrl, intervalMinutes: config.peer.intervalMinutes },
            'Peer synchronization scheduler started'
        );
    }

    static stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private static async tick() {
        if (this.running) return;
        this.running = true;
        const token = randomUUID();
        let lockOwned = false;
        try {
            const acquired = await redisClient.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
            if (acquired !== 'OK') return;
            lockOwned = true;

            const finishedAt = Number(await redisClient.get(FINISHED_AT_KEY));
            if (finishedAt && Date.now() - finishedAt < config.peer.intervalMinutes * 60_000) {
                return;
            }
            try {
                await this.runRound(token);
            } finally {
                await redisClient.set(FINISHED_AT_KEY, String(Date.now()));
            }
        } catch (error) {
            logger.error(
                { reason: normalizeErrorReason(error) },
                'Peer synchronization tick failed'
            );
        } finally {
            if (lockOwned) {
                try {
                    await redisClient.eval(RELEASE_SCRIPT, 1, LOCK_KEY, token);
                } catch (error) {
                    logger.error(
                        { reason: normalizeErrorReason(error) },
                        'Failed to release peer synchronization lock'
                    );
                }
            }
            this.running = false;
        }
    }

    private static async runRound(lockToken: string) {
        const startedAt = Date.now();
        const peer = config.peer.baseUrl;
        let pages = 0;
        let items = 0;
        try {
            await PeerExportService.assertClockAlignment();
            const limits = await this.importLimits();
            const schemas = createPeerItemSchemas(limits.textLimit);
            for (const stream of PEER_STREAMS) {
                const result = await this.pullStream(peer, stream, lockToken, limits, schemas);
                pages += result.pages;
                items += result.items;
            }
            logger.info(
                { pages, items, durationMs: Date.now() - startedAt },
                'Peer synchronization round completed'
            );
        } catch (error) {
            logger.warn(
                {
                    pages,
                    items,
                    durationMs: Date.now() - startedAt,
                    reason: normalizeErrorReason(error)
                },
                'Peer synchronization round stopped'
            );
        }
    }

    /** Statement limits from `@@max_allowed_packet` (spec Section 12.2 step 2). */
    private static async importLimits(): Promise<PeerImportLimits> {
        const [row] = (await AppDataSource.query('SELECT @@max_allowed_packet AS packet')) as {
            packet: number | string;
        }[];
        // A row's text may double when escaped into the SQL string; 1 MiB covers the remainder.
        const textLimit = Math.min(
            MEDIUMTEXT_MAX_BYTES,
            Math.floor(Number(row.packet) / 2) - 1024 * 1024
        );
        if (textLimit <= 0) throw new RoundStop('max_allowed_packet is too small for peering');
        return { textLimit, statementBudget: Math.min(STATEMENT_TEXT_BUDGET, textLimit) };
    }

    private static async pullStream(
        peer: string,
        stream: PeerStream,
        lockToken: string,
        limits: PeerImportLimits,
        schemas: PeerItemSchemas
    ): Promise<{ pages: number; items: number }> {
        let { cursor, deferredCursor } = await PeerImportService.loadCursor(peer, stream);
        let pages = 0;
        let items = 0;
        while (true) {
            const extended = await redisClient.eval(
                EXTEND_SCRIPT,
                1,
                LOCK_KEY,
                lockToken,
                String(LOCK_TTL_MS)
            );
            if (Number(extended) !== 1) throw new RoundStop('Peer synchronization lock lost');

            const page = await this.fetchPage(stream, cursor);
            const valid = PeerImportService.validateItems(stream, page.items, schemas);
            let effects;
            try {
                effects = await PeerImportService.applyPage(valid, {
                    peer,
                    stream,
                    after: cursor,
                    next: page.next,
                    limits,
                    skipMissingUsers: deferredCursor === cursor
                });
            } catch (error) {
                if (!(error instanceof PeerMissingUsersError)) throw error;
                await PeerImportService.recordDeferral(peer, stream, cursor);
                logger.warn(
                    { stream, missingUids: error.uids.slice(0, 20) },
                    'Peer page deferred until users arrive in the next round'
                );
                throw new RoundStop('Peer page deferred for missing users');
            }

            await evictCache([...effects.cacheKeys]);
            if (effects.searchArticleIds.size > 0) {
                try {
                    await SearchService.upsertArticlesByIds([...effects.searchArticleIds]);
                } catch (error) {
                    logger.error(
                        { stream, reason: normalizeErrorReason(error) },
                        'Peer search index update failed'
                    );
                }
            }

            pages++;
            items += page.items.length;
            logger.info(
                {
                    stream,
                    items: page.items.length,
                    invalid: page.items.length - valid.length,
                    applied: effects.applied,
                    skipped: effects.skipped,
                    more: page.more
                },
                'Peer page applied'
            );

            const stalled = page.items.length === 0 && page.next === cursor;
            cursor = page.next;
            deferredCursor = null;
            if (!page.more || stalled) return { pages, items };
        }
    }

    /** One feed request; any deviation from the envelope stops the round (spec Section 5.4). */
    private static async fetchPage(stream: PeerStream, after: string): Promise<FeedPage> {
        let response;
        try {
            response = await axios.get<string>(`${config.peer.baseUrl}/${stream}`, {
                params: after ? { after } : undefined,
                headers: {
                    Authorization: `Bearer ${config.peer.token}`,
                    Accept: 'application/json',
                    'Accept-Encoding': 'br, gzip'
                },
                timeout: REQUEST_TIMEOUT_MS,
                maxContentLength: MAX_RESPONSE_BYTES,
                maxRedirects: 0,
                responseType: 'text',
                transformResponse: [data => data],
                validateStatus: () => true
            });
        } catch (error) {
            throw new RoundStop(`Peer ${stream} request failed: ${normalizeErrorReason(error)}`);
        }
        if (response.status !== 200) {
            throw new RoundStop(`Peer ${stream} answered HTTP ${response.status}`);
        }
        let body: unknown;
        try {
            body = JSON.parse(response.data);
        } catch {
            throw new RoundStop(`Peer ${stream} answered a body that is not JSON`);
        }
        const page = body as Partial<FeedPage> | null;
        if (
            !page ||
            typeof page !== 'object' ||
            !Array.isArray(page.items) ||
            typeof page.next !== 'string' ||
            typeof page.more !== 'boolean'
        ) {
            throw new RoundStop(`Peer ${stream} answered a body that is not a feed envelope`);
        }
        return { items: page.items, next: page.next, more: page.more };
    }
}
