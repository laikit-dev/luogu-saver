import { ARTICLE_CATEGORIES, UNKNOWN_CATEGORY } from '@/utils/constants';
import type { TocItem } from '@/types/article';

const getCategory = (id?: number) => (id && ARTICLE_CATEGORIES[id]) || UNKNOWN_CATEGORY;

export const getCategoryLabel = (id?: number) => getCategory(id).label;

export const getCategoryColor = (id?: number) => getCategory(id).color;

export const getTagStyle = (color: string) => ({
    '--n-color': `color-mix(in srgb, ${color} 20%, transparent)`,
    '--n-text-color': color,
    '--n-border': `1px solid ${color}`,
    '--article-tag-color': color,
    '--article-tag-background-color': `color-mix(in srgb, ${color} 20%, transparent)`
});

export const getCategoryTagStyle = (id?: number) => getTagStyle(getCategoryColor(id));

export const getCategoryIcon = (id?: number) => getCategory(id).icon;

export const getHeadingTitle = (header: Element) => {
    const title = header.cloneNode(true) as HTMLElement;
    title.querySelectorAll('.katex-mathml').forEach(element => element.remove());
    return title.textContent?.trim() || '';
};

export const extractTocFromElement = (container: ParentNode | null): TocItem[] => {
    if (!container) return [];

    const headers = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const toc: TocItem[] = [];
    const stack: { level: number; item: TocItem }[] = [];

    headers.forEach((header, index) => {
        const level = parseInt(header.tagName.substring(1), 10);
        const title = getHeadingTitle(header);

        let id = header.getAttribute('id');

        if (!id) {
            id = `toc-heading-${index}`;
            header.setAttribute('id', id);
        }

        const item: TocItem = { title, href: `#${id}`, children: [] };

        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
            stack.pop();
        }

        if (stack.length === 0) {
            toc.push(item);
        } else {
            const parent = stack[stack.length - 1]!.item;
            if (!parent.children) parent.children = [];
            parent.children.push(item);
        }

        stack.push({ level, item });
    });

    return toc;
};

/**
 * Linear-time pre-scan to predict whether rendered Markdown will produce TOC headings,
 * ignoring `#` lines inside fenced code blocks so the TOC rail can reserve space without CLS.
 */
export function hasMarkdownHeadings(markdown: string): boolean {
    if (!markdown) return false;
    const lines = markdown.split(/\r?\n/);
    let fenceChar = '';
    let fenceLen = 0;
    let prevContentLine = false;

    for (const rawLine of lines) {
        const trimmedStart = rawLine.replace(/^[ \t]{0,3}/, '');
        const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmedStart);
        if (fenceMatch) {
            const marker = fenceMatch[1]!;
            if (!fenceChar) {
                fenceChar = marker[0]!;
                fenceLen = marker.length;
                prevContentLine = false;
                continue;
            }
            if (
                marker[0] === fenceChar &&
                marker.length >= fenceLen &&
                /^[ \t]*$/.test(trimmedStart.slice(marker.length))
            ) {
                fenceChar = '';
                fenceLen = 0;
                prevContentLine = false;
                continue;
            }
        }
        if (fenceChar) continue;

        if (/^#{1,6}(?:[ \t]+|$)/.test(trimmedStart)) return true;
        if (prevContentLine && /^(?:={2,}|-{2,})[ \t]*$/.test(trimmedStart)) return true;
        if (/<h[1-6](?:\s|>)/i.test(trimmedStart)) return true;

        prevContentLine = trimmedStart.length > 0;
    }

    return false;
}
