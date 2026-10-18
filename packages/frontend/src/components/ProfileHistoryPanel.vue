<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { NAlert, NButton, NEmpty, NSelect, NSpin, NTag, useDialog, useMessage } from 'naive-ui';
import {
    clearProfileHistory,
    getProfileHistorySettings,
    getProfileVersion,
    getProfileVersions,
    setProfileRecording,
    type ProfileVersionMetadata,
    type ProfileVersionSnapshot
} from '@/api/archive.ts';
import type { UserPrize, UserProfile } from '@/types/user';
import ArchiveTextDiff from '@/components/ArchiveTextDiff.vue';
import MarkdownViewer from '@/components/MarkdownViewer.vue';
import UserPrizeBadge from '@/components/UserPrizeBadge.vue';
import { authToken, currentAuth, isAuthenticated, startCpOAuthLogin } from '@/utils/auth.ts';
import { formatDate } from '@/utils/render.ts';
import { requestErrorMessage } from '@/utils/request.ts';

type AccessIssue = 'expired' | 'forbidden';

const props = defineProps<{
    uid: number;
    currentProfile: UserProfile | null;
    currentLoading?: boolean;
    currentError?: string | null;
    refreshKey?: number;
}>();
const emit = defineEmits<{ cleared: [] }>();
const route = useRoute();
const router = useRouter();
const dialog = useDialog();
const message = useMessage();
const versions = ref<ProfileVersionMetadata[]>([]);
const latestVersion = ref<number | null>(null);
const versionsLoading = ref(false);
const versionsError = ref<string | null>(null);
const snapshot = ref<ProfileVersionSnapshot | null>(null);
const snapshotLoading = ref(false);
const snapshotError = ref<string | null>(null);
const recordingEnabled = ref<boolean | null>(null);
const settingsLoading = ref(false);
const settingsError = ref<string | null>(null);
const settingsAccess = ref<AccessIssue | null>(null);
const operationBusy = ref(false);
const compareFrom = ref<number | null>(null);
const compareTo = ref<number | null>(null);
const comparison = ref<{ from: ProfileVersionSnapshot; to: ProfileVersionSnapshot } | null>(null);
const comparisonLoading = ref(false);
const comparisonError = ref<string | null>(null);
let versionsRequestId = 0;
let snapshotRequestId = 0;
let settingsRequestId = 0;
let operationRequestId = 0;
let comparisonRequestId = 0;
let clearDialog: ReturnType<typeof dialog.warning> | null = null;

const owner = computed(
    () => isAuthenticated.value && currentAuth.value?.registeredUser?.luoguUid === props.uid
);
const requestedVersion = computed(() => {
    const raw = route.query.version;
    if (raw === undefined) return null;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return NaN;
    const value = Number(raw);
    return Number.isInteger(value) && value <= 4294967295 ? value : NaN;
});
const historical = computed(() => requestedVersion.value !== null);
const versionOptions = computed(() => {
    const options = versions.value.map(item => ({
        value: item.version,
        label: `v${item.version} · ${formatDate(item.observedAt)} · ${item.name}`
    }));
    const value = requestedVersion.value;
    if (
        value !== null &&
        Number.isFinite(value) &&
        !versions.value.some(item => item.version === value)
    ) {
        options.push({
            value,
            label: `v${value}（${versionsLoading.value ? '正在读取索引' : versionsError.value ? '索引暂不可用' : '未找到保留的快照'}）`
        });
    }
    return [{ value: 0, label: '当前资料' }, ...options];
});
const comparisonOptions = computed(() =>
    versions.value.map(item => ({
        value: item.version,
        label: `v${item.version} · ${formatDate(item.observedAt)} · ${item.name}`
    }))
);
const displayedProfile = computed(() =>
    historical.value ? (snapshot.value?.profile ?? null) : props.currentProfile
);
const orderedPrizes = computed(() => [...(displayedProfile.value?.prizes ?? [])].reverse());
const canCompare = computed(
    () =>
        compareFrom.value !== null &&
        compareTo.value !== null &&
        compareFrom.value !== compareTo.value
);
const currentLocation = computed(() => ({
    path: route.path,
    query: { ...route.query, version: undefined },
    hash: route.hash
}));
const comparisonFields = computed(() => {
    if (!comparison.value) return [];
    const before = comparison.value.from.profile;
    const after = comparison.value.to.profile;
    return [
        { label: '用户名', before: before.name, after: after.name },
        { label: '用户名颜色', before: before.color, after: after.color },
        { label: 'OI 等级', before: String(before.ccfLevel), after: String(after.ccfLevel) },
        {
            label: 'ICPC/CCPC 等级',
            before: String(before.xcpcLevel),
            after: String(after.xcpcLevel)
        },
        { label: '签名', before: before.slogan ?? '', after: after.slogan ?? '' }
    ].map(field => ({ ...field, unchanged: field.before === field.after }));
});
const prizesUnchanged = computed(() => {
    if (!comparison.value) return true;
    return (
        JSON.stringify(comparison.value.from.profile.prizes.map(prizeSignature)) ===
        JSON.stringify(comparison.value.to.profile.prizes.map(prizeSignature))
    );
});
const comparedPrizes = computed(() => {
    if (!comparison.value) return { before: [], after: [] };
    const before = comparison.value.from.profile.prizes;
    const after = comparison.value.to.profile.prizes;
    return {
        before: comparePrizeEntries(before, after),
        after: comparePrizeEntries(after, before)
    };
});

