<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref } from 'vue';
import {
    NButton,
    NCollapse,
    NCollapseItem,
    NColorPicker,
    NDrawer,
    NDrawerContent,
    NForm,
    NFormItem,
    NInput,
    NInputNumber,
    NSelect,
    NSpace,
    NSpin,
    useDialog,
    useMessage
} from 'naive-ui';
import { useCodeFont } from '@/composables/useCodeFont.ts';
import { useReadingFont } from '@/composables/useReadingFont.ts';
import {
    uiThemeKey,
    uiThemeModeKey,
    uiThemePresetKey,
    type UiThemeVars
} from '@/styles/theme/themeKeys.ts';
import {
    resolvePresetThemeVars,
    THEME_MODE_OPTIONS,
    THEME_PRESET_OPTIONS
} from '@/styles/theme/presets.ts';

const uiTheme = inject(uiThemeKey);
const mode = inject(uiThemeModeKey);
const preset = inject(uiThemePresetKey);
const message = useMessage();
const dialog = useDialog();

if (!uiTheme || !mode || !preset) {
    throw new Error('ThemeEditor 必须在 provider 内部使用');
}

type ColorThemeKey = Exclude<
    keyof UiThemeVars,
    | 'codeTheme'
    | 'cardShadow'
    | 'elevatedShadow'
    | 'focusRingShadow'
    | 'cardRadius'
    | 'pillRadius'
    | 'userRedColor'
    | 'userOrangeColor'
    | 'userPurpleColor'
    | 'userGreenColor'
    | 'userBlueColor'
    | 'userGrayColor'
    | 'userCheaterColor'
    | 'prizeGreenColor'
    | 'prizeBlueColor'
    | 'prizeGoldColor'
>;

interface ColorEditorItem {
    key: ColorThemeKey;
    label: string;
}

interface ColorEditorGroup {
    name: string;
    title: string;
    items: readonly ColorEditorItem[];
}

const showDrawer = defineModel<boolean>('show', { default: false });
const drawerReady = ref(false);
// NDrawer skips its enter transition when mounted with show=true (appear is tied to isMountedRef).
// Gate the first reveal until after NDrawer mounts so lazy first-open slides in normally.
const drawerShow = computed({
    get: () => drawerReady.value && showDrawer.value,
    set: value => {
        showDrawer.value = value;
    }
});

onMounted(() => {
    void nextTick(() => {
        drawerReady.value = true;
    });
});

const radiusNumber = computed({
    get: () => Number.parseInt(uiTheme.value.cardRadius, 10) || 0,
    set: value => {
        uiTheme.value.cardRadius = `${value ?? 0}px`;
    }
});

const pillRadiusNumber = computed({
    get: () => Number.parseInt(uiTheme.value.pillRadius, 10) || 0,
    set: value => {
        uiTheme.value.pillRadius = `${value ?? 0}px`;
    }
});

const codeThemeOptions = [
    { label: '浅色代码主题', value: 'light' },
    { label: '深色代码主题', value: 'dark' }
];

const presetOptions = [...THEME_PRESET_OPTIONS];
const modeOptions = [...THEME_MODE_OPTIONS];

const { readingFont, readingFontSelectOptions, currentReadingFontOption, readingFontLoading } =
    useReadingFont();
const { codeFont, customCodeFont, codeFontOptions } = useCodeFont();

const mainColorItems = [
    { key: 'bodyColor', label: '页面背景色' },
    { key: 'bodyGradientStart', label: '页面渐变起始色' },
    { key: 'bodyGradientEnd', label: '页面渐变结束色' },
    { key: 'primaryColor', label: '主色' },
    { key: 'cardColor', label: '卡片背景色' }
] as const satisfies readonly ColorEditorItem[];

