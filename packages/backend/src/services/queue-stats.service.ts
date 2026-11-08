import { getQueueByName, getQueuePoolSize } from '@/lib/queue-factory';
import { QUEUE_NAMES } from '@/shared/constants';
import { TaskType } from '@/shared/task';
import { config } from '@/config';

export type QueueStatsCounts = {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
    prioritized: number;
    waitingChildren: number;
};

export type QueueStatsItem = {
    name: string;
    taskType: TaskType;
    label: string;
    concurrency: number;
    isPaused: boolean;
    counts: QueueStatsCounts;
};

const QUEUE_LABELS: Record<TaskType, string> = {
    [TaskType.SAVE]: '保存队列',
    [TaskType.LLM]: 'AI 队列',
    [TaskType.UPDATE]: '更新队列',
    [TaskType.SEARCH]: '搜索队列',
    [TaskType.READ]: '读取队列',
    [TaskType.RAG]: 'RAG 队列',
    [TaskType.DISCOVER]: '发现队列'
};

const QUEUE_CONCURRENCY: Record<TaskType, number> = {
    [TaskType.SAVE]: config.queue.save.concurrencyLimit,
    [TaskType.LLM]: config.queue.ai.concurrencyLimit,
    [TaskType.UPDATE]: config.queue.update.concurrencyLimit,
    [TaskType.SEARCH]: config.queue.search.concurrencyLimit,
    [TaskType.READ]: config.queue.read.concurrencyLimit,
    [TaskType.RAG]: config.queue.rag.concurrencyLimit,
    [TaskType.DISCOVER]: config.queue.discover.concurrencyLimit
};

export class QueueStatsService {
    static async getQueueStats() {
        const queues = await Promise.all(
            (Object.keys(QUEUE_NAMES) as TaskType[]).map(async taskType => {
                const queue = getQueueByName(QUEUE_NAMES[taskType]).queue;
                const counts = await queue.getJobCounts(
                    'waiting',
                    'active',
                    'delayed',
                    'completed',
                    'failed',
                    'paused',
                    'prioritized',
                    'waiting-children'
                );

                return {
                    name: QUEUE_NAMES[taskType],
                    taskType,
                    label: QUEUE_LABELS[taskType],
                    concurrency: QUEUE_CONCURRENCY[taskType],
                    isPaused: await queue.isPaused(),
                    counts: {
                        waiting: counts.waiting || 0,
                        active: counts.active || 0,
                        delayed: counts.delayed || 0,
                        completed: counts.completed || 0,
                        failed: counts.failed || 0,
                        paused: counts.paused || 0,
                        prioritized: counts.prioritized || 0,
                        waitingChildren: counts['waiting-children'] || 0
                    }
                } satisfies QueueStatsItem;
            })
        );

        return {
            generatedAt: new Date().toISOString(),
            queuePoolSize: getQueuePoolSize(),
            queues: queues.filter(queue => queue.name !== QUEUE_NAMES[TaskType.DISCOVER])
        };
    }
}
