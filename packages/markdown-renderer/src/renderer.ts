import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import remarkSmartypants from 'remark-smartypants';
import { visit } from 'unist-util-visit';
import rehypeSanitize, { defaultSchema, type Options } from 'rehype-sanitize';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Options as KatexOptions } from 'rehype-katex';
import type { ElementContent, Root } from 'hast';
import { VFile } from 'vfile';
import type { HighlighterCore, LanguageInput } from '@shikijs/core';

const luoguCaptchaUrlFragment = 'https://www.luogu.com.cn/lg4/captcha';

const headingAnchorIcon: ElementContent = {
    type: 'element',
    tagName: 'svg',
    properties: {
        className: ['heading-pin-icon', 'lucide', 'lucide-pin'],
        xmlns: 'http://www.w3.org/2000/svg',
        width: 24,
        height: 24,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        ariaHidden: 'true',
        focusable: 'false'
    },
    children: [
        {
            type: 'element',
            tagName: 'path',
            properties: { d: 'M12 17v5' },
            children: []
        },
        {
            type: 'element',
            tagName: 'path',
            properties: {
                d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'
            },
            children: []
        }
    ]
};

let processorPromise: Promise<any> | null = null;
const markdownStructureParser = unified().use(remarkParse);

type MathNode = {
    type: 'math';
    position?: {
        start: { line: number; offset?: number };
        end: { line: number; offset?: number };
    };
};

type MathFence = { end: number; length: number; offset: number };
type SourceRange = { end: number; start: number };

function createTextOffsetLookup(src: string) {
    let ranges: SourceRange[] | undefined;

    return (offset: number) => {
        if (!ranges) {
            const textRanges: SourceRange[] = [];
            visit(markdownStructureParser.parse(src), 'text', node => {
                const start = node.position?.start.offset;
                const end = node.position?.end.offset;
                if (start !== undefined && end !== undefined) textRanges.push({ end, start });
            });
            ranges = textRanges.sort((a, b) => a.start - b.start);
        }

        let low = 0;
        let high = ranges.length - 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const range = ranges[middle];
            if (offset < range.start) high = middle - 1;
            else if (offset >= range.end) low = middle + 1;
            else return true;
        }

        return false;
    };
}

function findUnclosedMathFences(
    src: string,
    tree: unknown,
    isTextOffset: (offset: number) => boolean
) {
    const fences: MathFence[] = [];

    visit(tree as any, 'math', (node: MathNode) => {
        const start = node.position?.start;
        const end = node.position?.end;
        if (start?.offset === undefined || end?.offset === undefined) return;

        const openingLineEnd = Math.min(
            ...[
                src.indexOf('\n', start.offset),
                src.indexOf('\r', start.offset),
                src.length
            ].filter(offset => offset >= 0)
        );
        const openingFence = /^(\${2,})[ \t]*$/.exec(src.slice(start.offset, openingLineEnd));
        if (!openingFence) return;

        // remark-math uses the same node shape at EOF, so only the source range reveals closure.
        const lineBreak = Math.max(
            src.lastIndexOf('\n', end.offset - 1),
            src.lastIndexOf('\r', end.offset - 1)
        );
        const finalLine = src.slice(lineBreak + 1, end.offset);
        const closingFence = /^(?:[ \t]*>[ \t]?)*[ \t]*(\${2,})[ \t]*$/.exec(finalLine);
        const closingFenceOffset =
            closingFence === null ? -1 : lineBreak + 1 + finalLine.lastIndexOf(closingFence[1]);
        const isClosed =
            end.line > start.line &&
            closingFence !== null &&
            closingFence[1].length >= openingFence[1].length &&
            isTextOffset(closingFenceOffset);

        if (!isClosed) {
            fences.push({ end: end.offset, length: openingFence[1].length, offset: start.offset });
        }
    });

    return fences;
}

