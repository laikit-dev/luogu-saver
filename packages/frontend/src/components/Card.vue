<script setup lang="ts">
import {
    type CSSProperties,
    inject,
    computed,
    type Component,
    type PropType,
    ref,
    useSlots,
    type Ref
} from 'vue';
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router';
import { NIcon } from 'naive-ui';
import MarkedText from '@/components/MarkedText.vue';
import {
    extractArticleIdFromRoute,
    navigateWithArticleCurtain,
    preloadArticleDetailView,
    type ArticleCurtainMeta
} from '@/composables/useArticleTransition';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { uiThemeKey, type UiThemeVars } from '@/styles/theme/themeKeys.ts';
const themeVars: Ref<UiThemeVars> = inject(uiThemeKey)!;
const slots = useSlots();
const router = useRouter();
const reducedMotion = useReducedMotion();
const cardRef = ref<HTMLElement | null>(null);

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
    markedTitle: {
        type: String,
        default: null
    },
    // Renders the title as a real in-site link (middle-click, copy link, keyboard).
    to: {
        type: [String, Object] as PropType<RouteLocationRaw>,
        default: null
    },
    transitionMeta: {
        type: Object as PropType<ArticleCurtainMeta | null>,
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
    return !!props.title || !!props.markedTitle || !!slots['header-extra'];
});

const handlePrefetch = () => {
    if (extractArticleIdFromRoute(props.to)) {
        preloadArticleDetailView();
    }
};

const handleLinkClick = (
    event: MouseEvent,
    navigate: (e?: MouseEvent) => Promise<void | unknown>
) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    const articleId = extractArticleIdFromRoute(props.to);
    if (articleId) {
        event.preventDefault();
        void navigateWithArticleCurtain(
            router,
            props.to,
            cardRef.value,
            props.transitionMeta ?? (props.title ? { title: props.title } : undefined),
            reducedMotion.value
        );
        return;
    }

    void navigate(event);
};
</script>

<template>
    <div
        ref="cardRef"
        class="saver-card"
        :class="{ 'is-hoverable': hoverable }"
        :style="cardStyle"
        @pointerenter="handlePrefetch"
        @click="event => emit('click', event)"
    >
        <div v-if="showHeader" class="card-header">
            <div class="card-title-wrapper">
                <n-icon
                    v-if="icon"
                    :component="icon"
                    :color="effectiveIconColor"
                    size="18"
                    :depth="1"
                />
                <RouterLink
                    v-if="to && (markedTitle || title)"
                    v-slot="{ href, navigate }"
                    :to="to"
                    custom
                >
                    <a
                        :href="href"
                        class="card-title-link"
                        @click.stop="handleLinkClick($event, navigate)"
                    >
                        <span
                            v-if="markedTitle"
                            class="card-title"
                            :style="{ color: themeVars.cardTitleColor }"
                        >
                            <MarkedText :text="markedTitle" :fallback="title ?? ''" />
                        </span>
                        <span
                            v-else
                            class="card-title"
                            :style="{ color: themeVars.cardTitleColor }"
                        >
                            {{ title }}
                        </span>
                    </a>
                </RouterLink>
                <span
                    v-else-if="markedTitle"
                    class="card-title"
                    :style="{ color: themeVars.cardTitleColor }"
                >
                    <MarkedText :text="markedTitle" :fallback="title ?? ''" />
                </span>
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
        transform var(--ui-motion-normal) var(--ui-motion-ease),
        box-shadow var(--ui-motion-normal) var(--ui-motion-ease),
        border-color var(--ui-motion-fast) var(--ui-motion-ease);
    display: flex;
    flex-direction: column;
}

.saver-card.is-hoverable:hover {
    border-color: var(--ui-primary-color-suppl);
    box-shadow: var(--ui-card-shadow) !important;
}

@media (hover: hover) and (pointer: fine) {
    .saver-card.is-hoverable:hover {
        transform: translateY(-3px);
        box-shadow: var(--ui-elevated-shadow) !important;
        border-color: color-mix(in srgb, var(--ui-primary-color) 32%, var(--ui-border-color));
    }

    .saver-card.is-hoverable:active {
        transform: translateY(-1px);
        transition-duration: var(--ui-motion-instant);
    }
}

:global(html[data-ui-motion='reduce']) .saver-card.is-hoverable:hover,
:global(html[data-ui-motion='reduce']) .saver-card.is-hoverable:active {
    transform: none;
}

@media (prefers-reduced-motion: reduce) {
    :global(html:not([data-ui-motion='standard'])) .saver-card.is-hoverable:hover,
    :global(html:not([data-ui-motion='standard'])) .saver-card.is-hoverable:active {
        transform: none;
    }
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-3);
    margin-bottom: var(--ui-space-4);
}

.card-title-wrapper {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    min-width: 0;
}

.card-title-wrapper > .n-icon {
    flex-shrink: 0;
}

.card-title {
    font-weight: 600;
    font-size: 16px;
    line-height: 1.35;
    letter-spacing: -0.01em;
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
