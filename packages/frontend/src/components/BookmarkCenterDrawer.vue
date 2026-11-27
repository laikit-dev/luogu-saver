<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
    NButton,
    NDrawer,
    NDrawerContent,
    NEmpty,
    NIcon,
    NInput,
    NTag,
    useDialog,
    useMessage
} from 'naive-ui';
import { Bookmark, ExternalLink, Search, Trash2 } from 'lucide-vue-next';
import {
    clearAllContentBookmarks,
    deleteContentBookmark,
    listAllContentBookmarks,
    type BookmarkContentType,
    type ContentBookmarkGroup
} from '@/composables/useBookmarks';
import { uiThemeKey } from '@/styles/theme/themeKeys';
import { formatDate } from '@/utils/render';

const showDrawer = defineModel<boolean>('show', { default: false });
const drawerReady = ref(false);
// NDrawer skips its enter transition when mounted with show=true (appear is tied to isMountedRef).
const drawerShow = computed({
    get: () => drawerReady.value && showDrawer.value,
    set: value => {
        showDrawer.value = value;
    }
});

const uiTheme = inject(uiThemeKey);
const router = useRouter();
const dialog = useDialog();
const message = useMessage();

const groups = ref<ContentBookmarkGroup[]>([]);
const searchQuery = ref('');

function reloadGroups() {
    groups.value = listAllContentBookmarks();
}

onMounted(() => {
    reloadGroups();
    void nextTick(() => {
        drawerReady.value = true;
    });
});

watch(showDrawer, visible => {
    if (visible) {
        reloadGroups();
    }
});

const totalCount = computed(() =>
    groups.value.reduce((total, group) => total + group.bookmarks.length, 0)
);

function getGroupTitle(group: ContentBookmarkGroup): string {
    if (group.contentTitle) return group.contentTitle;
    return group.type === 'article' ? `文章 ${group.contentId}` : `剪贴板 ${group.contentId}`;
}

const filteredGroups = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return groups.value;

    return groups.value
        .map(group => {
            const titleMatches =
                getGroupTitle(group).toLowerCase().includes(query) ||
                group.contentId.toLowerCase().includes(query);
            if (titleMatches) return group;

            const matchedBookmarks = group.bookmarks.filter(
                bookmark =>
                    bookmark.headingText.toLowerCase().includes(query) ||
                    bookmark.name.toLowerCase().includes(query)
            );
            if (matchedBookmarks.length === 0) return null;
            return { ...group, bookmarks: matchedBookmarks };
        })
        .filter((group): group is ContentBookmarkGroup => group !== null);
});

async function navigateToBookmark(group: ContentBookmarkGroup, headingId: string) {
    showDrawer.value = false;
    await router.push(`/${group.type}/${group.contentId}#${encodeURIComponent(headingId)}`);
}

function handleDeleteBookmark(type: BookmarkContentType, contentId: string, bookmarkId: string) {
    deleteContentBookmark(type, contentId, bookmarkId);
    reloadGroups();
    message.success('已删除该段落收藏');
}

function handleClearAll() {
    if (totalCount.value === 0) return;
    dialog.warning({
        title: '清空全部段落收藏？',
        content: `这会删除全部 ${totalCount.value} 条段落收藏，且无法恢复。`,
        positiveText: '清空',
        negativeText: '取消',
        positiveButtonProps: { type: 'error' },
        onPositiveClick: () => {
            clearAllContentBookmarks();
            reloadGroups();
            searchQuery.value = '';
            message.success('已清空全部段落收藏');
        }
    });
}
</script>