function findStandaloneMathFences(
    src: string,
    range: MathFence,
    isTextOffset: (offset: number) => boolean
) {
    const fences: Array<{ length: number; offset: number }> = [];
    let lineStart = Math.max(
        src.lastIndexOf('\n', range.offset - 1),
        src.lastIndexOf('\r', range.offset - 1)
    );
    lineStart++;

    while (lineStart < range.end) {
        const lineEnd = Math.min(
            ...[src.indexOf('\n', lineStart), src.indexOf('\r', lineStart), range.end].filter(
                offset => offset >= 0 && offset <= range.end
            )
        );
        const line = src.slice(lineStart, lineEnd);
        const match =
            /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?[ \t]*(\${2,})[ \t]*$/.exec(line);

        if (match) {
            const offset = lineStart + line.lastIndexOf(match[1]);
            if (range.offset <= offset && isTextOffset(offset)) {
                fences.push({ length: match[1].length, offset });
            }
        }

        lineStart = lineEnd + (src[lineEnd] === '\r' && src[lineEnd + 1] === '\n' ? 2 : 1);
    }

    if (!fences.some(fence => fence.offset === range.offset)) {
        fences.unshift({ length: range.length, offset: range.offset });
    }

    return fences;
}

function findFenceOpenersWithoutClosers(fences: Array<{ length: number; offset: number }>) {
    const nextClosingFence = new Array<number>(fences.length).fill(-1);
    const stack: number[] = [];

    // The stack gives each opener the nearest later fence with at least the same width.
    for (let index = fences.length - 1; index >= 0; index--) {
        while (stack.length > 0 && fences[stack[stack.length - 1]].length < fences[index].length) {
            stack.pop();
        }
        if (stack.length > 0) nextClosingFence[index] = stack[stack.length - 1];
        stack.push(index);
    }

    const openers: Array<{ length: number; offset: number }> = [];
    for (let index = 0; index < fences.length; ) {
        const closingIndex = nextClosingFence[index];
        if (closingIndex === -1) {
            openers.push(fences[index]);
            index++;
        } else {
            index = closingIndex + 1;
        }
    }

    return openers;
}

function escapeMathFences(src: string, fences: Array<{ length: number; offset: number }>) {
    const uniqueFences = [...new Map(fences.map(fence => [fence.offset, fence])).values()].sort(
        (a, b) => a.offset - b.offset
    );
    const parts: string[] = [];
    let cursor = 0;

    for (const fence of uniqueFences) {
        parts.push(src.slice(cursor, fence.offset), '\\$'.repeat(fence.length));
        cursor = fence.offset + fence.length;
    }
    parts.push(src.slice(cursor));

    return parts.join('');
}

function normalizeDisplayMathFences(src: string) {
    const lines: Array<{ start: number; text: string }> = [];
    let lineStart = 0;
    while (lineStart <= src.length) {
        const lineFeed = src.indexOf('\n', lineStart);
        const rawEnd = lineFeed === -1 ? src.length : lineFeed;
        const lineEnd = rawEnd > lineStart && src[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
        lines.push({ start: lineStart, text: src.slice(lineStart, lineEnd) });
        if (lineFeed === -1) break;
        lineStart = lineFeed + 1;
    }

    const isTextOffset = createTextOffsetLookup(src);
    const insertions: Array<{ offset: number; value: string }> = [];
    const lineEnding = src.includes('\r\n') ? '\r\n' : '\n';
    const openerPattern = /^[ \t]*(\${2,})(?!\$)[ \t]*(\S.*)$/;

    for (let index = 0; index < lines.length; index++) {
        const openingLine = lines[index];
        const openingMatch = openerPattern.exec(openingLine.text);
        if (!openingMatch) continue;
        const openingFenceOffset = openingLine.start + openingLine.text.indexOf(openingMatch[1]);
        if (!isTextOffset(openingFenceOffset)) continue;
        const insertedLine =
            lineEnding + openingLine.text.slice(0, openingFenceOffset - openingLine.start);

        const sameLineClosingFence = /(\${2,})[ \t]*$/.exec(openingMatch[2]);
        if (sameLineClosingFence && sameLineClosingFence[1].length >= openingMatch[1].length) {
            const closingFenceOffset =
                openingLine.start + openingLine.text.lastIndexOf(sameLineClosingFence[1]);
            if (
                closingFenceOffset > openingFenceOffset + openingMatch[1].length &&
                isTextOffset(closingFenceOffset)
            ) {
                insertions.push({
                    offset: openingFenceOffset + openingMatch[1].length,
                    value: insertedLine
                });
                insertions.push({ offset: closingFenceOffset, value: insertedLine });
            }
            continue;
        }

        for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex++) {
            const closingLine = lines[closingIndex];
            const closingMatch = /(\${2,})[ \t]*$/.exec(closingLine.text);
            if (!closingMatch || closingMatch[1].length < openingMatch[1].length) continue;
            const selfContainedMatch = openerPattern.exec(closingLine.text);
            const selfContainedClosing = selfContainedMatch
                ? /(\${2,})[ \t]*$/.exec(selfContainedMatch[2])
                : null;
            if (
                selfContainedMatch &&
                selfContainedClosing &&
                selfContainedClosing[1].length >= selfContainedMatch[1].length
            ) {
                continue;
            }

            const closingFenceOffset = closingLine.start + closingMatch.index;
            if (!isTextOffset(closingFenceOffset)) continue;

            // remark-math drops content attached to a multiline opening fence unless the fence is isolated.
            insertions.push({
                offset: openingFenceOffset + openingMatch[1].length,
                value: insertedLine
            });
            if (closingLine.text.slice(0, closingMatch.index).trim() !== '') {
                insertions.push({ offset: closingFenceOffset, value: insertedLine });
            }
            index = closingIndex;
            break;
        }
    }

    if (insertions.length === 0) return src;

    const uniqueInsertions = [
        ...new Map(insertions.map(insertion => [insertion.offset, insertion])).values()
    ].sort((a, b) => a.offset - b.offset);
    const parts: string[] = [];
    let cursor = 0;
    for (const insertion of uniqueInsertions) {
        parts.push(src.slice(cursor, insertion.offset), insertion.value);
        cursor = insertion.offset;
    }
    parts.push(src.slice(cursor));
    return parts.join('');
}

