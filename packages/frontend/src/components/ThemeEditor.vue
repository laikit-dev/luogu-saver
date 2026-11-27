<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
    NButton,
    NCollapse,
    NCollapseItem,
    NColorPicker,
    NDrawer,
    NDrawerContent,
    NForm,
    NFormItem,
    NIcon,
    NInput,
    NInputNumber,
    NRadioButton,
    NRadioGroup,
    NSelect,
    NSpace,
    NSpin,
    NSwitch,
    useDialog,
    useMessage
} from 'naive-ui';
import { Check } from 'lucide-vue-next';
import { useCodeFont } from '@/composables/useCodeFont.ts';
import { useCodeTheme, type CodeThemePreset } from '@/composables/useCodeTheme.ts';
import { useReadingFont } from '@/composables/useReadingFont.ts';
import {
    uiThemeKey,
    uiThemeModeKey,
    uiThemePresetKey,
    type UiThemeVars
} from '@/styles/theme/themeKeys.ts';
import {
    resolveEffectiveColorScheme,
    resolvePresetThemeVars,
    THEME_MODE_OPTIONS,
    THEME_PRESET_LIST,
    type PresetPreviewFont,
    type UiThemePreset
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

const darkMediaQuery =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const prefersDark = ref(darkMediaQuery?.matches ?? false);
const handleSchemeChange = (event: MediaQueryListEvent) => {
    prefersDark.value = event.matches;
};

onMounted(() => {
    darkMediaQuery?.addEventListener('change', handleSchemeChange);
    void nextTick(() => {
        drawerReady.value = true;
    });
});

onUnmounted(() => {
    darkMediaQuery?.removeEventListener('change', handleSchemeChange);
});

const effectiveScheme = computed(() => resolveEffectiveColorScheme(mode.value, prefersDark.value));

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

const presetList = THEME_PRESET_LIST;
const modeOptions = [...THEME_MODE_OPTIONS];

const { readingFont, readingFontSelectOptions, currentReadingFontOption, readingFontLoading } =
    useReadingFont();
const { codeFont, customCodeFont, codeFontOptions } = useCodeFont();
const {
    codeThemePresets,
    lightShikiThemeOptions,
    darkShikiThemeOptions,
    activeCodeThemePreset,
    lightShikiTheme,
    darkShikiTheme,
    codeFontSize,
    codeLineHeight,
    codeShowLineNumbers,
    codeWordWrap,
    selectCodeThemePreset,
    resetCodeThemeSettings
} = useCodeTheme();

const getCodePreviewPalette = (item: CodeThemePreset) =>
    item.preview[uiTheme.value.codeTheme === 'dark' ? 'dark' : 'light'];

const activeCodePreview = computed(() => {
    const scheme = uiTheme.value.codeTheme === 'dark' ? 'dark' : 'light';
    const matched =
        codeThemePresets.find(
            item =>
                item.lightTheme === lightShikiTheme.value && item.darkTheme === darkShikiTheme.value
        ) ?? codeThemePresets[0]!;
    return matched.preview[scheme];
});

const getPresetVariant = (item: UiThemePreset): UiThemeVars => item[effectiveScheme.value];

const getPreviewFontFamily = (font: PresetPreviewFont): string => {
    if (font === 'serif') return 'var(--ui-font-family-serif)';
    if (font === 'kai') return 'var(--ui-font-family-kai)';
    return 'var(--ui-font-family-display)';
};

const getPreviewRadius = (cardRadius: string): string => {
    const px = Number.parseInt(cardRadius, 10) || 8;
    return `${Math.max(4, Math.min(10, Math.round(px * 0.65)))}px`;
};

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
            uiTheme.value = resolvePresetThemeVars(preset.value, mode.value, prefersDark.value);
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
            <div class="editor-sections">
                <section class="editor-section" aria-label="配色模式与主题预设">
                    <div class="mode-row">
                        <span class="section-heading">配色模式</span>
                        <n-radio-group v-model:value="mode" size="small" aria-label="配色模式">
                            <n-radio-button
                                v-for="option in modeOptions"
                                :key="option.value"
                                :value="option.value"
                            >
                                {{ option.label }}
                            </n-radio-button>
                        </n-radio-group>
                    </div>

                    <div class="section-heading">主题预设</div>
                    <div class="preset-grid" role="group" aria-label="主题预设">
                        <button
                            v-for="item in presetList"
                            :key="item.name"
                            type="button"
                            class="preset-tile"
                            :class="{ 'is-active': preset === item.name }"
                            :aria-pressed="preset === item.name"
                            :title="item.description"
                            @click="preset = item.name"
                        >
                            <div
                                class="preset-canvas"
                                :style="{
                                    backgroundColor: getPresetVariant(item).bodyColor,
                                    backgroundImage: `linear-gradient(135deg, ${getPresetVariant(item).bodyGradientStart}, ${getPresetVariant(item).bodyGradientEnd})`,
                                    borderBottomColor: getPresetVariant(item).borderColor
                                }"
                            >
                                <span
                                    v-if="preset === item.name"
                                    class="preset-check"
                                    :style="{
                                        backgroundColor: getPresetVariant(item).primaryColor
                                    }"
                                    aria-hidden="true"
                                >
                                    <n-icon :component="Check" :size="11" />
                                </span>

                                <div
                                    class="preview-card"
                                    :style="{
                                        backgroundColor: getPresetVariant(item).cardColor,
                                        borderColor: getPresetVariant(item).borderColor,
                                        borderRadius: getPreviewRadius(
                                            getPresetVariant(item).cardRadius
                                        ),
                                        boxShadow: getPresetVariant(item).cardShadow
                                    }"
                                >
                                    <div class="preview-card-top">
                                        <span
                                            class="preview-glyph"
                                            :style="{
                                                fontFamily: getPreviewFontFamily(item.previewFont),
                                                color: getPresetVariant(item).cardTitleColor
                                            }"
                                        >
                                            Aa
                                        </span>
                                        <span
                                            class="preview-title-bar"
                                            :style="{
                                                backgroundColor:
                                                    getPresetVariant(item).cardTitleColor
                                            }"
                                        />
                                        <span
                                            class="preview-accent-pill"
                                            :style="{
                                                backgroundColor: getPresetVariant(item).primaryColor
                                            }"
                                        />
                                    </div>
                                    <div class="preview-lines">
                                        <span
                                            class="preview-line is-long"
                                            :style="{
                                                backgroundColor:
                                                    getPresetVariant(item).secondaryTextColor
                                            }"
                                        />
                                        <span
                                            class="preview-line is-short"
                                            :style="{
                                                backgroundColor:
                                                    getPresetVariant(item).mutedTextColor
                                            }"
                                        />
                                    </div>
                                    <div class="preview-card-bottom">
                                        <span
                                            class="preview-code-chip"
                                            :style="{
                                                backgroundColor:
                                                    getPresetVariant(item)
                                                        .inlineCodeBackgroundColor,
                                                color: getPresetVariant(item).inlineCodeTextColor,
                                                borderColor: getPresetVariant(item).borderColor
                                            }"
                                        >
                                            dp[i]
                                        </span>
                                        <span class="preview-dots">
                                            <span
                                                class="preview-dot"
                                                :style="{
                                                    backgroundColor:
                                                        getPresetVariant(item).primaryColor
                                                }"
                                            />
                                            <span
                                                class="preview-dot"
                                                :style="{
                                                    backgroundColor:
                                                        getPresetVariant(item).successColor
                                                }"
                                            />
                                            <span
                                                class="preview-dot"
                                                :style="{
                                                    backgroundColor:
                                                        getPresetVariant(item).warningColor
                                                }"
                                            />
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div class="preset-meta">
                                <div class="preset-meta-top">
                                    <span class="preset-name">{{ item.label }}</span>
                                    <span class="preset-tag">{{ item.tag }}</span>
                                </div>
                                <div class="preset-desc">{{ item.description }}</div>
                            </div>
                        </button>
                    </div>
                </section>

                <section class="editor-section code-preset-section" aria-label="代码主题">
                    <div class="section-heading-row">
                        <span class="section-heading">代码主题</span>
                        <span v-if="!activeCodeThemePreset" class="custom-badge">自定义搭配</span>
                    </div>
                    <div class="code-preset-grid" role="group" aria-label="代码主题预设">
                        <button
                            v-for="item in codeThemePresets"
                            :key="item.id"
                            type="button"
                            class="preset-tile"
                            :class="{ 'is-active': activeCodeThemePreset === item.id }"
                            :aria-pressed="activeCodeThemePreset === item.id"
                            @click="selectCodeThemePreset(item.id)"
                        >
                            <div
                                class="code-preset-canvas"
                                :style="{
                                    backgroundColor: getCodePreviewPalette(item).bg,
                                    borderBottomColor: getCodePreviewPalette(item).border
                                }"
                            >
                                <span
                                    v-if="activeCodeThemePreset === item.id"
                                    class="preset-check"
                                    :style="{ backgroundColor: uiTheme.primaryColor }"
                                    aria-hidden="true"
                                >
                                    <n-icon :component="Check" :size="11" />
                                </span>
                                <div
                                    class="code-snippet"
                                    :style="{ color: getCodePreviewPalette(item).text }"
                                >
                                    <div class="code-snippet-line">
                                        <span
                                            :style="{ color: getCodePreviewPalette(item).keyword }"
                                            >const</span
                                        >&nbsp;<span
                                            :style="{ color: getCodePreviewPalette(item).fn }"
                                            >ans</span
                                        >&nbsp;=&nbsp;<span
                                            :style="{ color: getCodePreviewPalette(item).number }"
                                            >1e9</span
                                        >;
                                    </div>
                                    <div class="code-snippet-line">
                                        <span
                                            :style="{ color: getCodePreviewPalette(item).keyword }"
                                            >return</span
                                        >&nbsp;<span
                                            :style="{ color: getCodePreviewPalette(item).string }"
                                            >"AC"</span
                                        >;
                                    </div>
                                </div>
                            </div>
                            <div class="code-preset-meta">
                                <span class="preset-name">{{ item.label }}</span>
                                <span class="preset-tag">{{ item.tag }}</span>
                            </div>
                        </button>
                    </div>
                </section>

                <section class="editor-section typography-section" aria-label="字体与排版">
                    <div class="section-heading">字体与排版</div>
                    <n-form label-placement="top" label-width="auto" class="compact-form">
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
                    </n-form>

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
                            :style="{
                                backgroundColor: activeCodePreview.bg,
                                borderColor: activeCodePreview.border,
                                color: activeCodePreview.text
                            }"
                        ><code><span :style="{ color: activeCodePreview.keyword }">const</span> ans = <span :style="{ color: activeCodePreview.fn }">dp</span>[n] % <span :style="{ color: activeCodePreview.number }">MOD</span>;</code></pre>
                    </div>
                </section>

                <section class="editor-section advanced-section" aria-label="高级选项">
                    <n-collapse class="advanced-collapse">
                        <n-collapse-item title="高级选项" name="advanced">
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
                                            <n-color-picker
                                                v-model:value="uiTheme[item.key]"
                                                show-alpha
                                            />
                                        </n-form-item>
                                        <n-form-item label="代码主题" path="codeTheme">
                                            <n-select
                                                v-model:value="uiTheme.codeTheme"
                                                :options="codeThemeOptions"
                                            />
                                        </n-form-item>
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
                                            <n-color-picker
                                                v-model:value="uiTheme[item.key]"
                                                show-alpha
                                            />
                                        </n-form-item>
                                    </n-collapse-item>

                                    <n-collapse-item title="代码高亮与排版" name="code-advanced">
                                        <n-form-item label="代码明暗模式" path="codeTheme">
                                            <n-select
                                                v-model:value="uiTheme.codeTheme"
                                                :options="codeThemeOptions"
                                            />
                                        </n-form-item>
                                        <n-form-item label="浅色高亮主题">
                                            <n-select
                                                v-model:value="lightShikiTheme"
                                                :options="lightShikiThemeOptions"
                                            />
                                        </n-form-item>
                                        <n-form-item label="深色高亮主题">
                                            <n-select
                                                v-model:value="darkShikiTheme"
                                                :options="darkShikiThemeOptions"
                                            />
                                        </n-form-item>
                                        <n-form-item label="代码字号 (px)">
                                            <n-input-number
                                                v-model:value="codeFontSize"
                                                :min="12"
                                                :max="18"
                                                :step="0.5"
                                            />
                                        </n-form-item>
                                        <n-form-item label="代码行高">
                                            <n-input-number
                                                v-model:value="codeLineHeight"
                                                :min="1.3"
                                                :max="2.0"
                                                :step="0.1"
                                            />
                                        </n-form-item>
                                        <div class="switch-row">
                                            <span>显示行号</span>
                                            <n-switch v-model:value="codeShowLineNumbers" />
                                        </div>
                                        <div class="switch-row">
                                            <span>自动换行</span>
                                            <n-switch v-model:value="codeWordWrap" />
                                        </div>
                                        <n-button
                                            secondary
                                            size="small"
                                            class="code-reset-btn"
                                            @click="resetCodeThemeSettings"
                                        >
                                            恢复默认代码设置
                                        </n-button>
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
                                            <n-input-number
                                                v-model:value="pillRadiusNumber"
                                                :min="0"
                                            />
                                        </n-form-item>
                                    </n-collapse-item>
                                </n-collapse>
                            </n-form>
                        </n-collapse-item>
                    </n-collapse>
                </section>
            </div>

            <template #footer>
                <n-space justify="end">
                    <n-button @click="handleResetToPreset">重置为预设</n-button>
                </n-space>
            </template>
        </n-drawer-content>
    </n-drawer>
