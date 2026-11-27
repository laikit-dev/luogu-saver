import type { ResolvedLinkArticle, ResolvedLinkPaste, ResolvedLinkUser } from '@/api/links';
import {
    isBareOrIdLinkText,
    parseEnhancedLink,
    type EnhancedLinkKind,
    type ParsedEnhancedLink
} from '@/utils/enhanced-links';

const SVG_NS = 'http://www.w3.org/2000/svg';

const OI_PATH =
    'M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z';

const XCPC_PATH =
    'M0 192C0 86 86 0 192 0S384 86 384 192c0 128-160 240-160 240l27.9 41.8c2.7 4 4.1 8.8 4.1 13.6 0 13.6-11 24.6-24.6 24.6l-78.9 0c-13.6 0-24.6-11-24.6-24.6 0-4.8 1.4-9.6 4.1-13.6L160 432S0 320 0 192zm104-16c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24c-66.3 0-120 53.7-120 120 0 13.3 10.7 24 24 24s24-10.7 24-24z';

const CHIP_ICON_INNER: Record<EnhancedLinkKind, string> = {
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    article:
        '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    paste: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    problem: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    training:
        '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    contest:
        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    discuss: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    record: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'
};

const VALID_USER_COLORS = new Set(['Red', 'Orange', 'Purple', 'Green', 'Blue', 'Gray', 'Cheater']);

function prizeLevelColor(level: number): string | null {
    if (level < 3) return null;
    if (level <= 5) return 'var(--ui-prize-green-color)';
    if (level <= 7) return 'var(--ui-prize-blue-color)';
    return 'var(--ui-prize-gold-color)';
}

function createPrizeSvg(
    viewBox: string,
    pathData: string,
    fill: string,
    label: string
): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'lgs-link-prize-icon');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', fill);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    svg.appendChild(title);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
}

function createChipIconSpan(kind: EnhancedLinkKind): HTMLSpanElement {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'lgs-link-chip-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CHIP_ICON_INNER[kind]}</svg>`;
    return iconSpan;
}

function clearChipAndUserClasses(el: HTMLElement): void {
    const toRemove = [...el.classList].filter(
        c =>
            c === 'lgs-link-user' ||
            c.startsWith('user-') ||
            c === 'lgs-link-chip' ||
            c.startsWith('lgs-link-chip--')
    );
    for (const c of toRemove) el.classList.remove(c);
}

export interface PendingMarkdownLink {
    anchor: HTMLAnchorElement;
    rawHref: string;
    originalText: string;
    hasImage: boolean;
    parsed: ParsedEnhancedLink;
    replaceText: boolean;
}

export function scanAndApplyInitialLinkEnhancements(container: HTMLElement): {
    items: PendingMarkdownLink[];
    userIds: number[];
    articleIds: string[];
    pasteIds: string[];
} {
    const items: PendingMarkdownLink[] = [];
    const userIds = new Set<number>();
    const articleIds = new Set<string>();
    const pasteIds = new Set<string>();

    container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
        if (anchor.classList.contains('heading-anchor')) return;
        if (anchor.dataset.lgsEnhanced === '1') return;

        const rawHref = anchor.getAttribute('href') || '';
        const parsed = parseEnhancedLink(rawHref);
        if (!parsed) return;

        anchor.dataset.lgsEnhanced = '1';
        const originalText = anchor.textContent ?? '';
        const hasImage = anchor.querySelector('img') !== null;
        const replaceText = !hasImage && isBareOrIdLinkText(originalText, rawHref, parsed);

        anchor.setAttribute('href', parsed.canonicalHref);
        if (parsed.inSitePath) {
            anchor.setAttribute('data-lgs-route', parsed.inSitePath);
            anchor.removeAttribute('target');
            anchor.removeAttribute('rel');
        } else {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
        }

        if (!hasImage) {
            const displayLabel = replaceText ? parsed.defaultLabel : originalText.trim();
            clearChipAndUserClasses(anchor);
            anchor.classList.add('lgs-link-chip', `lgs-link-chip--${parsed.kind}`);
            const labelSpan = document.createElement('span');
            labelSpan.className = 'lgs-link-chip-label';
            labelSpan.textContent = displayLabel;
            anchor.replaceChildren(createChipIconSpan(parsed.kind), labelSpan);
            if (!anchor.title) {
                anchor.title = parsed.inSitePath
                    ? `${parsed.defaultLabel}（站内打开）`
                    : parsed.canonicalHref;
            }
        }

        items.push({ anchor, rawHref, originalText, hasImage, parsed, replaceText });
        if (parsed.kind === 'user' && parsed.numericId) userIds.add(parsed.numericId);
        else if (parsed.kind === 'article') articleIds.add(parsed.id);
        else if (parsed.kind === 'paste') pasteIds.add(parsed.id);
    });

    return {
        items,
        userIds: [...userIds],
        articleIds: [...articleIds],
        pasteIds: [...pasteIds]
    };
}

