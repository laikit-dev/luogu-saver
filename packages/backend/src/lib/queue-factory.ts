import { TypedQueue } from './queue-wrapper';
import { TaskType, TaskDefinition } from '@/shared/task';
import { QUEUE_NAMES } from '@/shared/constants';
import { logger } from '@/lib/logger';
import { config } from '@/config';

const queuePool = new Map<string, TypedQueue<any>>();
const TASK_TYPE_BY_QUEUE_NAME = Object.fromEntries(
    Object.entries(QUEUE_NAMES).map(([taskType, queueName]) => [queueName, taskType as TaskType])
) as Record<string, TaskType>;

function getQueueConfig(type: TaskType) {
    switch (type) {
        case TaskType.SAVE:
            return config.queue.save;
        case TaskType.LLM:
            return config.queue.ai;
        case TaskType.UPDATE:
            return config.queue.update;
        case TaskType.SEARCH:
            return config.queue.search;
        case TaskType.READ:
            return config.queue.read;
        case TaskType.RAG:
            return config.queue.rag;
        case TaskType.DISCOVER:
            return config.queue.discover;
    }
}

function getOrCreateQueue<T>(queueName: string, type: TaskType): TypedQueue<T> {
    if (!queuePool.has(queueName)) {
        const { maxQueueLength, extraCapacity } = getQueueConfig(type);
        queuePool.set(queueName, new TypedQueue<T>(queueName, maxQueueLength, extraCapacity));
    }

    return queuePool.get(queueName) as TypedQueue<T>;
}

export function getQueueByType<T extends TaskType>(type: T): TypedQueue<TaskDefinition[T]> {
    const queueName = QUEUE_NAMES[type];

    if (!queueName) {
        throw new Error(`No queue name defined for task type: ${type}`);
    }

    return getOrCreateQueue<TaskDefinition[T]>(queueName, type);
}

export function getQueueByName(queueName: string): TypedQueue<any> {
    const type = TASK_TYPE_BY_QUEUE_NAME[queueName];
    if (!type) {
        throw new Error(`No task type defined for queue name: ${queueName}`);
    }

    return getOrCreateQueue<any>(queueName, type);
}

export function getQueuePoolSize(): number {
    return queuePool.size;
}

export async function closeAllQueues() {
    logger.info(`Closing ${queuePool.size} active queues...`);
    const closePromises = [];
    for (const wrapper of queuePool.values()) {
        closePromises.push(wrapper.close());
    }
    await Promise.all(closePromises);
    queuePool.clear();
}
