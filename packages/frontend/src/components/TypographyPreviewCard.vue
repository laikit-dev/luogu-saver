<script setup lang="ts">
import { computed, inject } from 'vue';
import { NSpin } from 'naive-ui';
import { useCodeTheme } from '@/composables/useCodeTheme.ts';
import { useReadingFont } from '@/composables/useReadingFont.ts';
import { uiThemeKey } from '@/styles/theme/themeKeys.ts';

const uiTheme = inject(uiThemeKey);
const { currentReadingFontOption, readingFontLoading } = useReadingFont();
const { codeThemePresets, lightShikiTheme, darkShikiTheme } = useCodeTheme();

const activeCodePreview = computed(() => {
    const scheme = uiTheme?.value.codeTheme === 'dark' ? 'dark' : 'light';
    const matched =
        codeThemePresets.find(
            item =>
                item.lightTheme === lightShikiTheme.value && item.darkTheme === darkShikiTheme.value
        ) ?? codeThemePresets[0]!;
    return matched.preview[scheme];
});
</script>

<template>
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
</template>

<style scoped>
.font-preview-card {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
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
    box-sizing: border-box;
    max-width: 100%;
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
</style>