function prizeSignature(prize: UserPrize): string {
    return JSON.stringify([
        prize.year,
        prize.contest,
        prize.event,
        prize.prize,
        prize.score ?? null,
        prize.rank ?? null
    ]);
}

function comparePrizeEntries(prizes: UserPrize[], reference: UserPrize[]) {
    const remaining = new Map<string, number>();
    for (const prize of reference) {
        const signature = prizeSignature(prize);
        remaining.set(signature, (remaining.get(signature) ?? 0) + 1);
    }
    return prizes.map(prize => {
        const signature = prizeSignature(prize);
        const count = remaining.get(signature) ?? 0;
        if (count > 0) remaining.set(signature, count - 1);
        return { prize, changed: count === 0 };
    });
}

function prizeText(prize: UserPrize): string {
    return (
        `[${prize.year}] ${prize.contest}${prize.event ? ` · ${prize.event}` : ''} · ${prize.prize}` +
        `${prize.score != null ? ` · 成绩 ${prize.score}` : ''}${prize.rank != null ? ` · 排名 ${prize.rank}` : ''}`
    );
}

function prizeTagType(prize: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
    if (prize.includes('金') || prize.includes('一等')) return 'warning';
    if (prize.includes('银') || prize.includes('二等')) return 'default';
    if (prize.includes('铜') || prize.includes('三等')) return 'error';
    return 'info';
}

function selectVersion(version: number) {
    void router.push({
        path: route.path,
        query: { ...route.query, version: version === 0 ? undefined : String(version) },
        hash: route.hash
    });
}

function discardComparison() {
    comparisonRequestId++;
    comparison.value = null;
    comparisonError.value = null;
    comparisonLoading.value = false;
}

/** Records a settings/recording/clear failure, separating expired login (401) from denial (403). */
function setSettingsFailure(code: number | undefined, fallback: string) {
    settingsAccess.value = code === 401 ? 'expired' : code === 403 ? 'forbidden' : null;
    settingsError.value =
        settingsAccess.value === 'expired'
            ? '登录已失效，请使用 CP OAuth 重新登录后管理资料历史。'
            : settingsAccess.value === 'forbidden'
              ? '当前账号无权管理此洛谷 UID 的资料历史，可能未绑定此 UID 或已被封禁。'
              : fallback;
}

function httpStatus(error: unknown): number | undefined {
    return isAxiosError(error) ? error.response?.status : undefined;
}

async function loadVersions() {
    const id = ++versionsRequestId;
    const targetUid = props.uid;
    versionsLoading.value = true;
    versionsError.value = null;
    try {
        const response = await getProfileVersions(targetUid);
        if (id !== versionsRequestId) return;
        if (response.code !== 200) {
            versionsError.value = '资料快照索引加载失败，请重试。';
            return;
        }
        versions.value = response.data.versions;
        latestVersion.value = response.data.latestVersion;
        if (!versions.value.some(item => item.version === compareFrom.value))
            compareFrom.value = versions.value[1]?.version ?? null;
        if (!versions.value.some(item => item.version === compareTo.value))
            compareTo.value = versions.value[0]?.version ?? null;
    } catch (error) {
        if (id === versionsRequestId)
            versionsError.value = requestErrorMessage(error, '资料快照索引加载失败，请重试。');
    } finally {
        if (id === versionsRequestId) versionsLoading.value = false;
    }
}

