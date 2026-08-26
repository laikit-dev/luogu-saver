<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NCheckbox, NInput, NProgress, NSpace, NTag, useMessage } from 'naive-ui';
import { MessageCircleMore, Newspaper } from 'lucide-vue-next';
import CardTitle from '@/components/CardTitle.vue';
import Card from '@/components/Card.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import { createWorkflowFromTemplate, getWorkflowById } from '@/api/workflow.ts';
import { useContentSaver } from '@/composables/useContentSaver.ts';
import { isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { useKnowledgeBase } from '@/utils/knowledge-base.ts';

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
    status: 'pending' | 'running' | 'completed' | 'failed';
    detail: string;
};

const message = useMessage();
const router = useRouter();
const question = ref('');
const loading = ref(false);
const answerMarkdown = ref('');
const documents = ref<RagDocument[]>([]);
const { setupTaskUpdateListener } = useContentSaver();
const knowledgeBase = useKnowledgeBase();
const useKb = ref(false);
const progressSteps = ref<ProgressStep[]>(createProgressSteps());
let progressCleanups: Array<() => void> = [];

const canAsk = computed(() => question.value.trim().length > 0 && !loading.value);
const kbArticles = computed(() => knowledgeBase.getArticles());
const selectedKbArticleIds = computed(() => (useKb.value ? knowledgeBase.getArticleIds() : []));
const progressPercent = computed(() => {
    const completed = progressSteps.value.filter(step => step.status === 'completed').length;
    return Math.round((completed / progressSteps.value.length) * 100);
});

async function showAnswer(answer: any) {
    answerMarkdown.value = answer?.text || '';
    documents.value = answer?.documents || [];
}

async function loadWorkflowAnswer(workflowId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const workflow = await getWorkflowById(workflowId);
        const answer = workflow.data?.result?.answer?.result?.data;
        if (answer?.text) return answer;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return null;
}

async function askRag() {
    if (!question.value.trim()) {
        message.warning('请输入问题');
        return;
    }
    if (!isAuthenticated.value) {
        message.warning('RAG 问答需要登录');
        startCpOAuthLogin('/rag');
        return;
    }

    loading.value = true;
    answerMarkdown.value = '';
    documents.value = [];
    resetProgress();

    const response = await createWorkflowFromTemplate('rag-search-pipeline', {
        query: question.value,
        limit: 10,
        maxArticles: 10,
        maxChars: 20000,
        articleIds: selectedKbArticleIds.value
    });

    if (response.code !== 200) {
        loading.value = false;
        message.error(response.message);
        return;
    }

    setupProgressListeners(response.data.reportTaskIds);

    setupTaskUpdateListener(
        response.data.reportTaskIds.answer!,
        async data => {
            const answer =
                data?.result?.data || (await loadWorkflowAnswer(response.data.workflowId));
            if (!answer?.text) {
                message.error('RAG 问答完成，但没有返回内容');
                loading.value = false;
                return;
            }
            await showAnswer(answer);
            loading.value = false;
            message.success('RAG 问答完成');
        },
        error => {
            loading.value = false;
            message.error(error || 'RAG 问答失败');
        }
    );

    message.success('RAG 问答任务已提交');
}

function openArticle(id: string) {
    const { href } = router.resolve(`/article/${id}`);
    window.open(href, '_blank');
}