</template>

<style scoped>
.editor-sections {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-5);
}

.editor-section {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.mode-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    flex-wrap: wrap;
}

.section-heading {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-card-title-color);
}

.preset-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
}

.preset-tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    border: 1px solid var(--ui-border-color);
    border-radius: var(--ui-card-radius);
    background: var(--ui-card-color);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
        border-color var(--ui-motion-fast) var(--ui-motion-ease),
        box-shadow var(--ui-motion-normal) var(--ui-motion-ease),
        transform var(--ui-motion-instant) var(--ui-motion-ease-out);
}

.preset-tile:hover {
    border-color: var(--ui-primary-color-hover);
}

.preset-tile:active {
    transform: scale(0.985);
}

.preset-tile:focus-visible {
    outline: none;
    border-color: var(--ui-primary-color);
    box-shadow: var(--ui-focus-ring-shadow);
}

.preset-tile.is-active {
    border-color: var(--ui-primary-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary-color) 24%, transparent);
}

.preset-canvas {
    position: relative;
    padding: 10px;
    border-bottom: 1px solid transparent;
}

.preset-check {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    color: #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
}

.preview-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 9px;
    border: 1px solid transparent;
}

.preview-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.preview-glyph {
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
}

.preview-title-bar {
    flex: 1;
    height: 5px;
    border-radius: 999px;
    opacity: 0.72;
}

