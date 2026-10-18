<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { NAlert, NButton, NCheckbox, NInput, NProgress, NSpace, NTag, useMessage } from 'naive-ui';
import { MessageCircleMore, Newspaper } from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import Card from '@/components/Card.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import { createWorkflowFromTemplate, getWorkflowById } from '@/api/workflow.ts';
import { useContentSaver } from '@/composables/useContentSaver.ts';
import { isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { useKnowledgeBase } from '@/utils/knowledge-base.ts';
import { requestErrorMessage } from '@/utils/request.ts';

type RagDocument = {
    id: string;
    title: string;
    score: number;
    sources: string[];
};

type ProgressStep = {
    key: string;
    label: string;
    taskNames: string[];
    completedTasks: string[];
    hitCount: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    detail: string;
};

const SOURCE_LABELS: Record<string, string> = {
    keyword: '关键词检索',
    embedding: '向量检索',
    vector: '向量检索'
};

const message = useMessage();
const question = ref('');
const loading = ref(false);
const answerMarkdown = ref('');
const answerError = ref<string | null>(null);
const documents = ref<RagDocument[]>([]);
const { setupTaskUpdateListener } = useContentSaver();
const knowledgeBase = useKnowledgeBase();
const useKb = ref(false);
const progressSteps = ref<ProgressStep[]>(createProgressSteps());
let progressCleanups: Array<() => void> = [];
let answerCleanup: (() => void) | null = null;
let askId = 0;

const canAsk = computed(() => question.value.trim().length > 0 && !loading.value);
const kbArticles = computed(() => knowledgeBase.getArticles());
const selectedKbArticleIds = computed(() => (useKb.value ? knowledgeBase.getArticleIds() : []));
const progressPercent = computed(() => {
    const completed = progressSteps.value.filter(step => step.status === 'completed').length;
    return Math.round((completed / progressSteps.value.length) * 100);
});

function retrievalSourceLabels(sources: string[]) {
    const labels = sources
        .filter(source => source !== 'knowledge-base')
        .map(source => SOURCE_LABELS[source] ?? source);
    return [...new Set(labels)];
}

function showAnswer(answer: any) {
    answerMarkdown.value = answer?.text || '';
    documents.value = answer?.documents || [];
}

async function loadWorkflowAnswer(workflowId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const workflow = await getWorkflowById(workflowId);
        if (workflow.code === 200) {
            const answer = workflow.data?.result?.answer?.result?.data;
            if (answer?.text) return answer;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return null;
}

function stopAnswerListener() {
    answerCleanup?.();
    answerCleanup = null;
}

function failAsk(id: number, text: string) {
    if (id !== askId) return;
    loading.value = false;
    answerError.value = text;
}

async function askRag() {
    if (loading.value) return;
    if (!question.value.trim()) {
        message.warning('请输入问题');
        return;
    }
    if (!isAuthenticated.value) {
        message.warning('RAG 问答需要登录');
        startCpOAuthLogin('/rag');
        return;
    }

    const id = ++askId;
    stopAnswerListener();
    loading.value = true;
    answerMarkdown.value = '';
    answerError.value = null;
    documents.value = [];
    resetProgress();

    let response: Awaited<ReturnType<typeof createWorkflowFromTemplate>>;
    try {
        response = await createWorkflowFromTemplate('rag-search-pipeline', {
            query: question.value,
            limit: 10,
            maxArticles: 10,
            maxChars: 20000,
            articleIds: selectedKbArticleIds.value
        });
    } catch (failure) {
        failAsk(id, requestErrorMessage(failure, 'RAG 问答任务提交失败，请稍后重试。'));
        return;
    }
    if (id !== askId) return;

    if (response.code !== 200) {
        failAsk(id, 'RAG 问答任务提交失败，请稍后重试。');
        return;
    }

    const { workflowId, reportTaskIds } = response.data;
    if (!reportTaskIds.answer) {
        failAsk(id, 'RAG 问答任务提交失败，请稍后重试。');
        return;
    }
    setupProgressListeners(id, reportTaskIds);

    answerCleanup = setupTaskUpdateListener(
        reportTaskIds.answer,
        async data => {
            if (id !== askId) return;
            let answer = data?.result?.data;
            if (!answer?.text) {
                try {
                    answer = await loadWorkflowAnswer(workflowId);
                } catch (failure) {
                    failAsk(id, requestErrorMessage(failure, 'RAG 回答加载失败，请稍后重试。'));
                    return;
                }
            }
            if (id !== askId) return;
            if (!answer?.text) {
                failAsk(id, 'RAG 问答已完成，但没有返回内容。');
                return;
            }
            showAnswer(answer);
            loading.value = false;
            message.success('RAG 问答完成');
        },
        () => {
            failAsk(id, 'RAG 问答失败，请稍后重试。');
        }
    );

    message.success('RAG 问答任务已提交');
}

function handleShortcut() {
    if (canAsk.value) void askRag();
}

onUnmounted(() => {
    askId++;
});

function createStep(key: string, label: string, taskNames: string[], detail: string): ProgressStep {
    return { key, label, taskNames, completedTasks: [], hitCount: 0, status: 'pending', detail };
}

function queryTasks(prefix: string) {
    return Array.from({ length: 5 }, (_, index) => `${prefix}-${index}`);
}

function createProgressSteps(): ProgressStep[] {
    return [
        createStep('plan', '规划检索词', ['plan-queries'], '等待 AI 生成检索方案'),
        createStep(
            'keyword',
            '关键词检索',
            queryTasks('keyword-search'),
            '等待 Meilisearch 返回候选文章'
        ),
        createStep('embedding', '向量召回', queryTasks('query-embedding'), '等待查询向量生成'),
        createStep('vector', '向量检索', queryTasks('vector-search'), '等待向量库召回文章'),
        createStep('context', '构建上下文', ['build-context'], '等待合并检索结果和知识库'),
        createStep('answer', '生成回答', ['answer'], '等待 LLM 生成最终回答')
    ];
}

function resetProgress() {
    progressCleanups.forEach(cleanup => cleanup());
    progressCleanups = [];
    progressSteps.value = createProgressSteps();
}

function setStepStatus(taskName: string, status: ProgressStep['status'], data?: any) {
    progressSteps.value = progressSteps.value.map(step => {
        if (!step.taskNames.includes(taskName) || step.status === 'failed') return step;
        if (status === 'failed') return { ...step, status, detail: '任务失败' };
        if (status !== 'completed') {
            return step.status === 'pending' ? { ...step, status } : step;
        }
        if (step.completedTasks.includes(taskName)) return step;

        // A grouped step completes only after every task in the group has completed.
        const completedTasks = [...step.completedTasks, taskName];
        const hitCount = step.hitCount + getHitCount(data);
        const allDone = step.taskNames.every(name => completedTasks.includes(name));
        return {
            ...step,
            completedTasks,
            hitCount,
            status: allDone ? 'completed' : 'running',
            detail:
                step.taskNames.length > 1
                    ? getGroupDetail(
                          step.key,
                          completedTasks.length,
                          step.taskNames.length,
                          hitCount
                      )
                    : getProgressDetail(taskName, data)
        };
    });
}

function setupProgressListeners(id: number, reportTaskIds: Record<string, string>) {
    // Only wait for tasks the workflow actually reports, so a group cannot stall on absent ids.
    progressSteps.value = progressSteps.value.map(step => {
        const reported = step.taskNames.filter(name => name in reportTaskIds);
        return reported.length ? { ...step, taskNames: reported } : step;
    });
    for (const [taskName, taskId] of Object.entries(reportTaskIds)) {
        setStepStatus(taskName, 'running');
        const cleanup = setupTaskUpdateListener(
            taskId,
            data => {
                setStepStatus(taskName, 'completed', data);
            },
            () => {
                setStepStatus(taskName, 'failed');
                // Any failed task fails the whole workflow, so the answer will never arrive.
                const step = progressSteps.value.find(item => item.taskNames.includes(taskName));
                failAsk(id, `「${step?.label ?? taskName}」步骤失败，RAG 问答已中止，请稍后重试。`);
            }
        );
        progressCleanups.push(cleanup);
    }
}

function getHitCount(data?: any): number {
    const hits = data?.result?.data?.hits;
    return Array.isArray(hits) ? hits.length : 0;
}

function getGroupDetail(key: string, completed: number, total: number, hitCount: number) {
    const progress = `已完成 ${completed}/${total}`;
    if (key === 'keyword' || key === 'vector') return `${progress}，累计命中 ${hitCount} 篇`;
    return progress;
}

function getProgressDetail(taskName: string, data?: any) {
    const result = data?.result?.data;
    if (taskName === 'plan-queries' && Array.isArray(result?.queries)) {
        return `生成 ${result.queries.length} 个检索词`;
    }
    if (taskName === 'build-context') {
        return `上下文包含 ${result?.documents?.length || 0} 篇文章`;
    }
    if (taskName === 'answer') return '回答已生成';
    return '任务已完成';
}
</script>

<template>
    <div class="rag-page">
        <CardTitle title="RAG 问答" :icon="MessageCircleMore" class="rag-header">
            基于站内归档文章检索相关内容，由 AI 生成回答并列出引用来源。
        </CardTitle>

        <Card class="question-card">
            <n-space vertical size="medium">
                <n-alert v-if="!isAuthenticated" type="warning" title="需要登录">
                    使用该功能需要<a href="javascript:void(0)" @click="startCpOAuthLogin('/rag')"
                        >登录</a
                    >。
                </n-alert>
                <n-input
                    v-model:value="question"
                    type="textarea"
                    :autosize="{ minRows: 3, maxRows: 6 }"
                    placeholder="输入你想基于站内文章询问的问题"
                    @keydown.ctrl.enter="handleShortcut"
                />
                <div class="kb-option">
                    <n-checkbox v-model:checked="useKb" :disabled="kbArticles.length === 0">
                        使用知识库强制召回
                    </n-checkbox>
                    <n-space size="small" wrap>
                        <n-tag
                            v-for="item in kbArticles"
                            :key="item.id"
                            size="small"
                            :bordered="false"
                            type="info"
                        >
                            {{ item.title }}
                        </n-tag>
                        <n-tag v-if="kbArticles.length === 0" size="small">
                            设置页可管理知识库
                        </n-tag>
                    </n-space>
                </div>
                <div class="actions">
                    <span class="hint">Ctrl + Enter 提交</span>
                    <n-button type="primary" :loading="loading" :disabled="!canAsk" @click="askRag">
                        开始问答
                    </n-button>
                </div>
            </n-space>
        </Card>

        <Card v-if="loading || answerMarkdown || answerError" title="回答" class="answer-card">
            <n-alert v-if="answerError" type="error">
                {{ answerError }}
                <div class="answer-error-actions">
                    <n-button :disabled="!canAsk" @click="askRag">重试</n-button>
                </div>
            </n-alert>
            <template v-else>
                <div v-if="loading" class="progress-panel">
                    <div class="progress-head">
                        <span>问答进度</span>
                        <n-progress
                            type="line"
                            :percentage="progressPercent"
                            :show-indicator="false"
                            class="progress-line"
                        />
                    </div>
                    <div class="progress-steps">
                        <div
                            v-for="step in progressSteps"
                            :key="step.key"
                            class="progress-step"
                            :class="`is-${step.status}`"
                        >
                            <div class="step-dot" />
                            <div class="step-main">
                                <div class="step-label">{{ step.label }}</div>
                                <div class="step-detail">{{ step.detail }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <MarkdownViewer :content="answerMarkdown" :loading="loading" :heading-offset="1" />
            </template>
        </Card>

        <Card v-if="documents.length" title="引用文章" :icon="Newspaper" class="sources-card">
            <div class="sources-grid">
                <RouterLink
                    v-for="doc in documents"
                    :key="doc.id"
                    :to="`/article/${doc.id}`"
                    class="source-item"
                >
                    <div class="source-title">{{ doc.title }}</div>
                    <n-space size="small">
                        <n-tag size="small" :bordered="false">{{ doc.id }}</n-tag>
                        <n-tag
                            v-if="doc.sources.includes('knowledge-base')"
                            size="small"
                            :bordered="false"
                            type="success"
                        >
                            知识库
                        </n-tag>
                        <n-tag
                            v-for="label in retrievalSourceLabels(doc.sources)"
                            :key="label"
                            size="small"
                            :bordered="false"
                            type="info"
                        >
                            {{ label }}
                        </n-tag>
                    </n-space>
                </RouterLink>
            </div>
        </Card>
    </div>
</template>

<style scoped>
.rag-page {
    max-width: 1220px;
    margin: 0 auto;
}

.rag-header,
.question-card,
.answer-card,
.sources-card {
    margin-bottom: var(--ui-section-gap);
}

.actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
}

.answer-error-actions {
    margin-top: var(--ui-space-3);
}

.kb-option {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
    padding: 10px 12px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.hint {
    color: var(--ui-muted-text-color);
    font-size: 13px;
}

.progress-panel {
    margin-bottom: 14px;
    padding: var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: linear-gradient(180deg, var(--ui-panel-color), var(--ui-body-gradient-end));
}

.progress-head {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    color: var(--ui-card-title-color);
    font-weight: 600;
}

.progress-line {
    flex: 1;
}

.progress-steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: var(--ui-space-3);
}

.progress-step {
    display: flex;
    gap: 10px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-translucent-card-color);
}

.step-dot {
    width: 10px;
    height: 10px;
    flex: 0 0 auto;
    margin-top: 5px;
    border-radius: var(--ui-pill-radius);
    background: var(--ui-muted-accent-color);
}

.progress-step.is-running .step-dot {
    background: var(--ui-primary-color);
    box-shadow: var(--ui-focus-ring-shadow);
}

.progress-step.is-completed .step-dot {
    background: var(--ui-success-color);
}

.progress-step.is-failed .step-dot {
    background: var(--ui-error-color);
}

.step-main {
    min-width: 0;
}

.step-label {
    color: var(--ui-card-title-color);
    font-weight: 600;
}

.step-detail {
    margin-top: 2px;
    color: var(--ui-muted-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sources-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
}

.source-item {
    display: block;
    padding: var(--ui-space-3);
    border-radius: var(--ui-card-radius);
    border: 1px solid var(--ui-border-color);
    color: inherit;
    text-decoration: none;
    transition: border-color 0.2s ease;
}

.source-item:hover {
    border-color: var(--ui-primary-color-suppl);
}

.source-item:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.source-title {
    margin-bottom: var(--ui-space-2);
    color: var(--ui-card-title-color);
    font-weight: 600;
}

@media (max-width: 768px) {
    .sources-grid,
    .progress-steps {
        grid-template-columns: 1fr;
    }
}
</style>
