<script setup lang="ts">
import {
    type CSSProperties,
    inject,
    computed,
    type Component,
    type PropType,
    useSlots,
    type Ref
} from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { NIcon } from 'naive-ui';
import { uiThemeKey, type UiThemeVars } from '@/styles/theme/themeKeys.ts';

const themeVars: Ref<UiThemeVars> = inject(uiThemeKey)!;
const slots = useSlots();

const props = defineProps({
    title: {
        type: String,
        default: null
    },
    icon: {
        type: Object as () => Component,
        default: null
    },
    iconColor: {
        type: String,
        default: null
    },
    backgroundColor: {
        type: String,
        default: null
    },
    hoverable: {
        type: Boolean,
        default: false
    },
    titleHtml: {
        type: String,
        default: null
    },
    // Renders the title as a real in-site link (middle-click, copy link, keyboard).
    to: {
        type: [String, Object] as PropType<RouteLocationRaw>,
        default: null
    }
});

const emit = defineEmits<{
    click: [event: MouseEvent];
}>();

const effectiveIconColor = computed(() => {
    return props.iconColor || themeVars.value.primaryColor;
});

const effectiveBackgroundColor = computed(() => {
    return props.backgroundColor || themeVars.value.cardColor;
});

const cardStyle = computed(
    (): CSSProperties => ({
        backgroundColor: effectiveBackgroundColor.value,
        boxShadow: themeVars.value.cardShadow,
        borderRadius: themeVars.value.cardRadius
    })
);

const showHeader = computed(() => {
    return !!props.title || !!props.titleHtml || !!slots['header-extra'];
});
</script>

<template>
    <div
        class="saver-card"
        :class="{ 'is-hoverable': hoverable }"
        :style="cardStyle"
        @click="event => emit('click', event)"
    >
        <div v-if="showHeader" class="card-header">
            <div class="card-title-wrapper">
                <n-icon
                    v-if="icon"
                    :component="icon"
                    :color="effectiveIconColor"
                    size="24"
                    :depth="1"
                />
                <RouterLink
                    v-if="to && (titleHtml || title)"
                    :to="to"
                    class="card-title-link"
                    @click.stop
                >
                    <span
                        v-if="titleHtml"
                        class="card-title"
                        :style="{ color: themeVars.cardTitleColor }"
                        v-html="titleHtml"
                    />
                    <span v-else class="card-title" :style="{ color: themeVars.cardTitleColor }">
                        {{ title }}
                    </span>
                </RouterLink>
                <span
                    v-else-if="titleHtml"
                    class="card-title"
                    :style="{ color: themeVars.cardTitleColor }"
                    v-html="titleHtml"
                />
                <span
                    v-else-if="title"
                    class="card-title"
                    :style="{ color: themeVars.cardTitleColor }"
                >
                    {{ title }}
                </span>
                <slot name="title-extra" />
            </div>
            <div class="card-extra">
                <slot name="header-extra" />
            </div>
        </div>
        <div class="card-content">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.saver-card {
    padding: var(--ui-card-padding);
    border: 1px solid var(--ui-border-color);
    transition:
        transform 0.3s ease,
        box-shadow 0.3s ease,
        border-color 0.3s ease;
    display: flex;
    flex-direction: column;
}

.saver-card.is-hoverable:hover {
    transform: translateY(-2px);
    border-color: var(--ui-primary-color-suppl);
    box-shadow: var(--ui-card-shadow) !important;
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--ui-space-4);
}

.card-title-wrapper {
    display: flex;
    align-items: center;
    gap: var(--ui-control-gap);
}

.card-title-wrapper > .n-icon {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-card-radius);
    background: var(--ui-mark-background-color);
}

.card-title {
    font-weight: bold;
    font-size: 18px;
    line-height: 1.25;
}

.card-title-link {
    min-width: 0;
    color: inherit;
    text-decoration: none;
    border-radius: 2px;
}

.card-title-link:focus-visible {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.card-content {
    flex: 1;
}

:deep(mark) {
    padding: 0 2px;
    border-radius: 3px;
    background: var(--ui-panel-color);
    color: inherit;
}
</style>
