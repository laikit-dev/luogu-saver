import { Article } from '@/entities/article';
import { ArchiveDigestPreference } from '@/entities/archive-digest-preference';
import { SavedArticle } from '@/entities/saved-article';
import { User } from '@/entities/user';
import { UserFollow } from '@/entities/user-follow';
import { getServiceRepository } from '@/services/helpers/repository.helper';
import type {
    DigestPreference,
    FollowedAuthor,
    LibraryPage,
    SavedArticleItem
} from '@/shared/archive';
import { parseArchiveArticleId, toArchiveArticleSummary } from '@/utils/archive-query';
import { isDuplicateKeyError } from '@/utils/db-errors';
import { clampInt } from '@/utils/number';

export const ARCHIVE_DIGEST_INTERVAL_MS = 24 * 60 * 60_000;

function toDigestPreference(preference: ArchiveDigestPreference | null): DigestPreference {
    return {
        enabled: preference?.enabled ?? false,
        nextDigestAt: preference?.nextDigestAt?.toISOString() ?? null
    };
}

type FollowRow = {
    uid: number;
    name: string | null;
    color: string | null;
    followedAt: Date | string;
};

type SavedRow = {
    articleId: string;
    savedAt: Date | string;
    id: string | null;
    title: string | null;
    category: number | null;
    summary: string | null;
    createdAt: Date | string | null;
    publishTime: number | null;
};

