<script setup lang="ts">
import { computed } from 'vue';
import { NIcon } from 'naive-ui';
import { User } from 'lucide-vue-next';
import UserLink from '@/components/UserLink.vue';
import type { ArticleSearchHit } from '@/api/search';
import { renderSafeMarkedHtml } from '@/utils/render';

const props = defineProps<{
    hit: ArticleSearchHit;
}>();

const user = computed(() => {
    const { author, authorId, authorName } = props.hit;
    return (
        author ?? {
            id: Number.isInteger(authorId) && authorId > 0 && authorId <= 4294967295 ? authorId : 0,
            name: authorName || '-'
        }
    );
});

const markedName = computed(() => {
    const { author, authorName, formatted } = props.hit;
    return !author || author.name === authorName ? formatted?.authorName : undefined;
});
</script>

<template>
    <span class="search-author">
        <n-icon :component="User" aria-hidden="true" />
        <UserLink :user="user">
            <template v-if="markedName" #name>
                <span v-html="renderSafeMarkedHtml(markedName)" />
            </template>
        </UserLink>
    </span>
</template>

<style scoped>
.search-author {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
    min-width: 0;
    max-width: 100%;
}

.search-author :deep(mark) {
    color: inherit;
    background: color-mix(in srgb, currentColor 18%, transparent);
}
</style>