async function loadSnapshot() {
    const id = ++snapshotRequestId;
    const targetUid = props.uid;
    const version = requestedVersion.value;
    snapshot.value = null;
    snapshotError.value = null;
    snapshotLoading.value = false;
    if (version === null) return;
    if (!Number.isFinite(version)) {
        snapshotError.value = '资料版本号无效，请选择已有的资料快照或返回当前资料。';
        return;
    }
    snapshotLoading.value = true;
    try {
        const response = await getProfileVersion(targetUid, version);
        if (id !== snapshotRequestId) return;
        if (response.code !== 200) {
            snapshotError.value =
                response.code === 404
                    ? '该资料快照不存在或已被清空；不会替换为当前资料。'
                    : '资料快照加载失败，请重试。';
            return;
        }
        snapshot.value = response.data;
    } catch (error) {
        if (id !== snapshotRequestId) return;
        snapshotError.value =
            isAxiosError(error) && error.response?.status === 404
                ? '该资料快照不存在或已被清空；不会替换为当前资料。'
                : requestErrorMessage(error, '资料快照加载失败，请重试。');
    } finally {
        if (id === snapshotRequestId) snapshotLoading.value = false;
    }
}

async function loadSettings() {
    const id = ++settingsRequestId;
    const targetUid = props.uid;
    recordingEnabled.value = null;
    settingsError.value = null;
    settingsAccess.value = null;
    settingsLoading.value = false;
    if (!owner.value) return;
    settingsLoading.value = true;
    try {
        const response = await getProfileHistorySettings(targetUid);
        if (id !== settingsRequestId) return;
        if (response.code !== 200) {
            setSettingsFailure(response.code, '无法读取资料历史设置，请重试。');
            return;
        }
        recordingEnabled.value = response.data.recordingEnabled;
    } catch (error) {
        if (id === settingsRequestId)
            setSettingsFailure(
                httpStatus(error),
                requestErrorMessage(error, '无法读取资料历史设置，请重试。')
            );
    } finally {
        if (id === settingsRequestId) settingsLoading.value = false;
    }
}

async function toggleRecording() {
    if (!owner.value || operationBusy.value || recordingEnabled.value === null) return;
    const id = ++operationRequestId;
    const targetUid = props.uid;
    operationBusy.value = true;
    settingsError.value = null;
    settingsAccess.value = null;
    try {
        const response = await setProfileRecording(targetUid, !recordingEnabled.value);
        if (id !== operationRequestId) return;
        if (response.code !== 200) {
            setSettingsFailure(response.code, '资料记录设置未能保存，请重试。');
            return;
        }
        settingsRequestId++;
        settingsLoading.value = false;
        recordingEnabled.value = response.data.recordingEnabled;
        message.success(
            response.data.recordingEnabled
                ? '已恢复资料记录，下次成功刷新完整资料时开始记录。'
                : '已暂停资料记录，已有快照仍公开保留。'
        );
    } catch (error) {
        if (id === operationRequestId)
            setSettingsFailure(
                httpStatus(error),
                requestErrorMessage(error, '资料记录设置未能保存，请重试。')
            );
    } finally {
        if (id === operationRequestId) operationBusy.value = false;
    }
}

function confirmClear() {
    if (!owner.value || operationBusy.value) return;
    const targetUid = props.uid;
    const ownerToken = authToken.value;
    clearDialog?.destroy();
    clearDialog = dialog.warning({
        title: '清空公开资料历史？',
        content:
            '这会永久删除全部已保留的资料快照，并停止后续记录。当前公开资料、文章归档和陶片记录不会被删除。重新恢复记录后，只能从下一次完整资料刷新开始保留。',
        positiveText: '清空并停止记录',
        negativeText: '取消',
        onPositiveClick: async () => {
            if (
                !owner.value ||
                targetUid !== props.uid ||
                ownerToken !== authToken.value ||
                operationBusy.value
            )
                return false;
            const id = ++operationRequestId;
            operationBusy.value = true;
            settingsError.value = null;
            settingsAccess.value = null;
            try {
                const response = await clearProfileHistory(targetUid);
                if (id !== operationRequestId) return false;
                if (response.code !== 200) {
                    setSettingsFailure(response.code, '资料历史未能清空，请重试。');
                    // Retrying inside the dialog cannot fix an access problem; close it so the
                    // re-login action (or the denial notice) behind it is reachable.
                    return settingsAccess.value !== null;
                }
                versionsRequestId++;
                snapshotRequestId++;
                settingsRequestId++;
                versions.value = [];
                latestVersion.value = null;
                versionsLoading.value = false;
                snapshot.value = null;
                snapshotLoading.value = false;
                snapshotError.value = historical.value
                    ? '该资料快照已被清空；不会替换为当前资料。'
                    : null;
                recordingEnabled.value = response.data.recordingEnabled;
                settingsLoading.value = false;
                compareFrom.value = null;
                compareTo.value = null;
                discardComparison();
                emit('cleared');
                message.success(`已清空 ${response.data.deleted} 份资料快照，并停止记录。`);
                return true;
            } catch (error) {
                if (id !== operationRequestId) return false;
                setSettingsFailure(
                    httpStatus(error),
                    requestErrorMessage(error, '资料历史未能清空，请重试。')
                );
                return settingsAccess.value !== null;
            } finally {
                if (id === operationRequestId) operationBusy.value = false;
            }
        }
    });
}

