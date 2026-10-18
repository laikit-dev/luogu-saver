<script setup lang="ts">
import { computed, ref } from 'vue';
import { NAlert, NButton, NInputNumber, NSpace, NSwitch, useMessage } from 'naive-ui';
import { CloudDownload } from 'lucide-vue-next';
import AccessGate from '@/components/AccessGate.vue';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import { startUserArticleDiscovery } from '@/api/discovery.ts';
import { currentRole } from '@/utils/auth.ts';
import { ROLE_ADMIN } from '@/utils/permissions.ts';
import { requestErrorMessage } from '@/utils/request.ts';

const message = useMessage();
const uid = ref<number | null>(null);
const maxPages = ref(500);
const forceUpdate = ref(false);
const starting = ref(false);
const isAdmin = computed(() => currentRole.value === ROLE_ADMIN);

async function handleStart() {
    if (!uid.value || uid.value <= 0 || starting.value) return;
    starting.value = true;
    try {
        const response = await startUserArticleDiscovery({
            uid: uid.value,
            maxPages: maxPages.value,
            forceUpdate: forceUpdate.value
        });
        if (response.code === 200) {
            message.success(`用户文章爬取已启动：${response.data.runId}`);
        } else {
            message.error('用户文章爬取启动失败，请重试。');
        }
    } catch (error) {
        message.error(requestErrorMessage(error, '用户文章爬取启动失败，请重试。'));
    } finally {
        starting.value = false;
    }
}
</script>

<template>
    <div class="user-article-discovery-page">
        <CardTitle title="用户文章爬取" :icon="CloudDownload">
            输入洛谷 UID，批量发现并保存该用户公开文章。
        </CardTitle>

        <AccessGate :allowed="isAdmin" redirect="/discovery/user-articles">
            <Card title="启动爬取" :icon="CloudDownload">
                <n-space vertical size="large">
                    <n-alert type="warning" title="抓取说明">
                        启动该任务会爬取指定用户的所有文章进行保存。<br />
                        请不要滥用此功能！
                    </n-alert>

                    <n-space align="center" class="form-row">
                        <n-input-number
                            v-model:value="uid"
                            :min="1"
                            :show-button="false"
                            placeholder="洛谷 UID，例如 381949"
                            aria-label="洛谷 UID"
                            class="uid-input"
                        />
                        <n-input-number
                            v-model:value="maxPages"
                            :min="1"
                            :max="500"
                            placeholder="最大页数"
                            aria-label="最大页数"
                            class="page-input"
                        />
                        <label class="switch-field">
                            <span class="muted">强制更新</span>
                            <n-switch v-model:value="forceUpdate" aria-label="强制更新" />
                        </label>
                        <n-button
                            type="primary"
                            :loading="starting"
                            :disabled="!uid"
                            @click="handleStart"
                        >
                            开始爬取
                        </n-button>
                    </n-space>
                </n-space>
            </Card>
        </AccessGate>
    </div>
</template>

<style scoped>
.user-article-discovery-page {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    max-width: 1220px;
    margin: 0 auto;
}

.form-row {
    flex-wrap: wrap;
}

.uid-input {
    width: min(260px, 100%);
}

.page-input {
    width: min(160px, 100%);
}

.switch-field {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-inline-gap);
}

.muted {
    color: var(--ui-muted-text-color);
}
</style>