<template>
    <n-drawer
        v-model:show="drawerShow"
        width="min(420px, calc(100vw - 24px))"
        placement="right"
        :theme-overrides="{
            color: uiTheme?.cardColor,
            borderRadius: uiTheme?.cardRadius,
            boxShadow: uiTheme?.cardShadow,
            titleTextColor: uiTheme?.cardTitleColor,
            textColor: uiTheme?.textColor
        }"
    >
        <n-drawer-content
            title="我的段落收藏"
            closable
            :style="{ '--n-color': uiTheme?.cardColor }"
        >
            <div class="bookmark-drawer-body">
                <n-input
                    v-if="groups.length > 0"
                    v-model:value="searchQuery"
                    clearable
                    aria-label="筛选段落收藏"
                    placeholder="筛选文章、标题或收藏名…"
                >
                    <template #prefix>
                        <n-icon :component="Search" />
                    </template>
                </n-input>

                <n-empty
                    v-if="groups.length === 0"
                    class="bookmark-empty"
                    description="暂无段落收藏"
                >
                    <template #icon>
                        <n-icon :component="Bookmark" />
                    </template>
                    <template #extra>
                        <span class="empty-hint">
                            在任意文章或剪贴板的章节标题左侧点击星标，即可快速收藏到此处。
                        </span>
                    </template>
                </n-empty>

                <n-empty
                    v-else-if="filteredGroups.length === 0"
                    class="bookmark-empty"
                    description="没有匹配的段落收藏"
                />

                <div v-else class="bookmark-group-list">
                    <section
                        v-for="group in filteredGroups"
                        :key="`${group.type}_${group.contentId}`"
                        class="bookmark-group-card"
                    >
                        <header class="group-header">
                            <n-tag
                                size="small"
                                :type="group.type === 'article' ? 'info' : 'success'"
                                :bordered="false"
                            >
                                {{ group.type === 'article' ? '文章' : '剪贴板' }}
                            </n-tag>
                            <router-link
                                :to="`/${group.type}/${group.contentId}`"
                                class="group-title-link"
                                @click="showDrawer = false"
                            >
                                {{ getGroupTitle(group) }}
                            </router-link>
                        </header>

                        <ul class="bookmark-item-list">
                            <li
                                v-for="bookmark in group.bookmarks"
                                :key="bookmark.id"
                                class="bookmark-row"
                            >
                                <button
                                    type="button"
                                    class="bookmark-jump-btn"
                                    @click="navigateToBookmark(group, bookmark.headingId)"
                                >
                                    <span class="bookmark-heading-text">
                                        {{ bookmark.headingText || bookmark.name }}
                                    </span>
                                    <span class="bookmark-meta-line">
                                        <span>#{{ bookmark.headingId }}</span>
                                        <span>·</span>
                                        <span>{{ formatDate(bookmark.createdAt) }}</span>
                                    </span>
                                </button>
                                <div class="bookmark-row-actions">
                                    <n-button
                                        text
                                        size="tiny"
                                        aria-label="跳转到该段落"
                                        @click="navigateToBookmark(group, bookmark.headingId)"
                                    >
                                        <template #icon>
                                            <n-icon :component="ExternalLink" :size="14" />
                                        </template>
                                    </n-button>
                                    <n-button
                                        text
                                        size="tiny"
                                        type="error"
                                        aria-label="删除段落收藏"
                                        @click="
                                            handleDeleteBookmark(
                                                group.type,
                                                group.contentId,
                                                bookmark.id
                                            )
                                        "
                                    >
                                        <template #icon>
                                            <n-icon :component="Trash2" :size="14" />
                                        </template>
                                    </n-button>
                                </div>
                            </li>
                        </ul>
                    </section>
                </div>
            </div>

            <template v-if="totalCount > 0" #footer>
                <div class="bookmark-drawer-footer">
                    <span class="footer-count">共 {{ totalCount }} 条收藏</span>
                    <n-button size="small" secondary type="error" @click="handleClearAll">
                        清空全部
                    </n-button>
                </div>
            </template>
        </n-drawer-content>
    </n-drawer>
</template>

<style scoped>
.bookmark-drawer-body {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    min-width: 0;
    max-width: 100%;
}

.bookmark-empty {
    padding: var(--ui-space-8) var(--ui-space-3);
}

.empty-hint {
    display: block;
    max-width: 240px;
    color: var(--ui-muted-text-color);
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
}

.bookmark-group-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    min-width: 0;
}

.bookmark-group-card {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    padding: var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.group-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    min-width: 0;
    margin-bottom: var(--ui-space-2);
}

.group-title-link {
    flex: 1;
    min-width: 0;
    color: var(--ui-card-title-color);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
}

.group-title-link:hover {
    color: var(--ui-primary-color);
}

.bookmark-item-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.bookmark-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--ui-button-radius);
    background: var(--ui-card-color);
    border: 1px solid var(--ui-border-color);
}

.bookmark-jump-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.bookmark-heading-text {
    width: 100%;
    font-size: 13px;
    font-weight: 500;
    color: var(--ui-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bookmark-jump-btn:hover .bookmark-heading-text {
    color: var(--ui-primary-color);
}

.bookmark-meta-line {
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-size: 11px;
    color: var(--ui-muted-text-color);
    overflow: hidden;
    white-space: nowrap;
}

.bookmark-meta-line > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
}

.bookmark-row-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.bookmark-drawer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.footer-count {
    font-size: 12px;
    color: var(--ui-muted-text-color);
}
</style>
