<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { NEllipsis, NIcon } from 'naive-ui';
import { Check } from 'lucide-vue-next';
import {
    type UiThemeMode,
    type UiThemePresetName,
    type UiThemeVars
} from '@/styles/theme/themeKeys.ts';
import {
    resolveEffectiveColorScheme,
    THEME_PRESET_LIST,
    type PresetPreviewFont,
    type UiThemePreset
} from '@/styles/theme/presets.ts';

const preset = defineModel<UiThemePresetName>({ required: true });

const props = withDefaults(
    defineProps<{
        mode: UiThemeMode;
        layout?: 'compact' | 'wide';
    }>(),
    {
        layout: 'compact'
    }
);

const darkMediaQuery =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const hoverMediaQuery =
    typeof window !== 'undefined' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
const prefersDark = ref(darkMediaQuery?.matches ?? false);
const canHover = ref(hoverMediaQuery?.matches ?? false);
const handleSchemeChange = (event: MediaQueryListEvent) => {
    prefersDark.value = event.matches;
};
const handleHoverChange = (event: MediaQueryListEvent) => {
    canHover.value = event.matches;
};

onMounted(() => {
    darkMediaQuery?.addEventListener('change', handleSchemeChange);
    hoverMediaQuery?.addEventListener('change', handleHoverChange);
});

onUnmounted(() => {
    darkMediaQuery?.removeEventListener('change', handleSchemeChange);
    hoverMediaQuery?.removeEventListener('change', handleHoverChange);
});

const descTooltip = computed(() => (canHover.value ? ({ placement: 'bottom' } as const) : false));

const effectiveScheme = computed(() => resolveEffectiveColorScheme(props.mode, prefersDark.value));

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
</script>

<template>
    <div
        class="preset-grid"
        :class="{ 'is-wide': layout === 'wide' }"
        role="group"
        aria-label="主题预设"
    >
        <button
            v-for="item in THEME_PRESET_LIST"
            :key="item.name"
            type="button"
            class="preset-tile"
            :class="{ 'is-active': preset === item.name }"
            :aria-pressed="preset === item.name"
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
                        borderRadius: getPreviewRadius(getPresetVariant(item).cardRadius),
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
                                backgroundColor: getPresetVariant(item).cardTitleColor
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
                                backgroundColor: getPresetVariant(item).secondaryTextColor
                            }"
                        />
                        <span
                            class="preview-line is-short"
                            :style="{
                                backgroundColor: getPresetVariant(item).mutedTextColor
                            }"
                        />
                    </div>
                    <div class="preview-card-bottom">
                        <span
                            class="preview-code-chip"
                            :style="{
                                backgroundColor: getPresetVariant(item).inlineCodeBackgroundColor,
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
                                    backgroundColor: getPresetVariant(item).primaryColor
                                }"
                            />
                            <span
                                class="preview-dot"
                                :style="{
                                    backgroundColor: getPresetVariant(item).successColor
                                }"
                            />
                            <span
                                class="preview-dot"
                                :style="{
                                    backgroundColor: getPresetVariant(item).warningColor
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
                <div class="preset-desc">
                    <n-ellipsis :tooltip="descTooltip">
                        {{ item.description }}
                    </n-ellipsis>
                </div>
            </div>
        </button>
    </div>
</template>

<style scoped>
.preset-grid {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-3);
    width: 100%;
    min-width: 0;
    max-width: 100%;
}

.preset-grid.is-wide {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.preset-tile {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 100%;
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
    min-width: 0;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.4;
    color: var(--ui-muted-text-color);
}

.preset-desc :deep(.n-ellipsis) {
    display: block;
    max-width: 100%;
    font-size: inherit;
    font-weight: inherit;
    line-height: inherit;
    color: inherit;
}

@media (max-width: 720px) {
    .preset-grid.is-wide {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 360px) {
    .preset-grid,
    .preset-grid.is-wide {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