function parseMarkdown(processor: any, src: string) {
    let protectedSrc = normalizeDisplayMathFences(src);

    while (true) {
        const file = new VFile(protectedSrc);
        file.data.macros = {};
        const tree = processor.parse(file);
        const isTextOffset = createTextOffsetLookup(protectedSrc);
        const fences = findUnclosedMathFences(protectedSrc, tree, isTextOffset);
        if (fences.length === 0) return { file, tree };

        const openers = fences.flatMap(fence => {
            const unclosedOpeners = findFenceOpenersWithoutClosers(
                findStandaloneMathFences(protectedSrc, fence, isTextOffset)
            );
            return unclosedOpeners.length > 0 ? unclosedOpeners : [fence];
        });
        protectedSrc = escapeMathFences(protectedSrc, openers);
    }
}

function rehypeSafeKatex(options?: Readonly<KatexOptions> | null) {
    return (tree: Root, file: VFile) => {
        const macros = (file.data.macros || {}) as NonNullable<KatexOptions['macros']>;
        const transform = rehypeKatex({ ...options, macros });

        visit(tree, 'element', node => {
            node.properties ||= {};
        });
        return transform(tree, file);
    };
}

type ShikiLanguageModule = { default: LanguageInput | LanguageInput[] };
type ShikiLanguageLoader = () => Promise<ShikiLanguageModule>;

const shikiLanguageLoaders = {
    bash: () => import('@shikijs/langs/bash'),
    c: () => import('@shikijs/langs/c'),
    cpp: () => import('@shikijs/langs/cpp'),
    css: () => import('@shikijs/langs/css'),
    go: () => import('@shikijs/langs/go'),
    html: () => import('@shikijs/langs/html'),
    java: () => import('@shikijs/langs/java'),
    javascript: () => import('@shikijs/langs/javascript'),
    json: () => import('@shikijs/langs/json'),
    markdown: () => import('@shikijs/langs/markdown'),
    python: () => import('@shikijs/langs/python'),
    rust: () => import('@shikijs/langs/rust'),
    typescript: () => import('@shikijs/langs/typescript'),
    vue: () => import('@shikijs/langs/vue'),
    yaml: () => import('@shikijs/langs/yaml')
} satisfies Record<string, ShikiLanguageLoader>;

type ShikiLanguage = keyof typeof shikiLanguageLoaders;