.preview-accent-pill {
    width: 16px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
}

.preview-lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.preview-line {
    display: block;
    height: 4px;
    border-radius: 999px;
}

.preview-line.is-long {
    width: 82%;
    opacity: 0.45;
}

.preview-line.is-short {
    width: 56%;
    opacity: 0.35;
}

.preview-card-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: 1px;
}

.preview-code-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-family: var(--ui-font-family-mono);
    font-size: 10px;
    line-height: 1.3;
}

.preview-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.preview-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
}

.preset-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px 9px;
}

.preset-meta-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-1);
    min-width: 0;
}

.preset-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-card-title-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preset-tag {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-panel-color);
    color: var(--ui-secondary-text-color);
    font-size: 11px;
    line-height: 1.4;
}

.preset-desc {
    font-size: 11px;
    line-height: 1.4;
    color: var(--ui-muted-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.typography-section,
.code-preset-section,
.advanced-section {
    padding-top: var(--ui-space-4);
    border-top: 1px solid var(--ui-border-color);
}

.section-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
}

.custom-badge {
    padding: 1px 6px;
    border-radius: var(--ui-tag-radius);
    background: var(--ui-panel-color);
    color: var(--ui-primary-color);
    font-size: 11px;
    font-weight: 500;
}

.code-preset-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
}

.code-preset-canvas {
    position: relative;
    padding: 10px 11px;
    border-bottom: 1px solid transparent;
}

.code-snippet {
    font-family: var(--ui-font-family-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
}

.code-snippet-line {
    overflow: hidden;
    text-overflow: ellipsis;
}

.code-preset-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-1);
    padding: 7px 10px;
}

.switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-2);
    padding: 4px 0 12px;
    color: var(--ui-text-color);
}

.code-reset-btn {
    margin-top: var(--ui-space-1);
}

.compact-form :deep(.n-form-item:last-child) {
    margin-bottom: 0;
}

.compact-form :deep(.n-form-item-feedback-wrapper) {
    min-height: 10px;
}

.advanced-collapse :deep(.n-collapse-item__header) {
    font-weight: 600;
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
    font-size: var(--ui-code-font-size, 13.5px);
    line-height: var(--ui-code-line-height, 1.6);
    overflow-x: auto;
}

.font-preview-code code {
    font-family: inherit;
}

@media (max-width: 360px) {
    .preset-grid,
    .code-preset-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