async function compareSnapshots() {
    if (!canCompare.value || comparisonLoading.value) return;
    const id = ++comparisonRequestId;
    const targetUid = props.uid;
    const from = compareFrom.value!;
    const to = compareTo.value!;
    comparison.value = null;
    comparisonError.value = null;
    comparisonLoading.value = true;
    try {
        const [before, after] = await Promise.all([
            getProfileVersion(targetUid, from),
            getProfileVersion(targetUid, to)
        ]);
        if (id !== comparisonRequestId) return;
        if (before.code !== 200 || after.code !== 200) {
            comparisonError.value =
                before.code === 404 || after.code === 404
                    ? '所选资料快照不存在或已被清空，无法对比；不会使用当前资料。'
                    : '资料快照对比加载失败，请重试。';
            return;
        }
        comparison.value = { from: before.data, to: after.data };
    } catch (error) {
        if (id !== comparisonRequestId) return;
        comparisonError.value =
            isAxiosError(error) && error.response?.status === 404
                ? '所选资料快照不存在或已被清空，无法对比；不会使用当前资料。'
                : requestErrorMessage(error, '资料快照对比加载失败，请重试。');
    } finally {
        if (id === comparisonRequestId) comparisonLoading.value = false;
    }
}

function handleComparisonToggle(event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open) discardComparison();
}

watch(
    () => [props.uid, props.refreshKey],
    () => {
        versionsRequestId++;
        versions.value = [];
        latestVersion.value = null;
        versionsError.value = null;
        compareFrom.value = null;
        compareTo.value = null;
        discardComparison();
        void loadVersions();
    },
    { immediate: true, flush: 'sync' }
);
watch(
    () => [props.uid, props.refreshKey, route.query.version],
    () => {
        discardComparison();
        void loadSnapshot();
    },
    { immediate: true, flush: 'sync' }
);
watch(
    () => [props.uid, authToken.value, currentAuth.value?.registeredUser?.id, owner.value],
    () => {
        operationRequestId++;
        operationBusy.value = false;
        clearDialog?.destroy();
        clearDialog = null;
        void loadSettings();
    },
    { immediate: true, flush: 'sync' }
);
watch([compareFrom, compareTo], discardComparison, { flush: 'sync' });
onUnmounted(() => {
    versionsRequestId++;
    snapshotRequestId++;
    settingsRequestId++;
    operationRequestId++;
    comparisonRequestId++;
    clearDialog?.destroy();
});
</script>