function createProgressSteps(): ProgressStep[] {
    return [
        {
            key: 'plan',
            label: '规划检索词',
            taskNames: ['plan-queries'],
            status: 'pending',
            detail: '等待 AI 生成检索方案'
        },
        {
            key: 'keyword',
            label: '关键词检索',
            taskNames: Array.from({ length: 5 }, (_, index) => `keyword-search-${index}`),
            status: 'pending',
            detail: '等待 Meilisearch 返回候选文章'
        },
        {
            key: 'embedding',
            label: '向量召回',
            taskNames: Array.from({ length: 5 }, (_, index) => `query-embedding-${index}`),
            status: 'pending',
            detail: '等待查询向量生成'
        },
        {
            key: 'vector',
            label: '向量检索',
            taskNames: Array.from({ length: 5 }, (_, index) => `vector-search-${index}`),
            status: 'pending',
            detail: '等待向量库召回文章'
        },
        {
            key: 'context',
            label: '构建上下文',
            taskNames: ['build-context'],
            status: 'pending',
            detail: '等待合并检索结果和知识库'
        },
        {
            key: 'answer',
            label: '生成回答',
            taskNames: ['answer'],
            status: 'pending',
            detail: '等待 LLM 生成最终回答'
        }
    ];
}

function resetProgress() {
    progressCleanups.forEach(cleanup => cleanup());
    progressCleanups = [];
    progressSteps.value = createProgressSteps();
}

function setStepStatus(taskName: string, status: ProgressStep['status'], detail?: string) {
    progressSteps.value = progressSteps.value.map(step => {
        if (!step.taskNames.includes(taskName)) return step;
        if (step.status === 'completed' && status !== 'failed') return step;
        return {
            ...step,
            status,
            detail: detail || step.detail
        };
    });
}

function setupProgressListeners(reportTaskIds: Record<string, string>) {
    for (const [taskName, taskId] of Object.entries(reportTaskIds)) {
        setStepStatus(taskName, 'running');
        const cleanup = setupTaskUpdateListener(
            taskId,
            data => {
                setStepStatus(taskName, 'completed', getProgressDetail(taskName, data));
            },
            error => {
                setStepStatus(taskName, 'failed', error || '任务失败');
            }
        );
        progressCleanups.push(cleanup);
    }
}

function getProgressDetail(taskName: string, data?: any) {
    const result = data?.result?.data;
    if (taskName === 'plan-queries' && Array.isArray(result?.queries)) {
        return `生成 ${result.queries.length} 个检索词`;
    }
    if (taskName.startsWith('keyword-search-')) {
        return `关键词命中 ${result?.hits?.length || 0} 篇`;
    }
    if (taskName.startsWith('query-embedding-')) return '查询向量已生成';
    if (taskName.startsWith('vector-search-')) {
        return `向量命中 ${result?.hits?.length || 0} 篇`;
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
            RETRIEVAL AUGMENTED QA
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
                    @keydown.ctrl.enter="askRag"
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

        <Card v-if="loading || answerMarkdown" title="回答" class="answer-card">
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
            <MarkdownViewer :content="answerMarkdown" :loading="loading" />
        </Card>

        <Card v-if="documents.length" title="引用文章" :icon="Newspaper" class="sources-card">
            <div class="sources-grid">
                <div
                    v-for="doc in documents"
                    :key="doc.id"
                    class="source-item"
                    @click="openArticle(doc.id)"
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
                            v-for="source in doc.sources"
                            :key="source"
                            size="small"
                            :bordered="false"
                            type="info"
                        >
                            {{ source }}
                        </n-tag>
                    </n-space>
                </div>
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
    margin-bottom: 16px;
}

.actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.kb-option {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    padding: 12px;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: linear-gradient(180deg, var(--ui-panel-color), var(--ui-body-gradient-end));
}

.progress-head {
    display: flex;
    align-items: center;
    gap: 12px;
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
    margin-top: 12px;
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
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sources-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}

.source-item {
    padding: 12px;
    border-radius: var(--ui-card-radius);
    border: 1px solid var(--ui-border-color);
    cursor: pointer;
    transition: border-color 0.2s ease;
}

.source-item:hover {
    border-color: var(--ui-primary-color-suppl);
}

.source-title {
    margin-bottom: 8px;
    color: var(--ui-card-title-color);
    font-weight: 600;
}

@media (max-width: 720px) {
    .sources-grid,
    .progress-steps {
        grid-template-columns: 1fr;
    }
}
</style>
