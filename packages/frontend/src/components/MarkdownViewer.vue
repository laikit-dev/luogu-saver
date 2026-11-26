<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { NAlert, useMessage } from 'naive-ui';
import 'katex/dist/katex.min.css';
import '@/styles/markdown.css';
import { renderMarkdown } from '@/lib/markdown-renderer';
import type { TocItem } from '@/types/article';
import { extractTocFromElement } from '@/utils/article';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { handleInPageHashClick } from '@/utils/navigation-history';
const props = defineProps<{
    content?: string;
    loading?: boolean;
    headingOffset?: number;
}>();

const emit = defineEmits<{
    rendered: [toc: TocItem[]];
}>();

const message = useMessage();
const reducedMotion = useReducedMotion();
const contentRef = ref<HTMLElement | null>(null);
const renderedContent = ref('');
const renderFailed = ref(false);
const rendering = ref(Boolean(props.content));

// Lucide "chevron-right"; rotated by `.toggle-btn.expanded`.
const CHEVRON_RIGHT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 18 6-6-6-6"></path>
</svg>
`;

const COPY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>
`;

const CHECK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>
`;

const setMarkdownBlockExpanded = (title: HTMLElement, expanded: boolean) => {
    const body = title.nextElementSibling as HTMLElement | null;
    if (!body) return;
    body.style.display = expanded ? 'block' : 'none';
    title.querySelector('.toggle-btn')?.classList.toggle('expanded', expanded);
    title.setAttribute('aria-expanded', String(expanded));
};

const toggleMarkdownBlock = (event: Event) => {
    const title = event.currentTarget as HTMLElement;
    // Titles can contain links; activating a link (click, or Enter which fires a click) follows
    // it instead of toggling the block.
    if ((event.target as Element | null)?.closest('a') && title.contains(event.target as Node)) {
        return;
    }
    const body = title.nextElementSibling as HTMLElement | null;
    if (!body) return;
    setMarkdownBlockExpanded(title, body.style.display === 'none');
};

const handleMarkdownBlockKeydown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleMarkdownBlock(event);
};

const initMarkdownBlocks = () => {
    if (!contentRef.value) return;

    contentRef.value.querySelectorAll<HTMLElement>('.md-block .md-block-title').forEach(title => {
        const btn = title.querySelector('.toggle-btn');
        if (!btn) return;

        btn.className = 'toggle-btn';
        btn.innerHTML = CHEVRON_RIGHT_SVG;

        const body = title.nextElementSibling as HTMLElement | null;
        const expanded = Boolean(body && body.style.display !== 'none');
        btn.classList.toggle('expanded', expanded);
        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.setAttribute('aria-expanded', String(expanded));

        title.removeEventListener('click', toggleMarkdownBlock);
        title.addEventListener('click', toggleMarkdownBlock);
        title.removeEventListener('keydown', handleMarkdownBlockKeydown);
        title.addEventListener('keydown', handleMarkdownBlockKeydown);
    });
};

const addCopyButtons = () => {
    if (!contentRef.value) return;

    const existingButtons = contentRef.value.querySelectorAll('.copy-code-btn');
    existingButtons.forEach(btn => btn.remove());

    const codeBlocks = contentRef.value.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
        let wrapper = pre.parentElement;
        if (!wrapper?.classList.contains('code-block-wrapper')) {
            wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            pre.before(wrapper);
            wrapper.appendChild(pre);
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-code-btn';
        button.innerHTML = COPY_SVG;
        button.title = '复制代码';
        button.setAttribute('aria-label', '复制代码');

        button.addEventListener('click', async e => {
            e.stopPropagation();
            const codeElement = pre.querySelector('code');
            const codeText = codeElement ? codeElement.innerText : pre.innerText;

            try {
                await navigator.clipboard.writeText(codeText);
                message.success('已复制代码');
                button.innerHTML = CHECK_SVG;
                setTimeout(() => {
                    button.innerHTML = COPY_SVG;
                }, 1500);
            } catch (err) {
                console.error('Copy code failed:', err);
                message.error('复制失败');
            }
        });

        wrapper.appendChild(button);
    });
};

let renderVersion = 0;

const processContent = async () => {
    const version = ++renderVersion;
    renderFailed.value = false;
    if (!props.content) {
        rendering.value = false;
        renderedContent.value = '';
        return;
    }

    rendering.value = true;
    try {
        const html = await renderMarkdown(props.content);
        if (version !== renderVersion) return;
        renderedContent.value = html;
    } catch (error) {
        if (version !== renderVersion) return;
        console.error('Markdown render failed:', error);
        renderedContent.value = '';
        renderFailed.value = true;
        return;
    } finally {
        if (version === renderVersion) rendering.value = false;
    }

    await nextTick();
    if (version !== renderVersion) return;
    const headingOffset = Math.min(5, Math.max(0, Math.trunc(props.headingOffset ?? 0)));
    if (headingOffset > 0 && contentRef.value) {
        // Keep generated anchors while nesting archive headings beneath the page title.
        for (const heading of contentRef.value.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
            const originalLevel = Number(heading.tagName[1]);
            const level = Math.min(6, originalLevel + headingOffset);
            if (level === originalLevel) continue;
            const nestedHeading = document.createElement(`h${level}`);
            for (const attribute of heading.attributes) {
                nestedHeading.setAttribute(attribute.name, attribute.value);
            }
            while (heading.firstChild) {
                nestedHeading.appendChild(heading.firstChild);
            }
            heading.replaceWith(nestedHeading);
        }
    }
    initMarkdownBlocks();
    addCopyButtons();
    emit('rendered', extractTocFromElement(contentRef.value));
};

watch([() => props.content, () => props.headingOffset], () => void processContent());

onMounted(() => void processContent());
const handleBodyClick = (event: MouseEvent) => {
    handleInPageHashClick(event, reducedMotion.value);
};
onUnmounted(() => {
    renderVersion++;
});
</script>

<template>
    <div class="md-container">
        <div
            v-if="loading || rendering"
            class="markdown-loading-state"
            role="status"
            aria-live="polite"
        >
            <span class="markdown-loading-spinner" aria-hidden="true" />
            <span>{{ rendering ? '正在渲染...' : '加载中...' }}</span>
        </div>
        <n-alert v-else-if="renderFailed" type="error" title="正文渲染失败">
            正文暂时无法显示，请刷新页面重试。
        </n-alert>
        <div v-else-if="!renderedContent" class="empty-tip">暂无内容</div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
            v-else
            ref="contentRef"
            class="md-body"
            @click="handleBodyClick"
            v-html="renderedContent"
        ></div>
    </div>
</template>

<style scoped>
.markdown-loading-state {
    min-height: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ui-muted-text-color);
}
.markdown-loading-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--ui-panel-color);
    border-top-color: var(--ui-primary-color);
    border-radius: 50%;
    animation: markdown-loading-spin 0.8s linear infinite;
}

@keyframes markdown-loading-spin {
    to {
        transform: rotate(360deg);
    }
}

.md-body :deep(.code-block-wrapper) {
    position: relative;
}

.md-body :deep(.copy-code-btn) {
    position: absolute;
    top: var(--ui-space-2);
    right: var(--ui-space-2);
    padding: var(--ui-space-1) 6px;
    background: var(--ui-copy-button-background-color);
    backdrop-filter: blur(4px);
    border: none;
    border-radius: var(--ui-button-radius);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity 0.2s ease,
        background 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-copy-button-text-color);
    box-shadow: var(--ui-elevated-shadow);
    z-index: 2;
}

.md-body :deep(.code-block-wrapper:hover .copy-code-btn),
.md-body :deep(.code-block-wrapper:focus-within .copy-code-btn),
.md-body :deep(.copy-code-btn:focus-visible) {
    opacity: 1;
}

@media (hover: none) {
    .md-body :deep(.copy-code-btn) {
        opacity: 0.85;
    }
}
.md-body :deep(.copy-code-btn:focus-visible),
.md-body :deep(.md-block-title:focus-visible) {
    outline: 2px solid var(--ui-primary-color);
    outline-offset: 2px;
}

.md-body :deep(.copy-code-btn:hover) {
    background: var(--ui-copy-button-background-color);
    color: var(--ui-primary-color);
}

.md-body :deep(.copy-code-btn svg) {
    display: block;
}
</style>
