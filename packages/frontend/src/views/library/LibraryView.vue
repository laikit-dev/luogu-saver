<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import {
    NAlert,
    NButton,
    NEmpty,
    NInput,
    NPagination,
    NSpin,
    NSwitch,
    NTabPane,
    NTabs,
    useMessage
} from 'naive-ui';
import { Bookmark, Library, Rss, Users } from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import ArchiveTimeline from '@/components/ArchiveTimeline.vue';
import {
    getArchiveDigestPreference,
    getFollowedAuthors,
    getSavedArticles,
    setArchiveDigestPreference,
    setArticleSaved,
    setAuthorFollow
} from '@/api/archive.ts';
import type {
    DigestPreference,
    FollowedAuthor,
    LibraryPage,
    SavedArticleItem
} from '@/api/archive.ts';
import { authToken, currentAuth, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { formatDate } from '@/utils/render.ts';
import { archiveTabProps, selectedArchiveTabProps } from '@/utils/archive-tab-props';
import { requestErrorMessage } from '@/utils/request.ts';

type LibraryTab = 'feed' | 'follows' | 'saved';
type AccessIssue = 'expired' | 'forbidden';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const pageSize = 20;
const activeTab = computed<LibraryTab>(() => {
    const tab = route.query.tab;
    return tab === 'follows' || tab === 'saved' ? tab : 'feed';
});
const accountRevision = ref(0);
const feedRefresh = ref(0);
const followsRefresh = ref(0);
const savedRefresh = ref(0);
const followsPage = ref(1);
const savedPage = ref(1);
const followedAuthors = ref<LibraryPage<FollowedAuthor> | null>(null);
const savedArticles = ref<LibraryPage<SavedArticleItem> | null>(null);
const followsLoading = ref(false);
const savedLoading = ref(false);
const followsError = ref('');
const savedError = ref('');
const followsActionError = ref('');
const savedActionError = ref('');
const followsAccess = ref<AccessIssue | null>(null);
const savedAccess = ref<AccessIssue | null>(null);
const followBusy = ref<number | 'add' | null>(null);
const savedBusy = ref<string | null>(null);
const uidInput = ref('');
const followUid = computed(() => {
    const value = uidInput.value.trim();
    if (!/^\d{1,10}$/.test(value)) return null;
    const uid = Number(value);
    return uid >= 1 && uid <= 4294967295 ? uid : null;
});
const digestPreference = ref<DigestPreference | null>(null);
const digestLoading = ref(false);
const digestSaving = ref(false);
const digestError = ref('');
const digestAccess = ref<AccessIssue | null>(null);
let followsRequest = 0;
let savedRequest = 0;
let digestRequest = 0;
let disposed = false;

const accessMessages: Record<'follows' | 'saved' | 'digest', Record<AccessIssue, string>> = {
    follows: {
        expired: '登录已失效，请使用 CP OAuth 重新登录后管理关注作者。',
        forbidden: '当前账号无权使用私人关注，账号可能已被封禁。'
    },
    saved: {
        expired: '登录已失效，请使用 CP OAuth 重新登录后管理稍后阅读。',
        forbidden: '当前账号无权使用稍后阅读，账号可能已被封禁。'
    },
    digest: {
        expired: '登录已失效，请使用 CP OAuth 重新登录后管理摘要设置。',
        forbidden: '当前账号无权管理每日站内摘要，账号可能已被封禁。'
    }
};

/** Maps a backend envelope code or HTTP status to the access problem it signals, if any. */
function accessIssueOf(code: number | undefined): AccessIssue | null {
    if (code === 401) return 'expired';
    if (code === 403) return 'forbidden';
    return null;
}

function httpStatus(error: unknown): number | undefined {
    return isAxiosError(error) ? error.response?.status : undefined;
}

watch(
    () => route.query.tab,
    tab => {
        if (tab !== 'feed' && tab !== 'follows' && tab !== 'saved') {
            void router.replace({ query: { ...route.query, tab: 'feed' } });
        }
    },
    { immediate: true }
);

watch(
    [authToken, () => currentAuth.value?.registeredUser?.id],
    () => {
        followsRequest += 1;
        savedRequest += 1;
        digestRequest += 1;
        followedAuthors.value = null;
        savedArticles.value = null;
        digestPreference.value = null;
        followsLoading.value = false;
        savedLoading.value = false;
        digestLoading.value = false;
        digestSaving.value = false;
        followsError.value = '';
        savedError.value = '';
        followsActionError.value = '';
        savedActionError.value = '';
        digestError.value = '';
        followsAccess.value = null;
        savedAccess.value = null;
        digestAccess.value = null;
        followBusy.value = null;
        savedBusy.value = null;
        uidInput.value = '';
        followsPage.value = 1;
        savedPage.value = 1;
        accountRevision.value += 1;
    },
    { immediate: true, flush: 'sync' }
);

async function loadFollowedAuthors() {
    const request = ++followsRequest;
    followsLoading.value = false;
    if (disposed || !isAuthenticated.value || activeTab.value !== 'follows') return;
    const account = accountRevision.value;
    const page = followsPage.value;
    followedAuthors.value = null;
    followsLoading.value = true;
    followsError.value = '';
    followsAccess.value = null;
    try {
        const response = await getFollowedAuthors(page, pageSize);
        if (
            disposed ||
            request !== followsRequest ||
            account !== accountRevision.value ||
            activeTab.value !== 'follows' ||
            page !== followsPage.value
        )
            return;
        if (response.code === 200) {
            followedAuthors.value = response.data;
        } else {
            followsAccess.value = accessIssueOf(response.code);
            followsError.value = followsAccess.value
                ? accessMessages.follows[followsAccess.value]
                : '加载关注列表失败，请重试。';
        }
    } catch (error) {
        if (
            disposed ||
            request !== followsRequest ||
            account !== accountRevision.value ||
            activeTab.value !== 'follows' ||
            page !== followsPage.value
        )
            return;
        followsAccess.value = accessIssueOf(httpStatus(error));
        followsError.value = followsAccess.value
            ? accessMessages.follows[followsAccess.value]
            : requestErrorMessage(error, '加载关注列表失败，请重试。');
    } finally {
        if (request === followsRequest && account === accountRevision.value) {
            followsLoading.value = false;
        }
    }
}

async function loadSavedArticles() {
    const request = ++savedRequest;
    savedLoading.value = false;
    if (disposed || !isAuthenticated.value || activeTab.value !== 'saved') return;
    const account = accountRevision.value;
    const page = savedPage.value;
    savedArticles.value = null;
    savedLoading.value = true;
    savedError.value = '';
    savedAccess.value = null;
    try {
        const response = await getSavedArticles(page, pageSize);
        if (
            disposed ||
            request !== savedRequest ||
            account !== accountRevision.value ||
            activeTab.value !== 'saved' ||
            page !== savedPage.value
        )
            return;
        if (response.code === 200) {
            savedArticles.value = response.data;
        } else {
            savedAccess.value = accessIssueOf(response.code);
            savedError.value = savedAccess.value
                ? accessMessages.saved[savedAccess.value]
                : '加载稍后阅读失败，请重试。';
        }
    } catch (error) {
        if (
            disposed ||
            request !== savedRequest ||
            account !== accountRevision.value ||
            activeTab.value !== 'saved' ||
            page !== savedPage.value
        )
            return;
        savedAccess.value = accessIssueOf(httpStatus(error));
        savedError.value = savedAccess.value
            ? accessMessages.saved[savedAccess.value]
            : requestErrorMessage(error, '加载稍后阅读失败，请重试。');
    } finally {
        if (request === savedRequest && account === accountRevision.value) {
            savedLoading.value = false;
        }
    }
}

async function addFollow() {
    const uid = followUid.value;
    if (!isAuthenticated.value || uid === null || followBusy.value !== null) return;
    const account = accountRevision.value;
    followBusy.value = 'add';
    followsActionError.value = '';
    try {
        const response = await setAuthorFollow(uid, true);
        if (disposed || account !== accountRevision.value) return;
        if (response.code === 200 && response.data.following) {
            uidInput.value = '';
            followsRequest += 1;
            followedAuthors.value = null;
            followsPage.value = 1;
            followsRefresh.value += 1;
            feedRefresh.value += 1;
            message.success('已关注该洛谷 UID');
        } else {
            followsAccess.value = accessIssueOf(response.code);
            if (followsAccess.value) {
                followsRequest += 1;
                followedAuthors.value = null;
                followsLoading.value = false;
            }
            followsActionError.value = followsAccess.value
                ? accessMessages.follows[followsAccess.value]
                : '添加关注失败，请重试。';
        }
    } catch (error) {
        if (disposed || account !== accountRevision.value) return;
        followsAccess.value = accessIssueOf(httpStatus(error));
        if (followsAccess.value) {
            followsRequest += 1;
            followedAuthors.value = null;
            followsLoading.value = false;
        }
        followsActionError.value = followsAccess.value
            ? accessMessages.follows[followsAccess.value]
            : requestErrorMessage(error, '添加关注失败，未能确认结果，请重试。');
    } finally {
        if (account === accountRevision.value) followBusy.value = null;
    }
}

async function removeFollow(uid: number) {
    if (!isAuthenticated.value || followBusy.value !== null) return;
    const account = accountRevision.value;
    followBusy.value = uid;
    followsActionError.value = '';
    try {
        const response = await setAuthorFollow(uid, false);
        if (disposed || account !== accountRevision.value) return;
        if (response.code === 200 && !response.data.following) {
            const remaining = Math.max(0, (followedAuthors.value?.total ?? 1) - 1);
            followsRequest += 1;
            followedAuthors.value = null;
            followsPage.value = Math.min(
                followsPage.value,
                Math.max(1, Math.ceil(remaining / pageSize))
            );
            followsRefresh.value += 1;
            feedRefresh.value += 1;
            message.success('已取消关注');
        } else {
            followsAccess.value = accessIssueOf(response.code);
            if (followsAccess.value) {
                followsRequest += 1;
                followedAuthors.value = null;
                followsLoading.value = false;
            }
            followsActionError.value = followsAccess.value
                ? accessMessages.follows[followsAccess.value]
                : '取消关注失败，请重试。';
        }
    } catch (error) {
        if (disposed || account !== accountRevision.value) return;
        followsAccess.value = accessIssueOf(httpStatus(error));
        if (followsAccess.value) {
            followsRequest += 1;
            followedAuthors.value = null;
            followsLoading.value = false;
        }
        followsActionError.value = followsAccess.value
            ? accessMessages.follows[followsAccess.value]
            : requestErrorMessage(error, '取消关注失败，未能确认结果，请重试。');
    } finally {
        if (account === accountRevision.value) followBusy.value = null;
    }
}

async function removeSavedArticle(articleId: string) {
    if (!isAuthenticated.value || savedBusy.value !== null) return;
    const account = accountRevision.value;
    savedBusy.value = articleId;
    savedActionError.value = '';
    try {
        const response = await setArticleSaved(articleId, false);
        if (disposed || account !== accountRevision.value) return;
        if (response.code === 200 && !response.data.saved) {
            const remaining = Math.max(0, (savedArticles.value?.total ?? 1) - 1);
            savedRequest += 1;
            savedArticles.value = null;
            savedPage.value = Math.min(
                savedPage.value,
                Math.max(1, Math.ceil(remaining / pageSize))
            );
            savedRefresh.value += 1;
            feedRefresh.value += 1;
            message.success('已移出稍后阅读');
        } else {
            savedAccess.value = accessIssueOf(response.code);
            if (savedAccess.value) {
                savedRequest += 1;
                savedArticles.value = null;
                savedLoading.value = false;
            }
            savedActionError.value = savedAccess.value
                ? accessMessages.saved[savedAccess.value]
                : '移除稍后阅读失败，请重试。';
        }
    } catch (error) {
        if (disposed || account !== accountRevision.value) return;
        savedAccess.value = accessIssueOf(httpStatus(error));
        if (savedAccess.value) {
            savedRequest += 1;
            savedArticles.value = null;
            savedLoading.value = false;
        }
        savedActionError.value = savedAccess.value
            ? accessMessages.saved[savedAccess.value]
            : requestErrorMessage(error, '移除稍后阅读失败，未能确认结果，请重试。');
    } finally {
        if (account === accountRevision.value) savedBusy.value = null;
    }
}

async function loadDigestPreference() {
    const request = ++digestRequest;
    digestLoading.value = false;
    if (disposed || !isAuthenticated.value) return;
    const account = accountRevision.value;
    digestPreference.value = null;
    digestLoading.value = true;
    digestError.value = '';
    digestAccess.value = null;
    try {
        const response = await getArchiveDigestPreference();
        if (disposed || request !== digestRequest || account !== accountRevision.value) return;
        if (response.code === 200) {
            digestPreference.value = response.data;
        } else {
            digestAccess.value = accessIssueOf(response.code);
            digestError.value = digestAccess.value
                ? accessMessages.digest[digestAccess.value]
                : '读取摘要设置失败，请重试。';
        }
    } catch (error) {
        if (disposed || request !== digestRequest || account !== accountRevision.value) return;
        digestAccess.value = accessIssueOf(httpStatus(error));
        digestError.value = digestAccess.value
            ? accessMessages.digest[digestAccess.value]
            : requestErrorMessage(error, '读取摘要设置失败，请重试。');
    } finally {
        if (request === digestRequest && account === accountRevision.value)
            digestLoading.value = false;
    }
}

async function updateDigestPreference(enabled: boolean) {
    if (
        !isAuthenticated.value ||
        !digestPreference.value ||
        digestLoading.value ||
        digestSaving.value
    )
        return;
    const account = accountRevision.value;
    const request = ++digestRequest;
    digestSaving.value = true;
    digestError.value = '';
    try {
        const response = await setArchiveDigestPreference(enabled);
        if (disposed || request !== digestRequest || account !== accountRevision.value) return;
        if (response.code === 200) {
            digestPreference.value = response.data;
            message.success(response.data.enabled ? '已开启每日站内摘要' : '已关闭每日站内摘要');
        } else {
            digestAccess.value = accessIssueOf(response.code);
            if (digestAccess.value) digestPreference.value = null;
            digestError.value = digestAccess.value
                ? accessMessages.digest[digestAccess.value]
                : '更新摘要设置失败，请重试。';
        }
    } catch (error) {
        if (disposed || request !== digestRequest || account !== accountRevision.value) return;
        digestAccess.value = accessIssueOf(httpStatus(error));
        if (digestAccess.value) digestPreference.value = null;
        digestError.value = digestAccess.value
            ? accessMessages.digest[digestAccess.value]
            : requestErrorMessage(error, '更新摘要设置失败，未能确认结果，请重新读取。');
    } finally {
        if (request === digestRequest && account === accountRevision.value)
            digestSaving.value = false;
    }
}

watch(
    [activeTab, followsPage, accountRevision, followsRefresh],
    () => {
        void loadFollowedAuthors();
    },
    { immediate: true }
);
watch(
    [activeTab, savedPage, accountRevision, savedRefresh],
    () => {
        void loadSavedArticles();
    },
    { immediate: true }
);
watch(
    accountRevision,
    () => {
        void loadDigestPreference();
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    disposed = true;
    followsRequest += 1;
    savedRequest += 1;
    digestRequest += 1;
});
</script>

<template>
    <div class="archive-library-view">
        <CardTitle title="我的归档" :icon="Library">
            关注作者、保存待读文章，并查看它们在本站的归档动态。清单与摘要偏好仅对当前登录账号可见。
        </CardTitle>

        <Card v-if="!isAuthenticated" title="登录后使用私人清单">
            <div class="archive-library-stack">
                <p class="archive-library-description">
                    使用 CP OAuth 登录后，关注与稍后阅读会保存到账号中，可在不同设备上继续使用。
                </p>
                <div class="archive-library-actions">
                    <n-button type="primary" @click="startCpOAuthLogin(route.fullPath)">
                        使用 CP OAuth 登录
                    </n-button>
                </div>
            </div>
        </Card>

        <template v-else>
            <Card title="每日站内摘要">
                <div class="archive-library-stack">
                    <div class="archive-digest-row">
                        <div class="archive-digest-copy">
                            <p class="archive-library-description">
                                默认关闭。开启后，约每 24
                                小时检查关注与稍后阅读的新增归档；有新增记录时发送站内通知。
                            </p>
                            <p v-if="digestPreference" class="archive-library-meta">
                                <template v-if="digestPreference.enabled">
                                    下次摘要时间：
                                    {{
                                        digestPreference.nextDigestAt
                                            ? formatDate(digestPreference.nextDigestAt)
                                            : '暂未提供'
                                    }}
                                    （无新增归档时不发送）
                                </template>
                                <template v-else>每日站内摘要已关闭</template>
                            </p>
                        </div>
                        <n-spin v-if="digestLoading" size="small" aria-label="正在读取摘要设置" />
                        <n-switch
                            v-else-if="digestPreference"
                            :value="digestPreference.enabled"
                            :loading="digestSaving"
                            :disabled="digestSaving"
                            aria-label="每日站内摘要"
                            @update:value="updateDigestPreference"
                        />
                    </div>
                    <n-alert v-if="digestError" type="error" :show-icon="true">
                        <div class="archive-library-stack">
                            <span>{{ digestError }}</span>
                            <div
                                v-if="digestAccess !== 'forbidden'"
                                class="archive-library-actions"
                            >
                                <n-button
                                    v-if="digestAccess === 'expired'"
                                    type="primary"
                                    @click="startCpOAuthLogin(route.fullPath)"
                                >
                                    使用 CP OAuth 重新登录
                                </n-button>
                                <n-button
                                    v-else
                                    secondary
                                    :disabled="digestSaving"
                                    @click="loadDigestPreference"
                                >
                                    重新读取
                                </n-button>
                            </div>
                        </div>
                    </n-alert>
                </div>
            </Card>

            <n-tabs
                type="line"
                :value="activeTab"
                @update:value="tab => router.push({ query: { ...route.query, tab } })"
            >
                <n-tab-pane
                    name="feed"
                    tab="关注动态"
                    :tab-props="activeTab === 'feed' ? selectedArchiveTabProps : archiveTabProps"
                >
                    <Card v-if="activeTab === 'feed'" title="关注动态" :icon="Rss">
                        <template #header-extra>
                            <n-button size="small" secondary @click="feedRefresh += 1"
                                >刷新</n-button
                            >
                        </template>
                        <ArchiveTimeline
                            :key="accountRevision"
                            :scope="{ type: 'library' }"
                            :refresh-key="feedRefresh"
                        />
                    </Card>
                </n-tab-pane>

                <n-tab-pane
                    name="follows"
                    tab="关注作者"
                    :tab-props="activeTab === 'follows' ? selectedArchiveTabProps : archiveTabProps"
                >
                    <Card v-if="activeTab === 'follows'" title="关注作者" :icon="Users">
                        <div class="archive-library-stack">
                            <form class="archive-follow-form" @submit.prevent="addFollow">
                                <label for="archive-follow-uid">洛谷 UID</label>
                                <div class="archive-follow-toolbar">
                                    <n-input
                                        v-model:value="uidInput"
                                        class="archive-follow-input"
                                        placeholder="输入要关注的洛谷 UID"
                                        :input-props="{
                                            id: 'archive-follow-uid',
                                            inputmode: 'numeric',
                                            'aria-describedby': 'archive-follow-help'
                                        }"
                                        :disabled="followBusy !== null || followsAccess !== null"
                                        clearable
                                    />
                                    <n-button
                                        type="primary"
                                        attr-type="submit"
                                        :loading="followBusy === 'add'"
                                        :disabled="
                                            followUid === null ||
                                            followBusy !== null ||
                                            followsAccess !== null
                                        "
                                    >
                                        添加关注
                                    </n-button>
                                </div>
                                <p id="archive-follow-help" class="archive-library-description">
                                    可以关注本站尚未收录的
                                    UID；关注不会触发抓取，仅汇总本站已有的公开归档。
                                </p>
                            </form>

                            <n-alert v-if="followsActionError" type="error">{{
                                followsActionError
                            }}</n-alert>
                            <n-alert v-if="followsError" type="error">{{ followsError }}</n-alert>
                            <div v-if="followsAccess === 'expired'" class="archive-library-actions">
                                <n-button type="primary" @click="startCpOAuthLogin(route.fullPath)"
                                    >使用 CP OAuth 重新登录</n-button
                                >
                            </div>
                            <div
                                v-else-if="followsError && !followsAccess"
                                class="archive-library-actions"
                            >
                                <n-button secondary @click="loadFollowedAuthors">重试</n-button>
                            </div>

                            <div
                                v-if="followsLoading"
                                class="archive-library-loading"
                                role="status"
                            >
                                <n-spin size="small" />
                                <span>正在加载关注作者</span>
                            </div>
                            <template v-else-if="followedAuthors">
                                <p class="archive-library-description">
                                    共关注 {{ followedAuthors.total }} 个 UID
                                </p>
                                <n-empty
                                    v-if="followedAuthors.items.length === 0"
                                    description="还没有关注作者"
                                />
                                <ul v-else class="archive-library-list">
                                    <li
                                        v-for="author in followedAuthors.items"
                                        :key="author.uid"
                                        class="archive-library-item"
                                    >
                                        <div class="archive-library-item-copy">
                                            <router-link
                                                :to="`/user/${author.uid}`"
                                                class="archive-library-title-link"
                                                :class="
                                                    author.color
                                                        ? `user-${author.color}`
                                                        : undefined
                                                "
                                            >
                                                {{ author.name ?? `洛谷 UID ${author.uid}` }}
                                            </router-link>
                                            <p class="archive-library-meta">
                                                UID {{ author.uid }} · 关注于
                                                {{ formatDate(author.followedAt) }}
                                            </p>
                                        </div>
                                        <n-button
                                            secondary
                                            :loading="followBusy === author.uid"
                                            :disabled="followBusy !== null"
                                            @click="removeFollow(author.uid)"
                                        >
                                            取消关注
                                        </n-button>
                                    </li>
                                </ul>
                                <div
                                    v-if="followedAuthors.total > pageSize"
                                    class="archive-library-pagination"
                                >
                                    <n-pagination
                                        v-model:page="followsPage"
                                        :page-size="pageSize"
                                        :item-count="followedAuthors.total"
                                        simple
                                        :disabled="followBusy !== null"
                                    />
                                </div>
                            </template>
                        </div>
                    </Card>
                </n-tab-pane>

                <n-tab-pane
                    name="saved"
                    tab="稍后阅读"
                    :tab-props="activeTab === 'saved' ? selectedArchiveTabProps : archiveTabProps"
                >
                    <Card v-if="activeTab === 'saved'" title="稍后阅读" :icon="Bookmark">
                        <div class="archive-library-stack">
                            <p class="archive-library-description">
                                在文章页点击“加入稍后阅读”，即可将文章保存到当前登录账号；这与本机的段落书签相互独立。
                            </p>
                            <n-alert v-if="savedActionError" type="error">{{
                                savedActionError
                            }}</n-alert>
                            <n-alert v-if="savedError" type="error">{{ savedError }}</n-alert>
                            <div v-if="savedAccess === 'expired'" class="archive-library-actions">
                                <n-button type="primary" @click="startCpOAuthLogin(route.fullPath)"
                                    >使用 CP OAuth 重新登录</n-button
                                >
                            </div>
                            <div
                                v-else-if="savedError && !savedAccess"
                                class="archive-library-actions"
                            >
                                <n-button secondary @click="loadSavedArticles">重试</n-button>
                            </div>

                            <div v-if="savedLoading" class="archive-library-loading" role="status">
                                <n-spin size="small" />
                                <span>正在加载稍后阅读</span>
                            </div>
                            <template v-else-if="savedArticles">
                                <p class="archive-library-description">
                                    共 {{ savedArticles.total }} 篇待读文章
                                </p>
                                <n-empty
                                    v-if="savedArticles.items.length === 0"
                                    description="还没有加入稍后阅读的文章"
                                />
                                <ul v-else class="archive-library-list">
                                    <li
                                        v-for="item in savedArticles.items"
                                        :key="item.articleId"
                                        class="archive-library-item"
                                    >
                                        <div class="archive-library-item-copy">
                                            <template v-if="item.available && item.article">
                                                <router-link
                                                    :to="`/article/${encodeURIComponent(item.articleId)}`"
                                                    class="archive-library-title-link"
                                                >
                                                    {{ item.article.title }}
                                                </router-link>
                                                <p
                                                    v-if="item.article.summary"
                                                    class="archive-library-summary"
                                                >
                                                    {{ item.article.summary }}
                                                </p>
                                                <p class="archive-library-meta">
                                                    本站首次收录：{{
                                                        formatDate(item.article.createdAt)
                                                    }}
                                                    <template v-if="item.article.publishedAt">
                                                        · 原文发布：{{
                                                            formatDate(item.article.publishedAt)
                                                        }}
                                                    </template>
                                                </p>
                                            </template>
                                            <span v-else class="archive-library-unavailable"
                                                >文章不可用</span
                                            >
                                            <p class="archive-library-meta">
                                                加入稍后阅读：{{ formatDate(item.savedAt) }}
                                            </p>
                                        </div>
                                        <n-button
                                            secondary
                                            :loading="savedBusy === item.articleId"
                                            :disabled="savedBusy !== null"
                                            @click="removeSavedArticle(item.articleId)"
                                        >
                                            移除
                                        </n-button>
                                    </li>
                                </ul>
                                <div
                                    v-if="savedArticles.total > pageSize"
                                    class="archive-library-pagination"
                                >
                                    <n-pagination
                                        v-model:page="savedPage"
                                        :page-size="pageSize"
                                        :item-count="savedArticles.total"
                                        simple
                                        :disabled="savedBusy !== null"
                                    />
                                </div>
                            </template>
                        </div>
                    </Card>
                </n-tab-pane>
            </n-tabs>
        </template>
    </div>