<template>
    <div class="archive-profile-history">
        <p class="archive-description">
            资料快照默认公开记录，仅从本站开始记录后的完整资料刷新保留；本站记录时间不是原站编辑时间，也不能还原更早的资料。
        </p>
        <n-alert v-if="versionsError" type="error">
            {{ versionsError }}
            <div class="archive-state-actions">
                <n-button :loading="versionsLoading" @click="loadVersions">重试快照索引</n-button>
            </div>
        </n-alert>
        <div class="archive-version-toolbar">
            <label class="archive-version-select">
                <span>查看资料版本</span>
                <n-select
                    :value="
                        requestedVersion === null
                            ? 0
                            : Number.isFinite(requestedVersion)
                              ? requestedVersion
                              : null
                    "
                    :options="versionOptions"
                    :loading="versionsLoading"
                    filterable
                    placeholder="请选择有效的资料版本"
                    aria-label="选择当前资料或历史资料快照"
                    :input-props="{ 'aria-label': '选择当前资料或历史资料快照' }"
                    @update:value="selectVersion"
                />
            </label>
            <RouterLink v-if="historical" class="archive-current-link" :to="currentLocation"
                >返回当前资料</RouterLink
            >
        </div>
        <p v-if="versionsLoading" class="archive-description" role="status">
            正在读取公开资料快照索引…
        </p>
        <p v-else-if="!versionsError" class="archive-description">
            <template v-if="versions.length"
                >保留 {{ versions.length }} 份公开资料快照，最新保留版本 v{{
                    latestVersion
                }}。</template
            >
            <template v-else>暂无保留的资料快照；只从开始记录后保留，不会补造更早的资料。</template>
        </p>
        <details v-if="versions.length" class="archive-version-index">
            <summary>查看全部资料快照记录</summary>
            <ul>
                <li v-for="item in versions" :key="item.version">
                    <RouterLink
                        :to="{
                            path: route.path,
                            query: { ...route.query, version: String(item.version) }
                        }"
                        >v{{ item.version }} · {{ item.name }}</RouterLink
                    >
                    <span
                        >本站记录：<time :datetime="item.observedAt">{{
                            formatDate(item.observedAt)
                        }}</time></span
                    >
                </li>
            </ul>
        </details>

        <section v-if="owner" class="archive-owner-controls" aria-label="本人的资料历史管理">
            <h2>资料历史管理</h2>
            <p class="archive-description">
                仅绑定此洛谷 UID
                的登录账号可管理记录。暂停保留已有公开快照；清空会同时停止记录，不影响当前资料。
            </p>
            <n-alert v-if="settingsError" type="error">
                {{ settingsError }}
                <div v-if="settingsAccess !== 'forbidden'" class="archive-state-actions">
                    <n-button
                        v-if="settingsAccess === 'expired'"
                        type="primary"
                        @click="startCpOAuthLogin(route.fullPath)"
                        >使用 CP OAuth 重新登录</n-button
                    >
                    <n-button
                        v-else
                        :disabled="operationBusy"
                        :loading="settingsLoading"
                        @click="loadSettings"
                        >重新读取设置</n-button
                    >
                </div>
            </n-alert>
            <div class="archive-owner-actions">
                <span v-if="settingsLoading" role="status">正在读取记录设置…</span>
                <span v-else-if="recordingEnabled !== null">{{
                    recordingEnabled ? '正在记录公开资料快照' : '已暂停记录公开资料快照'
                }}</span>
                <n-button
                    type="primary"
                    secondary
                    :loading="operationBusy"
                    :disabled="
                        settingsLoading ||
                        recordingEnabled === null ||
                        operationBusy ||
                        settingsAccess !== null
                    "
                    @click="toggleRecording"
                    >{{ recordingEnabled === false ? '恢复记录' : '暂停记录' }}</n-button
                >
                <n-button
                    type="error"
                    secondary
                    :disabled="operationBusy || settingsLoading || settingsAccess !== null"
                    @click="confirmClear"
                    >清空资料历史</n-button
                >
            </div>
        </section>

        <n-alert v-if="snapshotError" type="error">
            {{ snapshotError }}
            <div
                v-if="requestedVersion !== null && Number.isFinite(requestedVersion)"
                class="archive-state-actions"
            >
                <n-button :loading="snapshotLoading" @click="loadSnapshot">重试此资料快照</n-button>
            </div>
        </n-alert>
        <n-spin :show="snapshotLoading" aria-label="正在加载资料快照">
            <p v-if="snapshotLoading" class="archive-description" role="status">
                正在读取所选资料快照…
            </p>
            <section v-if="displayedProfile" class="archive-profile-detail">
                <h2>{{ historical ? `历史资料快照 v${snapshot?.version}` : '当前资料' }}</h2>
                <n-alert v-if="historical && snapshot" type="info" class="archive-snapshot-notice">
                    本站记录：<time :datetime="snapshot.observedAt">{{
                        formatDate(snapshot.observedAt)
                    }}</time
                    >。这是当时记录的资料；页面头像仍使用上游当前头像，不是历史头像。
                </n-alert>
                <div v-if="historical" class="archive-snapshot-identity">
                    <div class="archive-profile-name">
                        <span :class="`user-${displayedProfile.color}`">{{
                            displayedProfile.name
                        }}</span>
                        <UserPrizeBadge
                            v-if="displayedProfile.ccfLevel > 0 || displayedProfile.xcpcLevel > 0"
                            :ccf-level="displayedProfile.ccfLevel"
                            :xcpc-level="displayedProfile.xcpcLevel"
                            :size="16"
                        />
                    </div>
                    <p>
                        洛谷 UID {{ displayedProfile.id }} · OI 等级
                        {{ displayedProfile.ccfLevel }} · ICPC/CCPC 等级
                        {{ displayedProfile.xcpcLevel }}
                    </p>
                    <p>{{ displayedProfile.slogan || '未填写签名' }}</p>
                </div>
                <div class="archive-profile-sections">
                    <section class="archive-introduction">
                        <h3>个人介绍</h3>
                        <MarkdownViewer
                            v-if="displayedProfile.introduction"
                            :key="`${uid}-${snapshot?.version ?? 'current'}`"
                            :content="displayedProfile.introduction"
                            :heading-offset="3"
                        />
                        <n-empty v-else description="该份资料未填写个人介绍" />
                    </section>
                    <section class="archive-prizes">
                        <h3>获奖信息</h3>
                        <n-empty
                            v-if="!orderedPrizes.length"
                            :description="
                                !historical && currentProfile && !currentProfile.profileFetchedAt
                                    ? '完整资料尚未拉取，暂无获奖数据'
                                    : '该份资料暂无可见获奖记录'
                            "
                        />
                        <ul v-else class="archive-prize-list">
                            <li v-for="(prize, index) in orderedPrizes" :key="index">
                                <div class="archive-prize-text">
                                    <span
                                        >[{{ prize.year }}] {{ prize.contest
                                        }}<template v-if="prize.event">
                                            · {{ prize.event }}</template
                                        ></span
                                    >
                                    <span
                                        v-if="prize.score != null || prize.rank != null"
                                        class="archive-description"
                                    >
                                        <template v-if="prize.score != null"
                                            >成绩 {{ prize.score }}</template
                                        ><template v-if="prize.score != null && prize.rank != null">
                                            · </template
                                        ><template v-if="prize.rank != null"
                                            >排名 {{ prize.rank }}</template
                                        >
                                    </span>
                                </div>
                                <n-tag
                                    size="small"
                                    :type="prizeTagType(prize.prize)"
                                    :bordered="false"
                                    >{{ prize.prize }}</n-tag
                                >
                            </li>
                        </ul>
                    </section>
                </div>
            </section>
            <n-alert v-else-if="!historical && currentError" type="error"
                >{{ currentError }} 请通过页首重试当前资料。</n-alert
            >
            <p v-else-if="!historical && currentLoading" class="archive-description" role="status">
                正在读取当前资料…
            </p>
            <n-empty
                v-else-if="!historical"
                description="当前完整资料尚未收录，可使用页面上的手动刷新操作"
            />
        </n-spin>

        <details class="archive-comparison" @toggle="handleComparisonToggle">
            <summary>对比任意两份已保留的资料快照</summary>
            <p class="archive-description">
                比较用户名、颜色、等级、签名、获奖列表和个人介绍的 Markdown
                源文；记录时间不代表上游修改时间。
            </p>
            <n-empty
                v-if="!versionsLoading && !versionsError && versions.length < 2"
                description="至少需要两份保留的资料快照才能对比"
            />
            <div class="archive-compare-toolbar">
                <label class="archive-version-select">
                    <span>对比前版本</span>
                    <n-select
                        v-model:value="compareFrom"
                        :options="comparisonOptions"
                        filterable
                        :loading="versionsLoading"
                        :input-props="{ 'aria-label': '选择资料对比前版本' }"
                        placeholder="选择一份已有快照"
                    />
                </label>
                <label class="archive-version-select">
                    <span>对比后版本</span>
                    <n-select
                        v-model:value="compareTo"
                        :options="comparisonOptions"
                        filterable
                        :loading="versionsLoading"
                        :input-props="{ 'aria-label': '选择资料对比后版本' }"
                        placeholder="选择另一份已有快照"
                    />
                </label>
                <n-button
                    type="primary"
                    :disabled="!canCompare || versionsLoading || comparisonLoading"
                    :loading="comparisonLoading"
                    @click="compareSnapshots"
                    >查看差异</n-button
                >
            </div>
            <p v-if="compareFrom !== null && compareFrom === compareTo" class="archive-description">
                请选择两个不同的已有资料版本。
            </p>
            <n-alert v-if="comparisonError" type="error">{{ comparisonError }}</n-alert>
            <p v-if="comparisonLoading" role="status" class="archive-description">
                正在读取两份资料快照…
            </p>
            <div v-if="comparison" class="archive-comparison-result">
                <p class="archive-description">
                    对比前 v{{ comparison.from.version }}：{{
                        formatDate(comparison.from.observedAt)
                    }}；对比后 v{{ comparison.to.version }}：{{
                        formatDate(comparison.to.observedAt)
                    }}。以上均为本站记录时间。
                </p>
                <div class="archive-field-comparison">
                    <section
                        v-for="field in comparisonFields"
                        :key="field.label"
                        class="archive-field-diff"
                        :class="{ 'archive-field-changed': !field.unchanged }"
                    >
                        <h3>{{ field.label }} · {{ field.unchanged ? '未变化' : '有变化' }}</h3>
                        <p v-if="field.unchanged">{{ field.before || '未填写' }}</p>
                        <template v-else>
                            <p><strong>− 对比前：</strong>{{ field.before || '未填写' }}</p>
                            <p><strong>+ 对比后：</strong>{{ field.after || '未填写' }}</p>
                        </template>
                    </section>
                </div>
                <section class="archive-prize-comparison">
                    <h3>获奖列表 · {{ prizesUnchanged ? '未变化' : '内容或顺序有变化' }}</h3>
                    <p
                        v-if="prizesUnchanged && !comparison.from.profile.prizes.length"
                        class="archive-description"
                    >
                        两份资料均无获奖记录。
                    </p>
                    <div v-else class="archive-prize-columns">
                        <section>
                            <h4>对比前 v{{ comparison.from.version }}</h4>
                            <p
                                v-if="!comparison.from.profile.prizes.length"
                                class="archive-description"
                            >
                                无获奖记录
                            </p>
                            <ul class="archive-prize-source-list">
                                <li
                                    v-for="(entry, index) in comparedPrizes.before"
                                    :key="index"
                                    :class="{ 'archive-prize-removed': entry.changed }"
                                >
                                    <strong>{{ entry.changed ? '− 已移除：' : '保留：' }}</strong
                                    >{{ prizeText(entry.prize) }}
                                </li>
                            </ul>
                        </section>
                        <section>
                            <h4>对比后 v{{ comparison.to.version }}</h4>
                            <p
                                v-if="!comparison.to.profile.prizes.length"
                                class="archive-description"
                            >
                                无获奖记录
                            </p>
                            <ul class="archive-prize-source-list">
                                <li
                                    v-for="(entry, index) in comparedPrizes.after"
                                    :key="index"
                                    :class="{ 'archive-prize-added': entry.changed }"
                                >
                                    <strong>{{ entry.changed ? '+ 新增：' : '保留：' }}</strong
                                    >{{ prizeText(entry.prize) }}
                                </li>
                            </ul>
                        </section>
                    </div>
                </section>
                <section class="archive-biography-diff">
                    <h3>个人介绍源文差异</h3>
                    <ArchiveTextDiff
                        :key="`${uid}-${comparison.from.version}-${comparison.to.version}`"
                        :before="comparison.from.profile.introduction ?? ''"
                        :after="comparison.to.profile.introduction ?? ''"
                        :before-label="`资料快照 v${comparison.from.version}`"
                        :after-label="`资料快照 v${comparison.to.version}`"
                    />
                </section>
            </div>
        </details>
    </div>
