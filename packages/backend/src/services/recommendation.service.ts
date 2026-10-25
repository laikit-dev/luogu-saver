import { EmbeddingService } from '@/services/embedding.service';
import { ArticleService } from '@/services/article.service';
import { LibraryService } from '@/services/library.service';
import { redisClient } from '@/lib/redis';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { Article } from '@/entities/article';

import stringSimilarity from 'string-similarity';
import Levenshtein from 'fast-levenshtein';

type RecommendedArticle = Article & { reason: string };

type RedisSortedSetEntry = [score: number, member: string];
type CandidatePools = Record<string, string[]>;
type TimedArticle = { articleId: string; timestamp: number };

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

export class RecommendationService {
    private static async getSimilarArticles(id: string, count: number): Promise<string[]> {
        const vector = await EmbeddingService.getVector(id);
        if (!vector) {
            return [];
        }
        const similarIds = await EmbeddingService.getNearestArticleIds(vector, count + 1);
        return similarIds.filter(articleId => articleId !== id).slice(0, count);
    }

    private static async drawProfile(articles: string[]): Promise<number[]> {
        const vectors = await EmbeddingService.getVectors(articles);
        const validVectors = articles.flatMap(articleId => {
            const vector = vectors.get(articleId);
            return vector ? [vector] : [];
        });
        if (validVectors.length === 0) return [];
        const dimension = validVectors[0].length;
        const profile = new Array(dimension).fill(0);
        let factor = 1;
        for (const vector of validVectors) {
            for (let j = 0; j < dimension; j++) {
                profile[j] += vector[j] * factor;
            }
            factor *= config.recommendation.decayFactor;
        }
        for (let i = 0; i < dimension; i++) profile[i] /= validVectors.length;
        return profile;
    }

    private static selectProfileArticles(entries: TimedArticle[], limit: number): string[] {
        const selected = new Set<string>();
        for (const { articleId } of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
            if (selected.size >= limit) break;
            selected.add(articleId);
        }
        return [...selected];
    }

    private static filterArticles(recommendations: string[], articles: Set<string>): string[] {
        const filtered: string[] = [];
        const inResult: Set<string> = new Set();
        for (const articleId of recommendations) {
            if (inResult.has(articleId)) continue;
            if (!articles.has(articleId)) {
                filtered.push(articleId);
                inResult.add(articleId);
            }
        }
        return filtered;
    }

    private static shuffleArticles(articleIds: string[]): string[] {
        return [...articleIds].sort(() => 0.5 - Math.random());
    }

    private static getReason(articleId: string, candidatePools: CandidatePools): string {
        for (const [reason, articleIds] of Object.entries(candidatePools)) {
            if (articleIds.includes(articleId)) return reason;
        }
        return 'other';
    }

