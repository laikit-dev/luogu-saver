import {
    DiscoveredArticle,
    DiscoveredArticleSource,
    DiscoveredArticleStatus
} from '@/entities/discovered-article';
import { DiscoveryRun, DiscoveryRunStatus } from '@/entities/discovery-run';
import { WorkflowService } from '@/services/workflow.service';
import { TaskService } from '@/services/task.service';
import { ArticleDiscoveryBroadcaster } from '@/services/article-discovery-broadcaster.service';
import { DiscoverTarget, TaskType } from '@/shared/task';
import { isDuplicateKeyError } from '@/utils/db-errors';
import {
    findOneServiceEntity,
    getServiceRepository,
    saveServiceEntity
} from '@/services/helpers/repository.helper';
import { normalizeErrorReason } from '@/utils/error-reason';
import { logger } from '@/lib/logger';

export type StartUserArticleDiscoveryInput = {
    uid?: number | string;
    maxPages?: number;
    forceUpdate?: boolean;
};

export type ArticleDiscoveryInput = {
    runId: string;
    articleId: string;
    forceUpdate: boolean;
};

const ARTICLE_ID_PATTERN = /^[A-Za-z0-9]{1,8}$/;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeBool(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
}

export class DiscoveryService {
    static async startUserArticleDiscovery(input: StartUserArticleDiscoveryInput = {}) {
        const uid = clampInt(input.uid, 0, 1, Number.MAX_SAFE_INTEGER);
        if (uid <= 0) throw new Error('Valid uid is required');

        const maxPages = clampInt(input.maxPages, 1000, 1, 1000);
        const forceUpdate = normalizeBool(input.forceUpdate, false);
        const seedUrl = `https://www.luogu.com/user/${uid}/article`;

        const run = await saveServiceEntity<DiscoveryRun>(
            DiscoveryRun,
            DiscoveryRun.create({
                seedUrl,
                status: DiscoveryRunStatus.ACTIVE,
                maxPages,
                forceUpdate,
                visitedPages: 0,
                failedPages: 0,
                pendingPages: 1,
                discoveredArticles: 0,
                createdWorkflows: 0,
                lastError: null,
                finishedAt: null
            })
        );

        const task = await TaskService.createTask(TaskType.DISCOVER, {
            target: DiscoverTarget.USER_ARTICLES,
            targetId: String(uid),
            metadata: {
                runId: run.id,
                uid,
                page: 1,
                maxPages,
                forceUpdate
            }
        });
        await TaskService.dispatchTask(task.id);

        ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
        return { run, taskIds: [task.id] };
    }

    static async getRunById(runId: string) {
        const run = await findOneServiceEntity<DiscoveryRun>(DiscoveryRun, {
            where: { id: runId }
        });
        return this.normalizeRunForOutput(run);
    }

    static async listRuns(limit = 20) {
        const runs = await getServiceRepository<DiscoveryRun>(DiscoveryRun).find({
            order: { createdAt: 'DESC' },
            take: clampInt(limit, 20, 1, 100)
        });
        return runs.map(run => this.normalizeRunForOutput(run));
    }

    static async stopRun(runId: string) {
        await getServiceRepository<DiscoveryRun>(DiscoveryRun).update(
            { id: runId },
            { status: DiscoveryRunStatus.STOPPED, finishedAt: new Date(), pendingPages: 0 }
        );
        ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
    }

    static async claimPage(runId: string, consumeBudget = true): Promise<boolean> {
        const claimed = await DiscoveryRun.transaction(async manager => {
            const repo = manager.getRepository(DiscoveryRun);
            const run = await repo.findOne({
                where: { id: runId },
                lock: { mode: 'pessimistic_write' }
            });
            if (!run || run.status !== DiscoveryRunStatus.ACTIVE) return false;
            if (!consumeBudget) return true;
            if (run.visitedPages >= run.maxPages) {
                return false;
            }
            run.visitedPages += 1;
            await repo.save(run);
            return true;
        });
        if (claimed && consumeBudget) ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
        return claimed;
    }