</template>

<style scoped>
.archive-profile-history {
    min-width: 0;
}
.archive-description {
    margin: 0 0 var(--ui-space-4);
    color: var(--ui-secondary-text-color);
    overflow-wrap: anywhere;
}
.archive-version-toolbar,
.archive-compare-toolbar,
.archive-owner-actions {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: var(--ui-control-gap);
    margin: var(--ui-space-4) 0;
    min-width: 0;
}
.archive-version-select {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: var(--ui-space-2);
    min-width: 0;
    max-width: 100%;
}
.archive-current-link {
    align-self: center;
    color: var(--ui-link-color);
}
.archive-state-actions {
    margin-top: var(--ui-space-3);
}
.archive-owner-controls {
    margin: var(--ui-space-5) 0;
    padding: var(--ui-space-4);
    background: var(--ui-panel-color);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
}
.archive-profile-history h2 {
    margin: 0 0 var(--ui-space-3);
    font-size: 18px;
    font-weight: 600;
}
.archive-profile-history h3 {
    margin: 0 0 var(--ui-space-3);
    font-size: 16px;
    font-weight: 600;
}
.archive-profile-history h4 {
    margin: 0 0 var(--ui-space-2);
    font-size: 14px;
}
.archive-owner-actions {
    align-items: center;
    margin-bottom: 0;
}
.archive-owner-actions span {
    flex: 1 1 240px;
}
.archive-version-index {
    margin: var(--ui-space-4) 0;
}
.archive-version-index ul {
    padding: 0;
    margin: var(--ui-space-3) 0;
    list-style: none;
}
.archive-version-index li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap) var(--ui-space-4);
    padding: var(--ui-space-2) 0;
    border-bottom: 1px solid var(--ui-border-color);
    overflow-wrap: anywhere;
}
.archive-version-index li span {
    color: var(--ui-muted-text-color);
    font-variant-numeric: tabular-nums;
}
.archive-version-index a {
    color: var(--ui-link-color);
}
.archive-profile-detail {
    margin-top: var(--ui-space-5);
}
.archive-snapshot-notice {
    margin-bottom: var(--ui-space-4);
}
.archive-profile-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    font-size: 18px;
    font-weight: 600;
}
.archive-snapshot-identity {
    overflow-wrap: anywhere;
}
.archive-snapshot-identity p {
    margin: var(--ui-space-2) 0;
}
.archive-profile-sections {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    align-items: start;
    gap: var(--ui-space-5);
    margin-top: var(--ui-space-4);
}
.archive-introduction,
.archive-prizes {
    min-width: 0;
    overflow-wrap: anywhere;
}
.archive-introduction :deep(img),
.archive-introduction :deep(video),
.archive-introduction :deep(iframe) {
    max-width: 100%;
}
.archive-introduction :deep(pre),
.archive-introduction :deep(.table-container) {
    max-width: 100%;
    overflow-x: auto;
}
.archive-prize-list {
    list-style: none;
    padding: 0;
    margin: 0;
}
.archive-prize-list li {
    display: flex;
    align-items: start;
    flex-wrap: wrap;
    gap: var(--ui-inline-gap);
    padding: var(--ui-space-3) 0;
    border-bottom: 1px solid var(--ui-border-color);
}
.archive-prize-text {
    display: flex;
    flex: 1 1 160px;
    flex-direction: column;
    gap: var(--ui-space-1);
    min-width: 0;
}
.archive-prize-text .archive-description {
    margin-bottom: 0;
}
.archive-comparison {
    margin-top: var(--ui-space-5);
    padding-top: var(--ui-space-4);
    border-top: 1px solid var(--ui-border-color);
}
.archive-comparison > summary {
    margin-bottom: var(--ui-space-4);
}
summary {
    cursor: pointer;
    color: var(--ui-text-color);
    font-weight: 600;
    overflow-wrap: anywhere;
}
.archive-field-comparison {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
}
.archive-field-diff {
    padding: var(--ui-space-3);
    background: var(--ui-panel-color);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    min-width: 0;
    overflow-wrap: anywhere;
}
.archive-field-diff p {
    margin: var(--ui-space-2) 0 0;
    white-space: pre-wrap;
}
.archive-field-changed {
    border-left: 3px solid var(--ui-primary-color);
}
.archive-prize-comparison,
.archive-biography-diff {
    margin-top: var(--ui-space-5);
    min-width: 0;
}
.archive-prize-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-4);
}
.archive-prize-columns section {
    min-width: 0;
}
.archive-prize-source-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.archive-prize-source-list li {
    padding: var(--ui-space-2);
    margin-bottom: var(--ui-space-2);
    border-bottom: 1px solid var(--ui-border-color);
    overflow-wrap: anywhere;
}
.archive-prize-removed {
    background: var(--ui-alert-error-background-color);
}
.archive-prize-added {
    background: var(--ui-alert-success-background-color);
}
a:focus-visible,
summary:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 3px;
}
@media (max-width: 768px) {
    .archive-profile-sections,
    .archive-field-comparison,
    .archive-prize-columns {
        grid-template-columns: minmax(0, 1fr);
    }
    .archive-version-toolbar,
    .archive-compare-toolbar {
        flex-direction: column;
        align-items: stretch;
    }
    .archive-version-select {
        flex: none;
        width: 100%;
    }
    .archive-current-link {
        align-self: start;
    }
}
</style>