const shikiLanguageAliases: Record<string, ShikiLanguage> = {
    bash: 'bash',
    c: 'c',
    'c++': 'cpp',
    cjs: 'javascript',
    cpp: 'cpp',
    'cpp-macro': 'cpp',
    css: 'css',
    cts: 'typescript',
    glsl: 'cpp',
    go: 'go',
    html: 'html',
    'html-derivative': 'vue',
    java: 'java',
    javascript: 'javascript',
    js: 'javascript',
    json: 'json',
    markdown: 'markdown',
    'markdown-vue': 'vue',
    md: 'markdown',
    mjs: 'javascript',
    mts: 'typescript',
    py: 'python',
    python: 'python',
    regex: 'cpp',
    regexp: 'cpp',
    rs: 'rust',
    rust: 'rust',
    sh: 'bash',
    shell: 'bash',
    shellscript: 'bash',
    sql: 'cpp',
    ts: 'typescript',
    typescript: 'typescript',
    vue: 'vue',
    'vue-directives': 'vue',
    'vue-interpolations': 'vue',
    'vue-sfc-style-variable-injection': 'vue',
    yaml: 'yaml',
    yml: 'yaml',
    zsh: 'bash'
};

const shikiSpecialLanguages: Record<string, true> = {
    ansi: true,
    plain: true,
    plaintext: true,
    text: true,
    txt: true
};
const shikiLanguagePromises = new Map<ShikiLanguage, Promise<void>>();

type ShikiTransform = (tree: Root) => void | Promise<void>;

type ShikiRuntime = {
    highlighter: HighlighterCore;
    transform: ShikiTransform;
};

let shikiRuntimePromise: Promise<ShikiRuntime> | null = null;

async function getShikiRuntime() {
    if (!shikiRuntimePromise) {
        shikiRuntimePromise = Promise.all([
            import('@shikijs/core'),
            import('@shikijs/engine-oniguruma'),
            import('@shikijs/rehype/core'),
            import('@shikijs/themes/github-dark'),
            import('@shikijs/themes/github-light')
        ]).then(async ([core, engine, rehypeShikiModule, darkTheme, lightTheme]) => {
            const highlighter = await core.createHighlighterCore({
                engine: engine.createOnigurumaEngine(import('shiki/wasm')),
                langs: [],
                themes: [darkTheme.default, lightTheme.default]
            });
            return {
                highlighter,
                transform: rehypeShikiModule.default(highlighter, {
                    defaultColor: false,
                    themes: { dark: 'github-dark', light: 'github-light' }
                }) as ShikiTransform
            };
        });
    }
    return shikiRuntimePromise;
}

function collectShikiLanguages(tree: Root) {
    const languages = new Set<string>();
    visit(tree, 'element', node => {
        if (node.tagName !== 'code') return;
        const classes = node.properties?.className;
        if (!Array.isArray(classes)) return;
        for (const className of classes) {
            if (typeof className === 'string' && className.startsWith('language-')) {
                languages.add(className.slice('language-'.length).toLowerCase());
            }
        }
    });
    return languages;
}

function loadShikiLanguage(highlighter: HighlighterCore, language: ShikiLanguage) {
    let promise = shikiLanguagePromises.get(language);
    if (!promise) {
        promise = shikiLanguageLoaders[language]().then(module => {
            const registrations = Array.isArray(module.default) ? module.default : [module.default];
            return highlighter.loadLanguage(...registrations);
        });
        shikiLanguagePromises.set(language, promise);
    }
    return promise;
}

function rehypeLazyShiki() {
    return async (tree: Root) => {
        const requestedLanguages = collectShikiLanguages(tree);
        const languages = new Set<ShikiLanguage>();
        let hasSpecialLanguage = false;

        for (const requestedLanguage of requestedLanguages) {
            const language = shikiLanguageAliases[requestedLanguage];
            if (language) languages.add(language);
            else if (shikiSpecialLanguages[requestedLanguage]) hasSpecialLanguage = true;
        }

        if (languages.size === 0 && !hasSpecialLanguage) return tree;

        const runtime = await getShikiRuntime();
        await Promise.all(
            [...languages].map(language => loadShikiLanguage(runtime.highlighter, language))
        );
        await runtime.transform(tree);
    };
}