    static async finishPage(runId: string, hasContinuation: boolean) {
        if (hasContinuation) return;

        const changed = await DiscoveryRun.transaction(async manager => {
            const repo = manager.getRepository(DiscoveryRun);
            const run = await repo.findOne({
                where: { id: runId },
                lock: { mode: 'pessimistic_write' }
            });
            if (!run || run.status !== DiscoveryRunStatus.ACTIVE) return false;

            run.pendingPages = Math.max(0, run.pendingPages - 1);
            if (run.pendingPages === 0) {
                run.status = DiscoveryRunStatus.COMPLETED;
                run.finishedAt = new Date();
            }
            await repo.save(run);
            return true;
        });
        if (changed) ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
    }

    static async markPageFailed(runId: string, error: unknown) {
        const message = normalizeErrorReason(error);
        await getServiceRepository<DiscoveryRun>(DiscoveryRun).increment(
            { id: runId },
            'failedPages',
            1
        );
        await getServiceRepository<DiscoveryRun>(DiscoveryRun).update(
            { id: runId },
            { lastError: message }
        );
        ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
    }

    static async discoverArticle(input: ArticleDiscoveryInput) {
        if (!ARTICLE_ID_PATTERN.test(input.articleId)) {
            return { created: false, reason: 'invalid_article_id' };
        }

        const run = await this.getRunById(input.runId);
        if (!run || run.status !== DiscoveryRunStatus.ACTIVE) {
            return { created: false, reason: 'run_inactive' };
        }

        let row: DiscoveredArticle;
        try {
            row = await saveServiceEntity<DiscoveredArticle>(
                DiscoveredArticle,
                DiscoveredArticle.create({
                    runId: input.runId,
                    articleId: input.articleId,
                    source: DiscoveredArticleSource.USER_ARTICLES,
                    status: DiscoveredArticleStatus.DISCOVERED,
                    workflowId: null,
                    reason: null,
                    lastSeenAt: new Date()
                })
            );
            await getServiceRepository<DiscoveryRun>(DiscoveryRun).increment(
                { id: input.runId },
                'discoveredArticles',
                1
            );
            ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            await getServiceRepository<DiscoveredArticle>(DiscoveredArticle).update(
                { runId: input.runId, articleId: input.articleId },
                { lastSeenAt: new Date() }
            );
            ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
            return { created: false, reason: 'duplicate' };
        }

        try {
            const workflow = await WorkflowService.createWorkflowFromTemplate(
                'article-save-pipeline',
                {
                    targetId: input.articleId,
                    forceUpdate: input.forceUpdate
                },
                {
                    priority: 10
                }
            );
            await getServiceRepository<DiscoveredArticle>(DiscoveredArticle).update(row.id, {
                status: DiscoveredArticleStatus.WORKFLOW_CREATED,
                workflowId: workflow.workflowId,
                reason: null
            });
            if (!workflow.deduplicated) {
                await getServiceRepository<DiscoveryRun>(DiscoveryRun).increment(
                    { id: input.runId },
                    'createdWorkflows',
                    1
                );
            }
            ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
            return {
                created: !workflow.deduplicated,
                workflowId: workflow.workflowId,
                reason: workflow.deduplicated ? 'duplicate_active_workflow' : undefined
            };
        } catch (error) {
            const message = normalizeErrorReason(error);
            await getServiceRepository<DiscoveredArticle>(DiscoveredArticle).update(row.id, {
                status: DiscoveredArticleStatus.FAILED,
                reason: message
            });
            ArticleDiscoveryBroadcaster.scheduleRunsUpdate();
            logger.error({ error, input }, 'Failed to create workflow for discovered article');
            return { created: false, reason: message };
        }
    }

    private static normalizeRunForOutput(run: DiscoveryRun | null): DiscoveryRun | null {
        if (run?.lastError) run.lastError = normalizeErrorReason(run.lastError);
        return run;
    }
}