    private static async hydrateRecommendations(
        articleIds: string[],
        candidatePools: CandidatePools
    ): Promise<Partial<RecommendedArticle>[]> {
        const result: Article[] = await ArticleService.getArticlesByIds(articleIds);
        const resultWithReason = result.map(
            article =>
                ({
                    ...article,
                    reason: this.getReason(article.id, candidatePools)
                }) as RecommendedArticle
        );
        return this.filterUselessFields(resultWithReason);
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

    private static async getBehaviorEntries(storage: SubjectStorage): Promise<TimedArticle[]> {
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

    private static filterUselessFields(
        articles: RecommendedArticle[]
    ): Partial<RecommendedArticle>[] {
        return articles.map((article: RecommendedArticle) => {
            return {
                id: article.id,
                title: article.title,
                summary: article.content.slice(0, 100),
                author: article.author,
                updatedAt: article.updatedAt,
                category: article.category,
                tags: article.tags,
                reason: article.reason
            };
        });
    }

    static async getPersonalizedRecommendations(
        subject: RecommendationSubject,
        count: number = 10,
        excludedArticles: string[] = []
    ) {
        const [viewEntries, savedEntries, followResults] = await Promise.all([
            this.getBehaviorEntries(this.getStorage(subject)),
            subject.kind === 'user'
                ? LibraryService.getRecentSavedArticles(
                      subject.userId,
                      config.recommendation.maxHistory
                  )
                : [],
            subject.kind === 'user'
                ? LibraryService.getFollowedAuthorArticleIds(subject.userId, count * 2)
                : []
        ]);
        const profile = await this.drawProfile(
            this.selectProfileArticles(
                [...viewEntries, ...savedEntries],
                config.recommendation.profileSize
            )
        );
        const [vectorResults, randomResults, hotResults, previouslyRecommended] = await Promise.all(
            [
                EmbeddingService.getNearestArticleIds(profile, count * 5),
                ArticleService.getRandomArticleIds(20),
                ArticleService.getArticleIdsOrderedByViewCount(50),
                this.getRecommendedArticles(subject)
            ]
        );
        const recommendations = this.shuffleArticles([
            ...followResults,
            ...vectorResults,
            ...randomResults,
            ...hotResults
        ]);
        const seenArticles = new Set([
            ...viewEntries.map(entry => entry.articleId),
            ...savedEntries.map(entry => entry.articleId),
            ...previouslyRecommended,
            ...excludedArticles
        ]);
        const selected = this.filterArticles(recommendations, seenArticles).slice(0, count);
        await this.recordRecommendedArticles(subject, selected);
        logger.debug(
            {
                subject,
                viewCount: viewEntries.length,
                savedCount: savedEntries.length,
                fL: followResults.length,
                vL: vectorResults.length,
                rL: randomResults.length,
                hL: hotResults.length,
                recommendation: selected
            },
            `Personalized recommendations`
        );
        // Pool order decides the reason of an ID found in several pools.
        return this.hydrateRecommendations(selected, {
            follow: followResults,
            vector: vectorResults,
            random: randomResults,
            hot: hotResults
        });
    }

    static async getPublicRecommendations(count: number = 10, excludedArticles: string[] = []) {
        const randomResults = await ArticleService.getRandomArticleIds(20);
        const hotResults = await ArticleService.getArticleIdsOrderedByViewCount(50);
        const recentResults = await ArticleService.getRecentArticleIds(count * 5);

        const recommendations = this.shuffleArticles([
            ...randomResults,
            ...hotResults,
            ...recentResults
        ]);
        const filtered = this.filterArticles(recommendations, new Set(excludedArticles)).slice(
            0,
            count
        );

        logger.debug(
            {
                excludedArticles,
                rL: randomResults.length,
                hL: hotResults.length,
                recentL: recentResults.length,
                recommendation: filtered
            },
            `Public recommendations`
        );

        return this.hydrateRecommendations(filtered, {
            random: randomResults,
            hot: hotResults,
            other: recentResults
        });
    }

    static async getRelevantArticle(articleId: string, fromVector: number = 5) {
        const similarIds = await this.getSimilarArticles(articleId, fromVector * 3);
        const article = await ArticleService.getArticleById(articleId);
        const originTitle = article?.title || '';
        const authorId = article?.authorId || 0;
        const authorArticles = await ArticleService.getArticleTitlesByAuthor(authorId);
        const finalResult = [],
            titleSimilarIds = [];
        for (const article of authorArticles) {
            const levenshteinDistance = Levenshtein.get(originTitle, article.title);
            const levenshteinSimilarity = Math.max(
                0,
                1 - levenshteinDistance / Math.min(article.title.length, originTitle.length)
            );
            const similarity = Math.max(
                stringSimilarity.compareTwoStrings(originTitle, article.title),
                levenshteinSimilarity
            );
            if (similarity >= config.recommendation.relevantThreshold) {
                if (article.id !== articleId) finalResult.push(article.id);
                titleSimilarIds.push(article.id);
            }
            logger.debug(
                { articleId: article.id, title: article.title, similarity },
                `Title similarity check`
            );
        }
        let appendedCount = 1;
        for (const simId of similarIds) {
            if (!finalResult.includes(simId)) {
                finalResult.push(simId);
            }
            if (appendedCount >= fromVector) break;
            appendedCount++;
        }
        const articles = await ArticleService.getArticlesByIds(finalResult);
        const articlesWithReason: RecommendedArticle[] = [];
        for (const article of articles) {
            if (titleSimilarIds.includes(article.id))
                articlesWithReason.push({
                    ...article,
                    reason: 'title'
                } as RecommendedArticle);
            else
                articlesWithReason.push({
                    ...article,
                    reason: 'vector'
                } as RecommendedArticle);
        }
        return this.filterUselessFields(articlesWithReason);
    }
}