const advancedColorGroups = [
    {
        name: 'layout',
        title: '页面与布局',
        items: [
            { key: 'translucentCardColor', label: '半透明卡片背景色' },
            { key: 'borderColor', label: '边框颜色' },
            { key: 'panelColor', label: '面板背景色' },
            { key: 'footerTextColor', label: '页脚文本色' },
            { key: 'iconColor', label: '图标颜色' }
        ]
    },
    {
        name: 'text',
        title: '文字与链接',
        items: [
            { key: 'cardTitleColor', label: '卡片标题颜色' },
            { key: 'textColor', label: '正文颜色' },
            { key: 'secondaryTextColor', label: '次要文字颜色' },
            { key: 'mutedTextColor', label: '弱化文字颜色' },
            { key: 'linkColor', label: '链接颜色' },
            { key: 'linkHoverColor', label: '链接悬停颜色' }
        ]
    },
    {
        name: 'control',
        title: '控件',
        items: [
            { key: 'controlColor', label: '控件背景色' },
            { key: 'controlColorFocus', label: '控件聚焦背景色' },
            { key: 'controlColorDisabled', label: '控件禁用背景色' },
            { key: 'controlTextColor', label: '控件文字颜色' },
            { key: 'controlPlaceholderColor', label: '控件占位文字颜色' },
            { key: 'controlBorderColor', label: '控件边框颜色' },
            { key: 'controlBorderHoverColor', label: '控件悬停边框颜色' },
            { key: 'controlBorderFocusColor', label: '控件聚焦边框颜色' },
            { key: 'controlTagColor', label: '控件标签背景色' },
            { key: 'controlTagTextColor', label: '控件标签文字颜色' },
            { key: 'sliderRailColor', label: '滑动条轨道色' },
            { key: 'sliderRailHoverColor', label: '滑动条悬停轨道色' },
            { key: 'sliderFillColor', label: '滑动条填充色' },
            { key: 'sliderFillHoverColor', label: '滑动条悬停填充色' },
            { key: 'sliderHandleColor', label: '滑动条手柄色' },
            { key: 'backTopColor', label: '返回顶部背景色' },
            { key: 'backTopHoverColor', label: '返回顶部悬停背景色' },
            { key: 'backTopIconColor', label: '返回顶部图标色' },
            { key: 'backTopIconHoverColor', label: '返回顶部悬停图标色' }
        ]
    },
    {
        name: 'markdown',
        title: 'Markdown 与代码',
        items: [
            { key: 'codeBackgroundColor', label: '普通代码块背景色' },
            { key: 'codeTextColor', label: '普通代码块文字颜色' },
            { key: 'inlineCodeBackgroundColor', label: '行内代码背景色' },
            { key: 'inlineCodeTextColor', label: '行内代码文字颜色' },
            { key: 'markBackgroundColor', label: '标记背景色' },
            { key: 'tableHeaderColor', label: '表头背景色' },
            { key: 'scrollbarTrackColor', label: '滚动条轨道色' },
            { key: 'scrollbarThumbColor', label: '滚动条滑块色' },
            { key: 'copyButtonBackgroundColor', label: '复制按钮背景色' },
            { key: 'copyButtonTextColor', label: '复制按钮文字颜色' }
        ]
    },
    {
        name: 'status',
        title: '状态与强调',
        items: [
            { key: 'infoColor', label: '信息色' },
            { key: 'successColor', label: '成功色' },
            { key: 'warningColor', label: '警告色' },
            { key: 'errorColor', label: '错误色' },
            { key: 'alertInfoBackgroundColor', label: '信息提示背景色' },
            { key: 'alertSuccessBackgroundColor', label: '成功提示背景色' },
            { key: 'alertWarningBackgroundColor', label: '警告提示背景色' },
            { key: 'alertErrorBackgroundColor', label: '错误提示背景色' },
            { key: 'orangeColor', label: '橙色强调' },
            { key: 'cyanColor', label: '青色强调' },
            { key: 'mutedAccentColor', label: '弱化强调色' },
            { key: 'primaryColorHover', label: '主色悬停色' },
            { key: 'primaryColorPressed', label: '主色按压色' },
            { key: 'primaryColorSuppl', label: '补充主色' }
        ]
    },
    {
        name: 'category',
        title: '文章分类',
        items: [
            { key: 'categoryPersonalColor', label: '个人记录颜色' },
            { key: 'categorySolutionColor', label: '题解颜色' },
            { key: 'categoryTechColor', label: '科技工程颜色' },
            { key: 'categoryAlgorithmColor', label: '算法理论颜色' },
            { key: 'categoryLifeColor', label: '生活游记颜色' },
            { key: 'categoryStudyColor', label: '学习文化课颜色' },
            { key: 'categoryFunColor', label: '休闲娱乐颜色' },
            { key: 'categoryChatColor', label: '闲话颜色' },
            { key: 'categoryUnknownColor', label: '未知分类颜色' }
        ]
    }
] as const satisfies readonly ColorEditorGroup[];