async function getProcessor() {
    if (processorPromise) return processorPromise;

    processorPromise = (async () => {
        const [rehypeSlugModule, rehypeAutolinkHeadingsModule] = await Promise.all([
            import('rehype-slug'),
            import('rehype-autolink-headings')
        ]);
        const rehypeSlug = rehypeSlugModule.default;
        const rehypeAutolinkHeadings = rehypeAutolinkHeadingsModule.default;
        const schema: Options = {
            ...defaultSchema,
            attributes: {
                ...defaultSchema.attributes,
                '*': ['className'],
                div: [...(defaultSchema.attributes?.div || []), 'style', ['data*']],
                span: [...(defaultSchema.attributes?.span || []), 'className', 'style'],
                input: [...(defaultSchema.attributes?.input || []), 'type', 'checked', 'disabled'],
                pre: ['className', 'style'],
                code: ['className', 'style'],
                th: [
                    ...(defaultSchema.attributes?.th || []),
                    'align',
                    'className',
                    'rowspan',
                    'colspan',
                    'rowSpan',
                    'colSpan'
                ],
                td: [
                    ...(defaultSchema.attributes?.td || []),
                    'align',
                    'className',
                    'rowspan',
                    'colspan',
                    'rowSpan',
                    'colSpan'
                ],
                iframe: [
                    'src',
                    'scrolling',
                    'border',
                    'frameborder',
                    'framespacing',
                    'allowfullscreen',
                    'width',
                    'height',
                    'className',
                    'style'
                ]
            },
            tagNames: [
                ...(defaultSchema.tagNames || []),
                'div',
                'span',
                'i',
                'iframe',
                'video',
                'audio',
                'img',
                'math',
                'mi',
                'mo',
                'mn',
                'msup',
                'msub',
                'mfrac',
                'mtable',
                'mtr',
                'mtd'
            ]
        };

        function remarkCustomContainers() {
            return (tree: any) => {
                const stringifyDirective = (node: any) => {
                    const label =
                        node.children?.map((child: any) => child.value || '').join('') || '';
                    const attributes = Object.entries(node.attributes || {})
                        .map(([key, value]) => (value === true ? key : `${key}="${value}"`))
                        .join(' ');
                    return `:${node.name}${label ? `[${label}]` : ''}${attributes ? `{${attributes}}` : ''}`;
                };
                const extractDirectiveLabel = (node: any) => {
                    const labelNode = node.children?.[0];
                    if (!labelNode?.data?.directiveLabel) return '';
                    const label = labelNode.children
                        ?.map((child: any) => child.value || '')
                        .join('')
                        .trim();
                    node.children = node.children.slice(1);
                    return label || '';
                };
                visit(tree, node => {
                    if (node.type === 'textDirective' || node.type === 'leafDirective') {
                        node.type = 'text';
                        node.value = stringifyDirective(node);
                        delete node.name;
                        delete node.attributes;
                        delete node.children;
                        delete node.data;
                        return;
                    }

                    if (node.type === 'containerDirective') {
                        const data = node.data || (node.data = {});
                        const attributes = node.attributes || {};
                        const name = node.name;

                        if (name === 'align') {
                            const align =
                                attributes.class || Object.keys(attributes)[0] || 'center';
                            data.hName = 'div';
                            data.hProperties = { className: [`md-align-${align}`] };
                        } else if (name === 'epigraph') {
                            const label = extractDirectiveLabel(node);
                            const author = attributes.author || label || '';
                            data.hName = 'div';
                            data.hProperties = {
                                className: ['md-epigraph'],
                                'data-author': author
                            };
                        } else if (['info', 'warning', 'success', 'error'].includes(name)) {
                            const hasLabel = Boolean(
                                !attributes.title && node.children?.[0]?.data?.directiveLabel
                            );
                            const title = attributes.title || (hasLabel ? '' : name.toUpperCase());
                            const open = attributes.open !== undefined;
                            data.hName = 'div';
                            data.hProperties = {
                                className: hasLabel
                                    ? ['md-block', name, 'has-title-children']
                                    : ['md-block', name],
                                'data-title': title,
                                'data-open': open.toString()
                            };
                        }
                    }
                });
            };
        }

        function remarkCuteTable() {
            const addClass = (node: any, classToAdd: string) => {
                node.data ||= {};
                node.data.hProperties ||= {};
                const className = node.data.hProperties.className || [];
                node.data.hProperties.className = Array.isArray(className)
                    ? [...className, classToAdd]
                    : [className, classToAdd].filter(Boolean);
            };

            return (tree: any) => {
                const children = tree.children || [];
                for (let index = 0; index < children.length; index++) {
                    const node = children[index];
                    const next = children[index + 1];
                    if (
                        node?.type !== 'leafDirective' ||
                        node.name !== 'cute-table' ||
                        node.attributes?.tuack === undefined ||
                        next?.type !== 'table'
                    ) {
                        continue;
                    }

                    addClass(next, 'cute-table');
                    children.splice(index, 1);
                    index--;
                }
            };
        }

        function remarkImages() {
            return (tree: any) => {
                visit(tree, 'image', (node: any) => {
                    if (node.url.includes(luoguCaptchaUrlFragment)) {
                        node.type = 'text';
                        node.value = '[LUOGU CAPTCHA]';

                        delete node.url;
                        delete node.alt;
                        delete node.title;
                        return;
                    }

                    if (node.url.startsWith('bilibili:')) {
                        const bilibiliUrl = node.url.substring(9);
                        const [videoID, queryString] = bilibiliUrl.split('?');
                        let bvid = '';
                        let aid = '';

                        if (videoID.startsWith('BV')) {
                            bvid = videoID;
                        } else if (videoID.startsWith('av')) {
                            aid = videoID.substring(2);
                        } else if (/^\d+$/.test(videoID)) {
                            aid = videoID;
                        }

                        const params = new URLSearchParams(queryString || '');
                        const page = params.get('page') || '1';
                        const t = params.get('t') || '0';
                        let iframeURL = 'https://player.bilibili.com/player.html?';
                        if (bvid) {
                            iframeURL += `bvid=${bvid}`;
                        } else if (aid) {
                            iframeURL += `aid=${aid}`;
                        }
                        iframeURL += `&page=${page}`;
                        if (t !== '0') {
                            iframeURL += `&t=${t}`;
                        }

                        iframeURL += '&high_quality=1&autoplay=0';

                        node.type = 'html';
                        node.value = `<div class="bilibili-video-container"><iframe src="${iframeURL}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" width="100%" height="500"></iframe></div>`;

                        delete node.url;
                        delete node.alt;
                        delete node.title;
                    }
                });
            };
        }

        function rehypeCustomContainers() {
            return (tree: any) => {
                visit(tree, 'element', (node: any) => {
                    if (node.properties && node.properties.className) {
                        const classes = node.properties.className;

                        if (classes.includes('md-epigraph')) {
                            const author = node.properties.dataAuthor || '';
                            delete node.properties.dataAuthor;
                            const body = {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['epigraph-body'] },
                                children: node.children
                            };
                            const children = [body];
                            if (author) {
                                children.push({
                                    type: 'element',
                                    tagName: 'span',
                                    properties: { className: ['epigraph-author'] },
                                    children: [{ type: 'text', value: author }]
                                });
                            }
                            node.children = children;
                        }

                        const typeClass = classes.find((className: string) =>
                            ['info', 'warning', 'success', 'error'].includes(className)
                        );
                        if (typeClass && classes.includes('md-block')) {
                            const title = node.properties['dataTitle'] || typeClass.toUpperCase();
                            const useTitleChildren = classes.includes('has-title-children');
                            const open = node.properties['dataOpen'] === 'true';
                            node.properties.className = classes.filter(
                                (className: string) => className !== 'has-title-children'
                            );
                            delete node.properties['dataTitle'];
                            delete node.properties['dataOpen'];

                            const titleChildren = useTitleChildren
                                ? node.children
                                      .splice(0, 1)
                                      .flatMap((child: any) => child.children || [child])
                                : [{ type: 'text', value: title }];

                            const titleNode = {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['md-block-title'] },
                                children: [
                                    {
                                        type: 'element',
                                        tagName: 'span',
                                        children: titleChildren
                                    },
                                    {
                                        type: 'element',
                                        tagName: 'i',
                                        properties: {
                                            className: [
                                                'toggle-btn',
                                                'fa',
                                                `fa-caret-${open ? 'down' : 'right'}`
                                            ]
                                        },
                                        children: []
                                    }
                                ]
                            };
                            const bodyNode = {
                                type: 'element',
                                tagName: 'div',
                                properties: {
                                    className: ['md-block-body'],
                                    style: open ? '' : 'display:none'
                                },
                                children: node.children
                            };
                            node.children = [titleNode, bodyNode];
                        }
                    }
                });
            };
        }

        function remarkTableMergeMarkers() {
            const escapedMarkers: Record<string, string> = {
                '\\^': '^',
                '\\<': '<',
                '\\>': '>',
                '\\v': 'v'
            };
            const getCellText = (cell: any, source: string) => {
                if (!cell?.children || cell.children.length !== 1) return null;
                const child = cell.children[0];
                if (child.type !== 'text') return null;
                const start = child.position?.start?.offset;
                const end = child.position?.end?.offset;
                const raw =
                    typeof start === 'number' && typeof end === 'number'
                        ? source.slice(start, end)
                        : child.value;
                return { child, raw, value: child.value };
            };
            const hasNeighbor = (
                rows: any[][],
                rowIndex: number,
                cellIndex: number,
                marker: string
            ) => {
                switch (marker) {
                    case '^':
                        return rowIndex > 0 && Boolean(rows[rowIndex - 1]?.[cellIndex]);
                    case '<':
                        return cellIndex > 0 && Boolean(rows[rowIndex]?.[cellIndex - 1]);
                    case '>':
                        return Boolean(rows[rowIndex]?.[cellIndex + 1]);
                    case 'v':
                        return (
                            rowIndex < rows.length - 1 && Boolean(rows[rowIndex + 1]?.[cellIndex])
                        );
                    default:
                        return false;
                }
            };
            return (tree: any, file: VFile) => {
                const source = String(file.value || '');
                visit(tree, 'table', (table: any) => {
                    const rows: any[][] = (table.children || []).map(
                        (row: any) => row.children || []
                    );

                    rows.forEach((row, rowIndex) => {
                        row.forEach((cell, cellIndex) => {
                            const text = getCellText(cell, source);
                            if (!text) return;

                            if (escapedMarkers[text.raw]) {
                                text.child.value = escapedMarkers[text.raw];
                                return;
                            }

                            if (
                                text.value !== text.raw ||
                                !hasNeighbor(rows, rowIndex, cellIndex, text.raw)
                            ) {
                                return;
                            }

                            cell.data ||= {};
                            cell.data.hProperties ||= {};
                            cell.data.hProperties['data-merge-marker'] = text.raw;
                        });
                    });
                });
            };
        }

        function rehypeApplyTableMerges() {
            const getMarker = (cell: any) =>
                cell.properties?.dataMergeMarker || cell.properties?.['data-merge-marker'];
            const deleteMarker = (cell: any) => {
                if (!cell.properties) return;
                delete cell.properties.dataMergeMarker;
                delete cell.properties['data-merge-marker'];
            };
            const addClass = (cell: any, classToAdd: string) => {
                cell.properties ||= {};
                const className = cell.properties.className || [];
                const classes = Array.isArray(className) ? className : [className].filter(Boolean);
                if (!classes.includes(classToAdd)) classes.push(classToAdd);
                cell.properties.className = classes;
            };
            const getSpan = (cell: any, property: 'rowSpan' | 'colSpan') =>
                Number(
                    cell.properties?.[property] || cell.properties?.[property.toLowerCase()] || 1
                );
            const setSpan = (cell: any, property: 'rowSpan' | 'colSpan', value: number) => {
                cell.properties ||= {};
                cell.properties[property] = value;
            };
            const copyCell = (source: any, target: any) => {
                target.tagName = source.tagName;
                target.properties = { ...(source.properties || {}) };
                target.children = source.children || [];
                deleteMarker(target);
            };

            return (tree: any) => {
                visit(tree, 'element', (table: any) => {
                    if (table.tagName !== 'table') return;

                    const rowNodes: any[] = [];
                    visit(table, 'element', (row: any) => {
                        if (row.tagName === 'tr') rowNodes.push(row);
                    });
                    const rows = rowNodes.map(row =>
                        (row.children || []).filter(
                            (child: any) =>
                                child.type === 'element' &&
                                (child.tagName === 'td' || child.tagName === 'th')
                        )
                    );
                    const owners: any[][] = rows.map(row => row.map((cell: any) => cell));
                    const removed = new WeakSet<object>();

                    const ownerAt = (rowIndex: number, cellIndex: number) => {
                        const owner = owners[rowIndex]?.[cellIndex];
                        return owner && !removed.has(owner) ? owner : null;
                    };
                    const mergeInto = (
                        markerCell: any,
                        target: any,
                        property: 'rowSpan' | 'colSpan'
                    ) => {
                        addClass(target, 'md-table-merged-cell');
                        setSpan(target, property, getSpan(target, property) + 1);
                        removed.add(markerCell);
                    };

                    rows.forEach((row: any[], rowIndex: number) => {
                        row.forEach((cell: any, cellIndex: number) => {
                            if (removed.has(cell)) return;
                            const marker = getMarker(cell);
                            if (!marker) return;

                            if (marker === '^') {
                                const target = ownerAt(rowIndex - 1, cellIndex);
                                if (target) {
                                    mergeInto(cell, target, 'rowSpan');
                                    owners[rowIndex][cellIndex] = target;
                                }
                            } else if (marker === '<') {
                                const target = ownerAt(rowIndex, cellIndex - 1);
                                if (target) {
                                    mergeInto(cell, target, 'colSpan');
                                    owners[rowIndex][cellIndex] = target;
                                }
                            } else if (marker === '>') {
                                const target = ownerAt(rowIndex, cellIndex + 1);
                                if (target) {
                                    copyCell(target, cell);
                                    addClass(cell, 'md-table-merged-cell');
                                    setSpan(cell, 'colSpan', getSpan(cell, 'colSpan') + 1);
                                    removed.add(target);
                                    owners[rowIndex][cellIndex] = cell;
                                    owners[rowIndex][cellIndex + 1] = cell;
                                }
                            } else if (marker === 'v') {
                                const target = ownerAt(rowIndex + 1, cellIndex);
                                if (target) {
                                    copyCell(target, cell);
                                    addClass(cell, 'md-table-merged-cell');
                                    setSpan(cell, 'rowSpan', getSpan(cell, 'rowSpan') + 1);
                                    removed.add(target);
                                    owners[rowIndex][cellIndex] = cell;
                                    owners[rowIndex + 1][cellIndex] = cell;
                                }
                            }
                        });
                    });

                    rows.flat().forEach(deleteMarker);
                    rowNodes.forEach(row => {
                        row.children = (row.children || []).filter(
                            (child: any) => !(child.type === 'element' && removed.has(child))
                        );
                    });
                });
            };
        }

        return unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkMath)
            .use(remarkSmartypants)
            .use(remarkDirective)
            .use(remarkCuteTable)
            .use(remarkCustomContainers)
            .use(remarkTableMergeMarkers)
            .use(remarkImages)
            .use(remarkRehype, { allowDangerousHtml: true })
            .use(rehypeRaw)
            .use(rehypeApplyTableMerges)
            .use(rehypeSanitize, schema)
            .use(rehypeSlug)
            .use(rehypeAutolinkHeadings, {
                behavior: 'prepend',
                content: headingAnchorIcon,
                properties: {
                    className: ['heading-anchor'],
                    ariaHidden: 'true',
                    tabIndex: -1
                }
            })
            .use(rehypeCustomContainers)
            .use(rehypeSafeKatex, { strict: 'ignore' })
            .use(rehypeLazyShiki)
            .use(rehypeStringify);
    })();

    return processorPromise;
}

export default async function renderMarkdown(src: string) {
    if (!src) return '';

    const processor = await getProcessor();

    try {
        const { file, tree } = parseMarkdown(processor, src);
        const transformedTree = await processor.run(tree, file);
        return replaceUI(processor.stringify(transformedTree, file));
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Render Error';
        return `<p>渲染失败：${msg}</p>`;
    }
}

export { renderMarkdown };

function replaceUI(s: string) {
    return s
        .replace(/<table(\s[^>]*)?>/g, '<div class="table-container"><table$1>')
        .replace(/<\/table>/g, '</table></div>');
}
