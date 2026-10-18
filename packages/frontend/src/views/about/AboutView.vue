<script setup lang="ts">
import { onMounted, ref, inject, type Ref } from 'vue';
import { NGrid, NGi, NStatistic, NIcon } from 'naive-ui';
import {
    LayoutGrid,
    List,
    Hammer,
    ChartNoAxesColumnIncreasing,
    Globe2,
    CloudDownload,
    Newspaper,
    Clipboard,
    Search,
    Share2,
    AtSign
} from 'lucide-vue-next';

import { getArticleCount } from '@/api/article.ts';
import { getPasteCount } from '@/api/paste.ts';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';
import type { ApiResponse } from '@/types/common';

const themeVars = inject(uiThemeKey)!;

// MUST equal `foundDate` in App.vue. See spec/about-page.spec.md §3.5 / §6.4.
const FOUNDING_DATE = new Date('2025-02-12T00:00:00Z').getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// null = still loading or failed; the statistic shows a dash instead of a misleading zero.
const articleCount = ref<number | null>(null);
const pasteCount = ref<number | null>(null);
const daysInOperation = ref(Math.floor((Date.now() - FOUNDING_DATE) / MS_PER_DAY));

const REPO_URL = 'https://github.com/laikit-dev/luogu-saver';

const features = [
    {
        icon: Newspaper,
        label: '内容归档',
        desc: '抓取并长期保存洛谷的文章与剪贴板,即使原内容被删除也可访问。'
    },
    {
        icon: Search,
        label: '全文检索',
        desc: '对已保存的内容建立索引,支持按关键词快速检索。'
    },
    {
        icon: Share2,
        label: '文章广场',
        desc: '集中浏览已归档的文章,发现值得阅读的内容。'
    },
    {
        icon: AtSign,
        label: '用户主页',
        desc: '展示用户的等级认证徽章与获奖记录。'
    },
    {
        icon: ChartNoAxesColumnIncreasing,
        label: 'RAG 问答',
        desc: '依据文本生成式 AI 检索推荐相关内容。'
    },
    {
        icon: Clipboard,
        label: '多类型支持',
        desc: '统一处理多种内容类型，持续扩展中。'
    }
];

async function loadCount(
    request: () => Promise<ApiResponse<{ count: number }>>,
    target: Ref<number | null>
) {
    try {
        const response = await request();
        if (response.code === 200) target.value = response.data.count;
    } catch {
        // The dash placeholder already communicates the failure.
    }
}

onMounted(() => {
    void loadCount(getArticleCount, articleCount);
    void loadCount(getPasteCount, pasteCount);
});
</script>

<template>
    <div class="about-view">
        <CardTitle title="关于 Luogu Saver" :icon="Globe2">
            一个用于归档洛谷用户生成内容的开源 Web 应用 · LGS
        </CardTitle>

        <Card :icon="LayoutGrid" title="项目简介" class="about-card">
            <p class="about-paragraph">
                Luogu Saver（简称
                LGS）是一个面向洛谷的内容归档应用。它将洛谷上的文章、剪贴板等用户生成内容抓取并长期保存，使有价值的内容在原始页面被删除或失效后，依然可以被检索与阅读。
            </p>
        </Card>

        <Card :icon="ChartNoAxesColumnIncreasing" title="运行统计" class="about-card">
            <n-grid :x-gap="20" :y-gap="20" cols="1 s:3" responsive="screen">
                <n-gi>
                    <n-statistic label="已运行天数" :value="daysInOperation" />
                </n-gi>
                <n-gi>
                    <n-statistic label="已归档文章" :value="articleCount ?? '—'" />
                </n-gi>
                <n-gi>
                    <n-statistic label="已归档剪贴板" :value="pasteCount ?? '—'" />
                </n-gi>
            </n-grid>
        </Card>

        <Card :icon="List" title="核心功能" class="about-card">
            <ul class="feature-list">
                <li v-for="feature in features" :key="feature.label" class="feature-item">
                    <n-icon
                        size="20"
                        :component="feature.icon"
                        :color="themeVars.primaryColor"
                        class="feature-icon"
                    />
                    <div class="feature-text">
                        <span class="feature-label">{{ feature.label }}</span>
                        <span class="feature-desc">{{ feature.desc }}</span>
                    </div>
                </li>
            </ul>
        </Card>

        <Card :icon="Hammer" title="技术与架构" class="about-card">
            <p class="about-paragraph">
                本项目采用 npm workspaces 组织的 Monorepo 结构。前端基于 Vue 3、Vite 与 Naive UI
                构建；后端基于 Koa 与 TypeScript；数据库等基础设施通过 Docker Compose 管理。项目以
                AGPL-3.0 许可证开源。
            </p>
        </Card>

        <Card :icon="Globe2" title="开源与贡献" class="about-card">
            <p class="about-paragraph">
                本项目在 GitHub 上开源，采用 AGPL-3.0 许可证。欢迎通过提交 Pull Request 参与改进。
            </p>
            <a
                class="about-link"
                :href="REPO_URL"
                target="_blank"
                rel="noopener noreferrer"
                :style="{ color: themeVars.primaryColor }"
            >
                <n-icon size="18" :component="Globe2" />
                <span>{{ REPO_URL }}</span>
            </a>
        </Card>

        <Card :icon="CloudDownload" title="数据来源与免责声明" class="about-card">
            <ul class="disclaimer-list">
                <li>本站归档的全部内容均来源于洛谷，其版权归原作者所有。</li>
                <li>本项目为非官方归档工具，与洛谷官方无任何隶属或背书关系。</li>
                <li>如相关权利人提出合理要求，本站将配合移除对应内容。</li>
            </ul>
        </Card>
    </div>
</template>

<style scoped>
.about-view {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
}

.about-paragraph {
    margin: 0;
    line-height: 1.8;
    font-size: 15px;
    color: var(--ui-text-color);
}

.feature-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--ui-space-4);
}
@media (max-width: 768px) {
    .feature-list {
        grid-template-columns: 1fr;
    }
}
.feature-item {
    display: flex;
    align-items: flex-start;
    gap: var(--ui-control-gap);
}
.feature-icon {
    flex-shrink: 0;
    margin-top: 2px;
}
.feature-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.feature-label {
    font-weight: 600;
    font-size: 14px;
}
.feature-desc {
    line-height: 1.5;
    color: var(--ui-secondary-text-color);
}

.about-link {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-inline-gap);
    margin-top: var(--ui-space-3);
    font-size: 14px;
    word-break: break-all;
    text-decoration: none;
}
.about-link:hover {
    text-decoration: underline;
}

.disclaimer-list {
    margin: 0;
    padding-left: var(--ui-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--ui-inline-gap);
}
.disclaimer-list li {
    line-height: 1.7;
    color: var(--ui-secondary-text-color);
}
</style>