export function applyResolvedUserLink(item: PendingMarkdownLink, user: ResolvedLinkUser): void {
    const { anchor, originalText, hasImage, replaceText } = item;
    anchor.title = `${user.name} (UID ${user.id})`;
    if (hasImage) return;

    clearChipAndUserClasses(anchor);
    const colorClass = VALID_USER_COLORS.has(user.color) ? user.color : 'Gray';
    anchor.classList.add('lgs-link-user', `user-${colorClass}`);

    const trimmedOrig = originalText.trim();
    const useUserName = replaceText || trimmedOrig.startsWith('@');
    const displayName = useUserName ? user.name : trimmedOrig;

    const nodes: Node[] = [];
    const nameSpan = document.createElement('span');
    nameSpan.className = 'lgs-link-user-name';
    nameSpan.textContent = displayName || '未知用户';
    nodes.push(nameSpan);

    const oiColor = prizeLevelColor(user.ccfLevel ?? 0);
    if (oiColor) {
        nodes.push(createPrizeSvg('0 0 16 16', OI_PATH, oiColor, `OI 等级 ${user.ccfLevel}`));
    }
    const xcpcColor = prizeLevelColor(user.xcpcLevel ?? 0);
    if (xcpcColor) {
        nodes.push(
            createPrizeSvg('0 0 384 512', XCPC_PATH, xcpcColor, `ICPC/CCPC 等级 ${user.xcpcLevel}`)
        );
    }
    if (user.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'lgs-link-user-badge';
        badgeSpan.textContent = user.badge;
        badgeSpan.title = user.badge;
        nodes.push(badgeSpan);
    }

    anchor.replaceChildren(...nodes);
}

export function applyResolvedArticleLink(
    item: PendingMarkdownLink,
    article: ResolvedLinkArticle
): void {
    const { anchor, hasImage, replaceText } = item;
    anchor.title = article.authorName ? `${article.title} · ${article.authorName}` : article.title;
    if (hasImage) return;

    if (replaceText && article.title) {
        const labelSpan = anchor.querySelector('.lgs-link-chip-label');
        if (labelSpan) labelSpan.textContent = article.title;
    }
}

export function applyResolvedPasteLink(item: PendingMarkdownLink, paste: ResolvedLinkPaste): void {
    const { anchor, hasImage, replaceText } = item;
    const meta = paste.authorName ? `${paste.authorName}` : `剪贴板 ${paste.id}`;
    anchor.title = paste.preview ? `[剪贴板 ${paste.id}] ${meta}: ${paste.preview}` : meta;
    if (hasImage) return;

    if (replaceText) {
        const labelSpan = anchor.querySelector('.lgs-link-chip-label');
        if (labelSpan) {
            labelSpan.textContent = paste.authorName
                ? `${paste.authorName} 的剪贴板 (${paste.id})`
                : `剪贴板 ${paste.id}`;
        }
    }
}