</template>

<style scoped>
.archive-library-view {
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
    min-width: 0;
    max-width: 1220px;
    margin: 0 auto;
}

.archive-library-stack {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    min-width: 0;
}

.archive-library-description,
.archive-library-summary {
    margin: 0;
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}

.archive-library-actions,
.archive-library-loading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
}

.archive-library-loading {
    padding: var(--ui-space-6) 0;
    color: var(--ui-secondary-text-color);
}

.archive-digest-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--ui-control-gap);
}

.archive-digest-copy,
.archive-library-item-copy {
    min-width: 0;
    flex: 1;
}

.archive-follow-form {
    display: flex;
    flex-direction: column;
    gap: var(--ui-inline-gap);
    min-width: 0;
}

.archive-follow-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
}

.archive-follow-input {
    flex: 1;
    min-width: 0;
    max-width: 100%;
}

.archive-library-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.archive-library-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--ui-control-gap);
    padding: var(--ui-space-4) 0;
    border-bottom: 1px solid var(--ui-border-color);
}

.archive-library-item:first-child {
    padding-top: 0;
}

.archive-library-item:last-child {
    border-bottom: 0;
    padding-bottom: 0;
}

.archive-library-title-link,
.archive-library-unavailable {
    color: var(--ui-text-color);
    font-weight: 600;
    overflow-wrap: anywhere;
}

.archive-library-title-link {
    color: var(--ui-link-color);
    text-decoration: none;
}

.archive-library-title-link:hover {
    text-decoration: underline;
}

.archive-library-title-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.archive-library-summary {
    margin-top: var(--ui-space-2);
}

.archive-library-meta {
    margin: var(--ui-space-2) 0 0;
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

.archive-library-pagination {
    display: flex;
    justify-content: center;
    max-width: 100%;
}

@media (max-width: 768px) {
    .archive-digest-row,
    .archive-follow-toolbar,
    .archive-library-item {
        flex-direction: column;
        align-items: flex-start;
    }

    .archive-follow-input {
        width: 100%;
        flex: none;
    }
}
</style>
