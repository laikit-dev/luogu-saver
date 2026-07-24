<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NIcon, NInput, NPopover, NTimeline, NTimelineItem, useMessage } from 'naive-ui';
import { Star, Clock3, Trash2, Settings } from 'lucide-vue-next';
import SidebarWidget from '@/components/SidebarWidget.vue';
import TableOfContents from '@/components/TableOfContents.vue';
import type { TocItem } from '@/types/article';
import type { Bookmark } from '@/composables/useBookmarks';
import { formatDate } from '@/utils/render';

interface VersionItem {
    version: number;
    createdAt: string;
    title?: string;
}

defineProps<{
    tocItems: TocItem[];
    bookmarks: Bookmark[];
    versionHistory: VersionItem[];
    selectedVersion: number | null;
}>();

const emit = defineEmits<{
    'remove-bookmark': [bookmarkId: string];
    'rename-bookmark': [bookmarkId: string, newName: string];
    'select-version': [version: number];
}>();

const message = useMessage();
const versionPopoverVisible = ref(false);

const editingBookmarkId = ref<string | null>(null);
const editingBookmarkName = ref('');

const startRename = (bookmark: Bookmark) => {
    editingBookmarkId.value = bookmark.id;
    editingBookmarkName.value = bookmark.name;
};

const confirmRename = (bookmarkId: string) => {
    const name = editingBookmarkName.value.trim();
    if (!name) {
        message.warning('段落收藏名称不能为空');
        return;
    }
    emit('rename-bookmark', bookmarkId, name);
    editingBookmarkId.value = null;
};

const cancelRename = () => {
    editingBookmarkId.value = null;
};

const handleScrollTo = (headingId: string) => {
    const el = document.getElementById(headingId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};
</script>

<template>
    <div class="focus-sidebar">
        <SidebarWidget
            v-if="versionHistory.length > 0"
            title="历史版本"
            :icon="Clock3"
            class="version-card"
        >
            <n-popover
                v-model:show="versionPopoverVisible"
                trigger="click"
                placement="bottom-end"
                :width="320"
            >
                <template #trigger>
                    <n-button size="small" secondary block>
                        <template #icon>
                            <NIcon :component="Clock3" />
                        </template>
                        {{ selectedVersion ? `版本 ${selectedVersion}` : '选择版本' }}
                    </n-button>
                </template>
                <n-timeline class="version-timeline-popover">
                    <n-timeline-item
                        v-for="ver in versionHistory"
                        :key="ver.version"
                        :title="`版本 ${ver.version}`"
                        :content="ver.title"
                        :time="formatDate(ver.createdAt)"
                        :type="selectedVersion === ver.version ? 'success' : 'default'"
                        class="version-timeline-item"
                        @click="
                            emit('select-version', ver.version);
                            versionPopoverVisible = false;
                        "
                    />
                </n-timeline>
            </n-popover>
        </SidebarWidget>

        <TableOfContents :items="tocItems" max-height="32vh" />

        <SidebarWidget title="段落收藏" :icon="Star" class="bookmarks-card">
            <div v-if="bookmarks.length === 0" class="bookmarks-empty">
                暂无段落收藏。点击标题旁的星标图标即可添加。
            </div>

            <div v-else class="bookmarks-list">
                <div v-for="bm in bookmarks" :key="bm.id" class="bookmark-item">
                    <div v-if="editingBookmarkId !== bm.id" class="bookmark-row">
                        <button class="bookmark-link" @click="handleScrollTo(bm.headingId)">
                            {{ bm.name }}
                        </button>
                        <div class="bookmark-actions">
                            <n-button text size="tiny" @click.stop="startRename(bm)">
                                <template #icon>
                                    <NIcon :component="Settings" />
                                </template>
                            </n-button>
                            <n-button
                                text
                                size="tiny"
                                type="error"
                                @click.stop="emit('remove-bookmark', bm.id)"
                            >
                                <template #icon>
                                    <NIcon :component="Trash2" />
                                </template>
                            </n-button>
                        </div>
                    </div>
                    <div v-else class="bookmark-edit-row">
                        <n-input
                            v-model:value="editingBookmarkName"
                            size="tiny"
                            autofocus
                            @keyup.enter="confirmRename(bm.id)"
                            @keyup.escape="cancelRename"
                        />
                        <n-button size="tiny" type="primary" @click="confirmRename(bm.id)">
                            确定
                        </n-button>
                        <n-button size="tiny" @click="cancelRename"> 取消 </n-button>
                    </div>
                </div>
            </div>
        </SidebarWidget>
    </div>
</template>

<style scoped>
.focus-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: calc(100vh - 24px);
    overflow: hidden;
}

.version-card {
    margin-top: 0;
}

.bookmarks-card {
    margin-top: 0;
    box-sizing: border-box;
    height: 32vh;
    max-height: 32vh;
    flex: 0 0 32vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.bookmarks-card :deep(.widget-content) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
}

.bookmarks-empty {
    color: var(--ui-muted-text-color);
    font-size: 13px;
    line-height: 1.6;
}

.bookmarks-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.bookmark-item {
    border-radius: var(--ui-card-radius);
    transition: background-color 0.15s ease;
}

.bookmark-item:hover {
    background: var(--ui-panel-color);
}

.bookmark-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
}

.bookmark-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--ui-text-color);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.5;
}

.bookmark-link:hover {
    color: var(--ui-primary-color);
}

.bookmark-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s ease;
    flex-shrink: 0;
}

.bookmark-item:hover .bookmark-actions {
    opacity: 1;
}

.bookmark-edit-row {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
}

.bookmark-edit-row :deep(.n-input) {
    flex: 1;
}

.version-timeline-popover {
    max-height: 360px;
    overflow-y: auto;
    padding: 4px;
}

.version-timeline-item {
    cursor: pointer;
}

.version-timeline-item:hover {
    background: var(--ui-panel-color);
    border-radius: var(--ui-card-radius);
}

@media (max-width: 1200px) {
    .focus-sidebar {
        max-height: none;
        overflow: visible;
    }

    .bookmarks-card {
        height: auto;
        max-height: none;
        flex-basis: auto;
    }

    .bookmarks-card :deep(.widget-content),
    .bookmarks-list {
        overflow: visible;
    }
}
</style>
