import { EmbeddingService } from '@/services/embedding.service';
import { ArticleService, type RecommendationArticleRow } from '@/services/article.service';
import { redisClient } from '@/lib/redis';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import type { Article } from '@/entities/article';
import type { ArticleCategory } from '@/shared/article';
import type { User } from '@/entities/user';
import { sampleWithoutReplacement } from '@/utils/array';

import stringSimilarity from 'string-similarity';
import Levenshtein from 'fast-levenshtein';

export type RecommendationCard = {
    id: string;
    title: string;
    summary: string;
    author?: User;
    updatedAt: Date;
    category: ArticleCategory;
    tags: string[];
    reason: string;
};

export type InterestProfile = {
    vector: number[];
    weight: number;
};

type RedisSortedSetEntry = [score: number, member: string];
type TimedArticle = { articleId: string; timestamp: number };
type MixPool = { reason: string; ids: readonly string[]; quota: number };
type SelectedCandidate = { id: string; reason: string };

/** Owner of recommendation behavior; `userId` is `registered_user.id`, never a Luogu UID. */
export type RecommendationSubject =
    | { kind: 'user'; userId: number }
    | { kind: 'device'; deviceId: string };

type SubjectStorage = {
    behaviorKey: string;
    recommendedKey: string;
    maxCount: number;
    behaviorExpireSeconds: number;
};

const RECOMMENDED_EXPIRE_SECONDS = 3 * 60 * 60;
const HOT_POOL_SIZE = 200;
const MAX_VECTOR_BUDGET = 180;
const MAX_SEEN_OVERFETCH = 150;
const MAX_CLUSTER_VECTOR_LIMIT = 120;
const DEFAULT_INTEREST_CLUSTERS = 3;
const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_MAX_TITLE_MATCHES = 5;
const SUMMARY_MAX_CHARS = 100;

// A script instead of MULTI so an absent source skips rewriting the destination. Redis runs it
// atomically, so concurrent first requests after login cannot interleave the union and the delete.
const MERGE_SORTED_SET_SCRIPT = `
if redis.call('exists', KEYS[1]) == 0 then return 0 end
redis.call('zunionstore', KEYS[2], 2, KEYS[2], KEYS[1], 'AGGREGATE', 'MAX')
redis.call('zremrangebyrank', KEYS[2], 0, -tonumber(ARGV[1]) - 1)
redis.call('expire', KEYS[2], ARGV[2])
redis.call('del', KEYS[1])
return 1
`;

function vectorNorm(vector: readonly number[]): number {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
        sumSq += vector[i] * vector[i];
    }
    return Math.sqrt(sumSq);
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    let dot = 0;
    let normASq = 0;
    let normBSq = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normASq += a[i] * a[i];
        normBSq += b[i] * b[i];
    }
    const denom = Math.sqrt(normASq) * Math.sqrt(normBSq);
    return denom > 0 ? dot / denom : 0;
}

function computeHydrationTarget(count: number): number {
    return count + Math.min(10, Math.max(5, Math.ceil(count / 2)));
}

function buildSummaryPreview(summary?: string | null, contentPreview?: string | null): string {
    const text = summary?.trim() || contentPreview?.trim() || '';
    return Array.from(text).slice(0, SUMMARY_MAX_CHARS).join('');
}

/**
 * Selects candidates across pools by quota, backfilling unmet slots in pool order, then smoothly
 * interleaves pools so each pool retains its internal ranking without lumping one source at the top.
 */
function mixRankedPools(
    pools: readonly MixPool[],
    targetCount: number,
    alreadyClaimed?: Set<string>
): SelectedCandidate[] {
    if (targetCount <= 0) return [];
    const claimed = alreadyClaimed ?? new Set<string>();
    const buckets: string[][] = pools.map(() => []);
    const cursors = pools.map(() => 0);
    let total = 0;

    const takeFromPool = (poolIndex: number, limit: number) => {
        const pool = pools[poolIndex];
        const bucket = buckets[poolIndex];
        let taken = 0;
        while (cursors[poolIndex] < pool.ids.length && taken < limit && total < targetCount) {
            const id = pool.ids[cursors[poolIndex]++];
            if (claimed.has(id)) continue;
            claimed.add(id);
            bucket.push(id);
            taken++;
            total++;
        }
    };

    for (let i = 0; i < pools.length && total < targetCount; i++) {
        takeFromPool(i, pools[i].quota);
    }
    for (let i = 0; i < pools.length && total < targetCount; i++) {
        takeFromPool(i, targetCount - total);
    }

    const positions = buckets.map(() => 0);
    const interleaved: SelectedCandidate[] = [];
    while (interleaved.length < total) {
        let bestBucket = -1;
        let bestProgress = Infinity;
        for (let i = 0; i < buckets.length; i++) {
            if (positions[i] >= buckets[i].length) continue;
            const progress = (positions[i] + 0.5) / buckets[i].length;
            if (progress < bestProgress) {
                bestProgress = progress;
                bestBucket = i;
            }
        }
        if (bestBucket === -1) break;
        interleaved.push({
            id: buckets[bestBucket][positions[bestBucket]++],
            reason: pools[bestBucket].reason
        });
    }
    return interleaved;
}