const handleResetToPreset = () => {
    dialog.warning({
        title: '重置为当前预设？',
        content: '当前预设下的全部自定义主题设置都会被预设值覆盖，且无法撤销。',
        positiveText: '重置',
        negativeText: '取消',
        onPositiveClick: () => {
            uiTheme.value = resolvePresetThemeVars(
                preset.value,
                mode.value,
                window.matchMedia('(prefers-color-scheme: dark)').matches
            );
            message.success('已重置为当前预设');
        }
    });
};
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
        <n-drawer-content title="主题编辑器" closable :style="{ '--n-color': uiTheme?.cardColor }">
            <div class="theme-selectors">
                <n-form-item label="主题预设" class="selector-item" :show-feedback="false">
                    <n-select v-model:value="preset" :options="presetOptions" />
                </n-form-item>
                <n-form-item label="配色模式" class="selector-item" :show-feedback="false">
                    <n-select v-model:value="mode" :options="modeOptions" />
                </n-form-item>
            </div>

            <n-form
                v-if="uiTheme"
                class="theme-editor-form"
                label-placement="top"
                label-width="auto"
                :model="uiTheme"
            >
                <n-collapse>
                    <n-collapse-item title="主要" name="main">
                        <n-form-item
                            v-for="item in mainColorItems"
                            :key="item.key"
                            :label="item.label"
                            :path="item.key"
                        >
                            <n-color-picker v-model:value="uiTheme[item.key]" show-alpha />
                        </n-form-item>
                        <n-form-item label="代码主题" path="codeTheme">
                            <n-select
                                v-model:value="uiTheme.codeTheme"
                                :options="codeThemeOptions"
                            />
                        </n-form-item>
                    </n-collapse-item>

                    <n-collapse-item title="字体与排版" name="typography">
                        <n-form-item label="文章阅读字体">
                            <n-select
                                v-model:value="readingFont"
                                :options="readingFontSelectOptions"
                            />
                        </n-form-item>
                        <n-form-item label="代码字体">
                            <n-select v-model:value="codeFont" :options="codeFontOptions" />
                        </n-form-item>
                        <n-form-item v-if="codeFont === 'custom'" label="自定义代码字体">
                            <n-input
                                v-model:value="customCodeFont"
                                placeholder="例如：Maple Mono, Sarasa Mono SC"
                                clearable
                            />
                        </n-form-item>
                        <div class="font-preview-card" aria-label="字体与代码预览">
                            <div class="font-preview-header">
                                <span class="font-preview-title">P1001 归档阅读预览</span>
                                <span v-if="readingFontLoading" class="font-preview-status">
                                    <n-spin size="small" />
                                    <span>正在加载字体…</span>
                                </span>
                            </div>
                            <p class="font-preview-body">
                                {{ currentReadingFontOption.description }}
                                时间复杂度 <code>O(n log n)</code>。
                            </p>
                            <pre
                                class="font-preview-code"
                            ><code>const ans = dp[n] % MOD;</code></pre>
                        </div>
                    </n-collapse-item>

                    <n-collapse-item
                        v-for="group in advancedColorGroups"
                        :key="group.name"
                        :title="group.title"
                        :name="group.name"
                    >
                        <n-form-item
                            v-for="item in group.items"
                            :key="item.key"
                            :label="item.label"
                            :path="item.key"
                        >
                            <n-color-picker v-model:value="uiTheme[item.key]" show-alpha />
                        </n-form-item>
                    </n-collapse-item>

                    <n-collapse-item title="阴影与圆角" name="shape">
                        <n-form-item label="卡片阴影" path="cardShadow">
                            <n-input v-model:value="uiTheme.cardShadow" />
                        </n-form-item>
                        <n-form-item label="浮层阴影" path="elevatedShadow">
                            <n-input v-model:value="uiTheme.elevatedShadow" />
                        </n-form-item>
                        <n-form-item label="聚焦阴影" path="focusRingShadow">
                            <n-input v-model:value="uiTheme.focusRingShadow" />
                        </n-form-item>
                        <n-form-item label="卡片圆角">
                            <n-input-number v-model:value="radiusNumber" :min="0" />
                        </n-form-item>
                        <n-form-item label="胶囊圆角">
                            <n-input-number v-model:value="pillRadiusNumber" :min="0" />
                        </n-form-item>
                    </n-collapse-item>
                </n-collapse>
            </n-form>

            <template #footer>
                <n-space justify="end">
                    <n-button @click="handleResetToPreset">重置为预设</n-button>
                </n-space>
            </template>
        </n-drawer-content>
    </n-drawer>
</template>

<style scoped>
.theme-selectors {
    display: flex;
    gap: var(--ui-space-3);
    margin-bottom: var(--ui-space-4);
}

.selector-item {
    flex: 1;
    min-width: 0;
}

.theme-editor-form :deep(.n-collapse-item__content-inner) {
    padding-top: var(--ui-space-2);
}

.font-preview-card {
    padding: var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-panel-color);
}

.font-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    margin-bottom: var(--ui-space-2);
}

.font-preview-title {
    font-family: var(--ui-font-family-reading-heading);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ui-card-title-color);
}

.font-preview-status {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-2);
    color: var(--ui-muted-text-color);
    font-size: 12px;
}

.font-preview-body {
    margin: 0 0 var(--ui-space-2);
    font-family: var(--ui-font-family-reading);
    font-size: var(--ui-reading-font-size);
    line-height: var(--ui-reading-line-height);
    color: var(--ui-text-color);
}

.font-preview-body code {
    font-family: var(--ui-font-family-mono);
    font-size: 0.9em;
    padding: 1px 5px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-inline-code-background-color);
    color: var(--ui-inline-code-text-color);
}

.font-preview-code {
    margin: 0;
    padding: var(--ui-space-2) var(--ui-space-3);
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-button-radius);
    background: var(--ui-code-background-color);
    color: var(--ui-code-text-color);
    font-family: var(--ui-font-family-mono);
    font-size: 13px;
    line-height: 1.5;
    overflow-x: auto;
}

.font-preview-code code {
    font-family: inherit;
}
</style>