export class LibraryService {
    static async listFollows(
        ownerId: number,
        page?: unknown,
        pageSize?: unknown
    ): Promise<LibraryPage<FollowedAuthor>> {
        const normalizedPage = clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER);
        const normalizedPageSize = clampInt(pageSize, 20, 1, 100);
        const repository = getServiceRepository<UserFollow>(UserFollow);
        const [rows, total] = await Promise.all([
            repository
                .createQueryBuilder('follow')
                .leftJoin(User, 'user', 'user.id = follow.luoguUid')
                .select('follow.luoguUid', 'uid')
                .addSelect('user.name', 'name')
                .addSelect('user.color', 'color')
                .addSelect('follow.createdAt', 'followedAt')
                .where('follow.ownerId = :ownerId', { ownerId })
                .orderBy('follow.createdAt', 'DESC')
                .addOrderBy('follow.id', 'DESC')
                .offset((normalizedPage - 1) * normalizedPageSize)
                .limit(normalizedPageSize)
                .getRawMany<FollowRow>(),
            repository.countBy({ ownerId })
        ]);
        return {
            items: rows.map(row => ({
                uid: Number(row.uid),
                name: row.name,
                color: row.color,
                followedAt: new Date(row.followedAt).toISOString()
            })),
            total,
            page: normalizedPage,
            pageSize: normalizedPageSize
        };
    }

    static async getFollowState(ownerId: number, uid: number): Promise<{ following: boolean }> {
        const following = await getServiceRepository<UserFollow>(UserFollow).existsBy({
            ownerId,
            luoguUid: uid
        });
        return { following };
    }

    static async follow(ownerId: number, uid: number): Promise<{ following: true }> {
        try {
            await getServiceRepository<UserFollow>(UserFollow).insert({ ownerId, luoguUid: uid });
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
        }
        return { following: true };
    }

    static async unfollow(ownerId: number, uid: number): Promise<{ following: false }> {
        await getServiceRepository<UserFollow>(UserFollow).delete({ ownerId, luoguUid: uid });
        return { following: false };
    }

    static async listSavedArticles(
        ownerId: number,
        page?: unknown,
        pageSize?: unknown
    ): Promise<LibraryPage<SavedArticleItem>> {
        const normalizedPage = clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER);
        const normalizedPageSize = clampInt(pageSize, 20, 1, 100);
        const repository = getServiceRepository<SavedArticle>(SavedArticle);
        const [rows, total] = await Promise.all([
            repository
                .createQueryBuilder('saved')
                .leftJoin(
                    Article,
                    'article',
                    'article.id = saved.articleId AND article.deleted = :deleted',
                    { deleted: false }
                )
                .select('saved.articleId', 'articleId')
                .addSelect('saved.createdAt', 'savedAt')
                .addSelect('article.id', 'id')
                .addSelect('article.title', 'title')
                .addSelect('article.category', 'category')
                .addSelect('article.summary', 'summary')
                .addSelect('article.createdAt', 'createdAt')
                .addSelect('article.publishTime', 'publishTime')
                .where('saved.ownerId = :ownerId', { ownerId })
                .orderBy('saved.createdAt', 'DESC')
                .addOrderBy('saved.id', 'DESC')
                .offset((normalizedPage - 1) * normalizedPageSize)
                .limit(normalizedPageSize)
                .getRawMany<SavedRow>(),
            repository.countBy({ ownerId })
        ]);
        return {
            items: rows.map(row => ({
                articleId: row.articleId,
                savedAt: new Date(row.savedAt).toISOString(),
                available: row.id !== null,
                article:
                    row.id === null
                        ? null
                        : toArchiveArticleSummary({
                              id: row.id,
                              title: row.title!,
                              category: Number(row.category),
                              summary: row.summary,
                              createdAt: row.createdAt!,
                              publishTime: row.publishTime
                          })
            })),
            total,
            page: normalizedPage,
            pageSize: normalizedPageSize
        };
    }

    static async getSavedState(ownerId: number, articleId: string): Promise<{ saved: boolean }> {
        parseArchiveArticleId(articleId);
        const saved = await getServiceRepository<SavedArticle>(SavedArticle).existsBy({
            ownerId,
            articleId
        });
        return { saved };
    }

    static async saveArticle(ownerId: number, articleId: string): Promise<{ saved: true }> {
        parseArchiveArticleId(articleId);
        await Article.transaction(async manager => {
            const article = await getServiceRepository<Article>(Article, manager).findOne({
                where: { id: articleId, deleted: false },
                select: { id: true },
                lock: { mode: 'pessimistic_read' }
            });
            if (!article) {
                throw Object.assign(new Error('Article not found'), { status: 404 });
            }
            try {
                await getServiceRepository<SavedArticle>(SavedArticle, manager).insert({
                    ownerId,
                    articleId
                });
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;
            }
        });
        return { saved: true };
    }

    static async removeSavedArticle(ownerId: number, articleId: string): Promise<{ saved: false }> {
        parseArchiveArticleId(articleId);
        await getServiceRepository<SavedArticle>(SavedArticle).delete({ ownerId, articleId });
        return { saved: false };
    }

    static async getDigestPreference(ownerId: number): Promise<DigestPreference> {
        const preference = await getServiceRepository<ArchiveDigestPreference>(
            ArchiveDigestPreference
        ).findOne({
            where: { ownerId },
            select: { ownerId: true, enabled: true, nextDigestAt: true }
        });
        return toDigestPreference(preference);
    }

    static async setDigestPreference(ownerId: number, enabled: unknown): Promise<DigestPreference> {
        if (typeof enabled !== 'boolean') {
            throw Object.assign(new Error('enabled must be a boolean'), { status: 400 });
        }
        return ArchiveDigestPreference.transaction(async manager => {
            const repository = getServiceRepository<ArchiveDigestPreference>(
                ArchiveDigestPreference,
                manager
            );
            // Insert a default preference or lock the existing one without resetting its checkpoint.
            await repository
                .createQueryBuilder()
                .insert()
                .values({ ownerId })
                .orUpdate(['owner_id'], ['owner_id'])
                .execute();
            const preference = await repository.findOneOrFail({
                where: { ownerId },
                lock: { mode: 'pessimistic_write' }
            });
            if (preference.enabled !== enabled) {
                preference.enabled = enabled;
                if (enabled) {
                    const now = new Date();
                    preference.lastDigestAt = now;
                    preference.nextDigestAt = new Date(now.getTime() + ARCHIVE_DIGEST_INTERVAL_MS);
                } else {
                    preference.nextDigestAt = null;
                }
                await repository.save(preference);
            }
            return toDigestPreference(preference);
        });
    }
}
