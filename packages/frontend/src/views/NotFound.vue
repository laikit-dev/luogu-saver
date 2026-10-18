<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { NButton, NIcon } from 'naive-ui';
import { House, MapPinOff } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
</script>

<template>
    <div class="not-found-page">
        <CardTitle title="页面不存在" :icon="MapPinOff">
            你访问的地址不存在或已被移除，可以返回首页重新查找内容。
        </CardTitle>

        <Card>
            <p class="not-found-text">请检查链接是否完整，或通过首页搜索文章、剪贴板和用户。</p>
            <RouterLink v-slot="{ href, navigate }" to="/" custom>
                <n-button tag="a" type="primary" :href="href" @click="navigate">
                    <template #icon>
                        <n-icon :component="House" />
                    </template>
                    返回首页
                </n-button>
            </RouterLink>
        </Card>
    </div>
</template>

<style scoped>
.not-found-page {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    max-width: 1220px;
    margin: 0 auto;
}

.not-found-text {
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    line-height: 1.6;
}
</style>
