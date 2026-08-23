<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { NSpin } from 'naive-ui';
import 'katex/dist/katex.min.css';
import '@/styles/markdown.css';
import { renderMarkdown } from '@/lib/markdown-renderer';

const props = defineProps<{
    content?: string;
    loading?: boolean;
}>();

const emit = defineEmits<{
    rendered: [html: string];
}>();

const contentRef = ref<HTMLElement | null>(null);
const renderedContent = ref('');
const rendering = ref(Boolean(props.content));

const CARET_RIGHT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
<!--!Font Awesome Pro v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2025 Fonticons, Inc.-->
<path d="M441.3 299.8C451.5 312.4 450.8 330.9 439.1 342.6L311.1 470.6C301.9 479.8 288.2 482.5 276.2 477.5C264.2 472.5 256.5 460.9 256.5 448L256.5 192C256.5 179.1 264.3 167.4 276.3 162.4C288.3 157.4 302 160.2 311.2 169.3L439.2 297.3L441.4 299.7z"/></svg>
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

const GITHUB_LIGHT_TO_DARK_COLOR: Record<string, string> = {
    '#24292e': '#e1e4e8',
    '#6a737d': '#6a737d',
    '#005cc5': '#79b8ff',
    '#6f42c1': '#b392f0',
    '#22863a': '#85e89d',
    '#d73a49': '#f97583',
    '#032f62': '#9ecbff',
    '#e36209': '#ffab70',
    '#b31d28': '#fdaeb7',
    '#fafbfc': '#24292e',
    '#586069': '#d1d5da',
    '#b08800': '#ffea7f',
    '#dbab09': '#ffea7f',
    '#1b7c83': '#39c5cf',
    '#3192aa': '#56d4dd',
    '#5a32a3': '#b392f0',
    '#cb2431': '#f97583'
};

const GITHUB_LIGHT_TO_DARK_BACKGROUND: Record<string, string> = {
    '#fff': '#24292e',
    '#ffffff': '#24292e',
    '#f6f8fa': '#2f363d',
    '#ffeef0': '#86181d',
    '#f0fff4': '#144620',
    '#ffebda': '#c24e00',
    '#005cc5': '#79b8ff'
};

const normalizeHexColor = (value: string | null) => {
    const color = (value || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(color)) return '';

    if (color.length === 4) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }

    return color;
};

const setLegacyDarkVar = (
    element: HTMLElement,
    lightName: string,
    darkName: string,
    colors: Record<string, string>,
    fallback: string
) => {
    const lightColor = normalizeHexColor(element.style.getPropertyValue(lightName));
    if (!lightColor) return;

    const darkColor = normalizeHexColor(element.style.getPropertyValue(darkName));
    if (darkColor && darkColor !== lightColor) return;

    element.style.setProperty(darkName, colors[lightColor] || fallback);
};

const normalizeLegacyShikiThemes = () => {
    if (!contentRef.value) return;

    contentRef.value.querySelectorAll<HTMLElement>('pre.shiki').forEach(pre => {
        if (pre.classList.contains('github-dark')) return;

        setLegacyDarkVar(
            pre,
            '--shiki-light',
            '--shiki-dark',
            GITHUB_LIGHT_TO_DARK_COLOR,
            '#e1e4e8'
        );
        setLegacyDarkVar(
            pre,
            '--shiki-light-bg',
            '--shiki-dark-bg',
            GITHUB_LIGHT_TO_DARK_BACKGROUND,
            '#24292e'
        );

        pre.querySelectorAll<HTMLElement>('[style*="--shiki-light"]').forEach(token => {
            setLegacyDarkVar(
                token,
                '--shiki-light',
                '--shiki-dark',
                GITHUB_LIGHT_TO_DARK_COLOR,
                '#e1e4e8'
            );
            setLegacyDarkVar(
                token,
                '--shiki-light-bg',
                '--shiki-dark-bg',
                GITHUB_LIGHT_TO_DARK_BACKGROUND,
                '#24292e'
            );
        });
    });
};

const toggleMarkdownBlock = (event: Event) => {
    const title = event.currentTarget as HTMLElement;
    const body = title.nextElementSibling as HTMLElement | null;
    const btn = title.querySelector('.toggle-btn');
    if (!body || !btn) return;

    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    btn.classList.toggle('expanded', isHidden);
};

const initMarkdownBlocks = () => {
    if (!contentRef.value) return;

    contentRef.value.querySelectorAll('.md-block .md-block-title').forEach(title => {
        const btn = title.querySelector('.toggle-btn');
        if (!btn) return;

        btn.className = 'toggle-btn';

        btn.innerHTML = CARET_RIGHT_SVG;

        const body = title.nextElementSibling as HTMLElement;
        if (body && body.style.display !== 'none') {
            btn.classList.add('expanded');
        }

        title.removeEventListener('click', toggleMarkdownBlock);
        title.addEventListener('click', toggleMarkdownBlock);
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
        button.className = 'copy-code-btn';
        button.innerHTML = COPY_SVG;
        button.title = '复制代码';

        button.addEventListener('click', async e => {
            e.stopPropagation();
            const codeElement = pre.querySelector('code');
            const codeText = codeElement ? codeElement.innerText : pre.innerText;

            try {
                await navigator.clipboard.writeText(codeText);
                const originalHTML = button.innerHTML;
                button.innerHTML = CHECK_SVG;
                setTimeout(() => {
                    button.innerHTML = originalHTML;
                }, 1500);
            } catch (err) {
                console.error('复制失败:', err);
            }
        });

        wrapper.appendChild(button);
    });
};

let renderVersion = 0;

const processContent = async () => {
    const version = ++renderVersion;
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
        renderedContent.value = '<p>渲染失败</p>';
    } finally {
        if (version === renderVersion) rendering.value = false;
    }

    await nextTick();
    if (version !== renderVersion) return;
    normalizeLegacyShikiThemes();
    initMarkdownBlocks();
    addCopyButtons();
    emit('rendered', renderedContent.value);
};

watch(
    () => props.content,
    () => void processContent()
);

onMounted(() => void processContent());
onUnmounted(() => {
    renderVersion++;
});
</script>

<template>
    <div class="md-container">
        <div v-if="loading || rendering" class="empty-tip">
            <n-spin size="small" :description="rendering ? '正在渲染...' : '加载中...'" />
        </div>
        <div v-else-if="!renderedContent" class="empty-tip">暂无内容</div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else ref="contentRef" class="md-body" v-html="renderedContent"></div>
    </div>
</template>

<style scoped>
.md-body :deep(.code-block-wrapper) {
    position: relative;
}

.md-body :deep(.copy-code-btn) {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 6px;
    background: var(--ui-copy-button-background-color);
    backdrop-filter: blur(4px);
    border: none;
    border-radius: var(--ui-card-radius);
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

.md-body :deep(.code-block-wrapper:hover .copy-code-btn) {
    opacity: 1;
}

.md-body :deep(.copy-code-btn:hover) {
    background: var(--ui-copy-button-background-color);
    color: var(--ui-primary-color);
}

.md-body :deep(.copy-code-btn svg) {
    display: block;
}
</style>