function interleaveUnique(lists: readonly (readonly string[])[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const maxLen = lists.reduce((max, list) => Math.max(max, list.length), 0);
    for (let rank = 0; rank < maxLen; rank++) {
        for (const list of lists) {
            if (rank >= list.length) continue;
            const id = list[rank];
            if (!seen.has(id)) {
                seen.add(id);
                result.push(id);
            }
        }
    }
    return result;
}

export class RecommendationService {
    private static async getSimilarArticles(id: string, count: number): Promise<string[]> {
        const vector = await EmbeddingService.getVector(id);
        if (!vector || vector.length === 0) {
            return [];
        }
        const similarIds = await EmbeddingService.getNearestArticleIds(vector, count + 1);
        return similarIds.filter(articleId => articleId !== id).slice(0, count);
    }

    private static async loadValidVectors(articles: string[]): Promise<number[][]> {
        const vectors = await EmbeddingService.getVectors(articles);
        let dimension = 0;
        const validVectors: number[][] = [];
        for (const articleId of articles) {
            const vector = vectors.get(articleId);
            if (!vector || vector.length === 0) continue;
            if (dimension === 0) dimension = vector.length;
            if (vector.length !== dimension) continue;
            validVectors.push(vector);
        }
        return validVectors;
    }

    static async drawProfile(articles: string[]): Promise<number[]> {
        const validVectors = await this.loadValidVectors(articles);
        if (validVectors.length === 0) return [];

        const dimension = validVectors[0].length;
        const profile = new Array<number>(dimension).fill(0);
        let weightSum = 0;
        let factor = 1;
        for (const vector of validVectors) {
            for (let j = 0; j < dimension; j++) {
                profile[j] += vector[j] * factor;
            }
            weightSum += factor;
            factor *= config.recommendation.decayFactor;
        }
        for (let i = 0; i < dimension; i++) {
            profile[i] /= weightSum;
        }
        const norm = vectorNorm(profile);
        if (norm > 0) {
            for (let i = 0; i < dimension; i++) {
                profile[i] /= norm;
            }
        }
        return profile;
    }

    static async drawInterestProfiles(
        articles: string[],
        maxClusters: number = DEFAULT_INTEREST_CLUSTERS,
        similarityThreshold: number = DEFAULT_CLUSTER_SIMILARITY_THRESHOLD
    ): Promise<InterestProfile[]> {
        const validVectors = await this.loadValidVectors(articles);
        if (validVectors.length === 0) return [];

        const dimension = validVectors[0].length;
        const clusters: Array<{ sum: number[]; weight: number }> = [];
        let factor = 1;

        for (const vector of validVectors) {
            let bestIndex = -1;
            let bestSimilarity = -Infinity;
            for (let i = 0; i < clusters.length; i++) {
                const sim = cosineSimilarity(clusters[i].sum, vector);
                if (sim > bestSimilarity) {
                    bestSimilarity = sim;
                    bestIndex = i;
                }
            }

            if (
                bestIndex !== -1 &&
                (bestSimilarity >= similarityThreshold || clusters.length >= maxClusters)
            ) {
                const target = clusters[bestIndex];
                for (let j = 0; j < dimension; j++) {
                    target.sum[j] += vector[j] * factor;
                }
                target.weight += factor;
            } else {
                const sum = new Array<number>(dimension);
                for (let j = 0; j < dimension; j++) {
                    sum[j] = vector[j] * factor;
                }
                clusters.push({ sum, weight: factor });
            }
            factor *= config.recommendation.decayFactor;
        }

        return clusters
            .map(cluster => {
                const norm = vectorNorm(cluster.sum);
                if (norm <= 0) return null;
                return {
                    vector: cluster.sum.map(value => value / norm),
                    weight: cluster.weight
                };
            })
            .filter((item): item is InterestProfile => item !== null)
            .sort((a, b) => b.weight - a.weight);
    }

    static selectProfileArticles(entries: TimedArticle[], limit: number): string[] {
        const selected = new Set<string>();
        for (const { articleId } of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
            if (selected.size >= limit) break;
            selected.add(articleId);
        }
        return [...selected];
    }

    private static formatRecommendationCard(
        row: RecommendationArticleRow,
        reason: string
    ): RecommendationCard {
        return {
            id: row.id,
            title: row.title,
            summary: buildSummaryPreview(row.summary, row.contentPreview),
            author: row.author,
            updatedAt: row.updatedAt,
            category: row.category,
            tags: row.tags,
            reason
        };
    }

    private static async hydrateCandidates(
        candidates: readonly SelectedCandidate[],
        limit?: number
    ): Promise<RecommendationCard[]> {
        if (candidates.length === 0) return [];
        const reasonById = new Map(candidates.map(item => [item.id, item.reason]));
        const rows = await ArticleService.getRecommendationArticlesByIds(
            candidates.map(item => item.id)
        );
        const capped = limit === undefined ? rows : rows.slice(0, limit);
        return capped.map(row =>
            this.formatRecommendationCard(row, reasonById.get(row.id) ?? 'other')
        );
    }

    private static async addRecentSortedSetEntries(
        key: string,
        entries: RedisSortedSetEntry[],
        maxCount: number,
        expireSeconds: number
    ) {
        if (entries.length === 0) return;

        const redisArgs: (string | number)[] = entries.flatMap(([score, member]) => [
            score,
            member
        ]);
        const transaction = redisClient.multi();
        transaction.zadd(key, ...redisArgs);
        transaction.zremrangebyrank(key, 0, -maxCount - 1);
        transaction.expire(key, expireSeconds);
        await transaction.exec();
    }

    private static getStorage(subject: RecommendationSubject): SubjectStorage {
        if (subject.kind === 'user') {
            return {
                behaviorKey: `user_behavior:${subject.userId}`,
                recommendedKey: `user_recommendations:${subject.userId}`,
                maxCount: config.recommendation.maxHistory,
                behaviorExpireSeconds: config.recommendation.user.expireTime
            };
        }
        return {
            behaviorKey: `anon_behavior:${subject.deviceId}`,
            recommendedKey: `anon_recommendations:${subject.deviceId}`,
            maxCount: config.recommendation.anonymous.maxCount,
            behaviorExpireSeconds: config.recommendation.anonymous.expireTime
        };
    }

    private static async getBehaviorEntries(
        subject: RecommendationSubject,
        storage: SubjectStorage
    ): Promise<TimedArticle[]> {
        try {
            const flat = await redisClient.zrevrange(
                storage.behaviorKey,
                0,
                storage.maxCount - 1,
                'WITHSCORES'
            );
            const entries: TimedArticle[] = [];
            for (let i = 0; i + 1 < flat.length; i += 2) {
                entries.push({ articleId: flat[i], timestamp: Number(flat[i + 1]) });
            }
            return entries;
        } catch (error) {
            logger.error({ error, subject }, `Failed to get behavior entries`);
            return [];
        }
    }

    static async recordBehavior(subject: RecommendationSubject, articleId: string) {
        const storage = this.getStorage(subject);
        try {
            await this.addRecentSortedSetEntries(
                storage.behaviorKey,
                [[Date.now(), articleId]],
                storage.maxCount,
                storage.behaviorExpireSeconds
            );
        } catch (error) {
            logger.error({ error, subject, articleId }, `Failed to record behavior`);
        }
    }

    private static async recordRecommendedArticles(
        subject: RecommendationSubject,
        articleIds: string[]
    ) {
        if (articleIds.length === 0) return;
        const storage = this.getStorage(subject);
        try {
            const now = Date.now();
            await this.addRecentSortedSetEntries(
                storage.recommendedKey,
                articleIds.map(articleId => [now, articleId]),
                storage.maxCount,
                RECOMMENDED_EXPIRE_SECONDS
            );
        } catch (error) {
            logger.error({ error, subject, articleIds }, `Failed to record recommended articles`);
        }
    }

    private static async getRecommendedArticles(subject: RecommendationSubject) {
        try {
            return await redisClient.zrange(this.getStorage(subject).recommendedKey, 0, -1);
        } catch (error) {
            logger.error({ error, subject }, `Failed to get recommended articles`);
            return [];
        }
    }

    /** Moves a device's anonymous history into the user's history; repeated calls write nothing. */
    static async mergeDeviceHistory(deviceId: string, userId: number) {
        const device = this.getStorage({ kind: 'device', deviceId });
        const user = this.getStorage({ kind: 'user', userId });
        try {
            await redisClient.eval(
                MERGE_SORTED_SET_SCRIPT,
                2,
                device.behaviorKey,
                user.behaviorKey,
                user.maxCount,
                user.behaviorExpireSeconds
            );
            await redisClient.eval(
                MERGE_SORTED_SET_SCRIPT,
                2,
                device.recommendedKey,
                user.recommendedKey,
                user.maxCount,
                RECOMMENDED_EXPIRE_SECONDS
            );
        } catch (error) {
            logger.error({ error, deviceId, userId }, `Failed to merge device history`);
        }
    }

    private static async retrieveVectorPool(
        interestProfiles: readonly InterestProfile[],
        count: number,
        strictExcludedSize: number
    ): Promise<string[]> {
        if (interestProfiles.length === 0) return [];

        const totalBudget = Math.min(
            MAX_VECTOR_BUDGET,
            count * 3 + Math.min(strictExcludedSize, MAX_SEEN_OVERFETCH)
        );
        const perClusterLimit = Math.min(
            MAX_CLUSTER_VECTOR_LIMIT,
            Math.max(count * 2, Math.ceil(totalBudget / interestProfiles.length))
        );
        const perClusterResults = await EmbeddingService.getNearestArticleIdsBatch(
            interestProfiles.map(cluster => cluster.vector),
            perClusterLimit
        );
        return interleaveUnique(perClusterResults);
    }

    static async getPersonalizedRecommendations(
        subject: RecommendationSubject,
        count: number = 10,
        excludedArticles: string[] = []
    ): Promise<RecommendationCard[]> {
        const storage = this.getStorage(subject);
        const [viewEntries, previouslyRecommended, hotPool, recentPool] = await Promise.all([
            this.getBehaviorEntries(subject, storage),
            this.getRecommendedArticles(subject),
            ArticleService.getHotArticleIds(HOT_POOL_SIZE),
            ArticleService.getRecentArticleIdPool()
        ]);

        const viewedIds = viewEntries.map(entry => entry.articleId);
        const hardExcluded = new Set<string>([...viewedIds, ...excludedArticles]);
        const strictExcluded = new Set<string>([...hardExcluded, ...previouslyRecommended]);

        const profileIds = this.selectProfileArticles(
            viewEntries,
            config.recommendation.profileSize
        );
        const interestProfiles = await this.drawInterestProfiles(profileIds);
        const vectorPool = await this.retrieveVectorPool(
            interestProfiles,
            count,
            strictExcluded.size
        );

        const targetCount = computeHydrationTarget(count);
        const vectorCandidates = vectorPool.filter(id => !strictExcluded.has(id));
        const hotCandidates = hotPool.filter(id => !strictExcluded.has(id));
        const randomCandidates = sampleWithoutReplacement(
            recentPool,
            Math.max(targetCount * 2, 40),
            strictExcluded
        );

        const pools: MixPool[] =
            vectorCandidates.length > 0
                ? (() => {
                      const vectorQuota = Math.ceil(targetCount * 0.6);
                      const hotQuota = Math.ceil(targetCount * 0.25);
                      return [
                          { reason: 'vector', ids: vectorCandidates, quota: vectorQuota },
                          { reason: 'hot', ids: hotCandidates, quota: hotQuota },
                          {
                              reason: 'random',
                              ids: randomCandidates,
                              quota: Math.max(0, targetCount - vectorQuota - hotQuota)
                          }
                      ];
                  })()
                : (() => {
                      const hotQuota = Math.ceil(targetCount * 0.5);
                      return [
                          { reason: 'hot', ids: hotCandidates, quota: hotQuota },
                          {
                              reason: 'random',
                              ids: randomCandidates,
                              quota: Math.max(0, targetCount - hotQuota)
                          }
                      ];
                  })();

        const claimed = new Set<string>();
        let selected = mixRankedPools(pools, targetCount, claimed);

        // Soft-recycle previously recommended items only when strict candidates cannot fill the page;
        // viewed articles and client-excluded IDs remain strictly excluded.
        if (selected.length < count) {
            const recycleRemaining = targetCount - selected.length;
            const recycleExcluded = new Set<string>([...hardExcluded, ...claimed]);
            const recycled = mixRankedPools(
                [
                    {
                        reason: 'vector',
                        ids: vectorPool.filter(id => !recycleExcluded.has(id)),
                        quota: Math.ceil(recycleRemaining * 0.6)
                    },
                    {
                        reason: 'hot',
                        ids: hotPool.filter(id => !recycleExcluded.has(id)),
                        quota: Math.ceil(recycleRemaining * 0.25)
                    },
                    {
                        reason: 'random',
                        ids: sampleWithoutReplacement(
                            recentPool,
                            Math.max(recycleRemaining * 2, 40),
                            recycleExcluded
                        ),
                        quota: recycleRemaining
                    }
                ],
                recycleRemaining,
                claimed
            );
            selected = [...selected, ...recycled];
        }

        const hydrated = await this.hydrateCandidates(selected, count);
        const returnedIds = hydrated.map(item => item.id);
        await this.recordRecommendedArticles(subject, returnedIds);

        logger.debug(
            {
                subject,
                viewCount: viewEntries.length,
                clusters: interestProfiles.length,
                vL: vectorPool.length,
                hL: hotPool.length,
                rL: randomCandidates.length,
                recommendation: returnedIds
            },
            `Personalized recommendations`
        );

        return hydrated;
    }

    static async getPublicRecommendations(
        count: number = 10,
        excludedArticles: string[] = []
    ): Promise<RecommendationCard[]> {
        const [hotPool, recentPool] = await Promise.all([
            ArticleService.getHotArticleIds(HOT_POOL_SIZE),
            ArticleService.getRecentArticleIdPool()
        ]);

        const excludedSet = new Set<string>(excludedArticles);
        const targetCount = computeHydrationTarget(count);
        const hotCandidates = hotPool.filter(id => !excludedSet.has(id));
        const recentUnseen = recentPool.filter(id => !excludedSet.has(id));
        const recentCandidates = recentUnseen.slice(0, Math.max(200, count * 5));
        const randomCandidates = sampleWithoutReplacement(
            recentUnseen,
            Math.max(targetCount * 2, 40)
        );

        const hotQuota = Math.ceil(targetCount * 0.4);
        const recentQuota = Math.ceil(targetCount * 0.35);
        const randomQuota = Math.max(0, targetCount - hotQuota - recentQuota);

        const selected = mixRankedPools(
            [
                { reason: 'hot', ids: hotCandidates, quota: hotQuota },
                { reason: 'other', ids: recentCandidates, quota: recentQuota },
                { reason: 'random', ids: randomCandidates, quota: randomQuota },
                { reason: 'other', ids: recentUnseen, quota: 0 }
            ],
            targetCount
        );

        const hydrated = await this.hydrateCandidates(selected, count);

        logger.debug(
            {
                excludedCount: excludedArticles.length,
                hL: hotCandidates.length,
                recentL: recentCandidates.length,
                rL: randomCandidates.length,
                recommendation: hydrated.map(item => item.id)
            },
            `Public recommendations`
        );

        return hydrated;
    }

    static async getRelevantArticle(
        articleId: string,
        fromVector: number = 5,
        sourceArticle?: Article | null,
        maxTitleMatches: number = DEFAULT_MAX_TITLE_MATCHES
    ): Promise<RecommendationCard[]> {
        const [similarIds, article] = await Promise.all([
            this.getSimilarArticles(articleId, fromVector * 3),
            sourceArticle !== undefined
                ? Promise.resolve(sourceArticle)
                : ArticleService.getArticleById(articleId)
        ]);

        const originTitle = article?.title || '';
        const authorId = article?.authorId || 0;
        const authorArticles =
            authorId > 0 ? await ArticleService.getArticleTitlesByAuthor(authorId) : [];

        const titleMatches: Array<{ id: string; similarity: number }> = [];
        for (const candidate of authorArticles) {
            if (candidate.id === articleId) continue;
            const minLength = Math.min(candidate.title.length, originTitle.length);
            const levenshteinSimilarity =
                minLength === 0
                    ? 0
                    : Math.max(0, 1 - Levenshtein.get(originTitle, candidate.title) / minLength);
            const similarity = Math.max(
                stringSimilarity.compareTwoStrings(originTitle, candidate.title),
                levenshteinSimilarity
            );
            if (similarity >= config.recommendation.relevantThreshold) {
                titleMatches.push({ id: candidate.id, similarity });
            }
            logger.debug(
                { articleId: candidate.id, title: candidate.title, similarity },
                `Title similarity check`
            );
        }

        titleMatches.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
        const titleSimilarIds = titleMatches.slice(0, Math.max(0, maxTitleMatches)).map(m => m.id);

        const seen = new Set<string>(titleSimilarIds);
        const candidates: SelectedCandidate[] = titleSimilarIds.map(id => ({
            id,
            reason: 'title'
        }));

        let appendedCount = 0;
        for (const simId of similarIds) {
            if (appendedCount >= fromVector) break;
            if (seen.has(simId)) continue;
            seen.add(simId);
            candidates.push({ id: simId, reason: 'vector' });
            appendedCount++;
        }

        return this.hydrateCandidates(candidates);
    }
}
