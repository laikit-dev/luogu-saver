import type { ResolvedLinkArticle, ResolvedLinkPaste, ResolvedLinkUser } from '@/api/links';
import {
    isBareUrlText,
    parseEnhancedLink,
    shouldAppendAnnotation,
    type LinkIconGroup,
    type ParsedEnhancedLink
} from '@/utils/enhanced-links';
import { LINK_ICON_DEFS } from '@/utils/link-icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

const OI_PATH =
    'M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z';

const XCPC_PATH =
    'M0 192C0 86 86 0 192 0S384 86 384 192c0 128-160 240-160 240l27.9 41.8c2.7 4 4.1 8.8 4.1 13.6 0 13.6-11 24.6-24.6 24.6l-78.9 0c-13.6 0-24.6-11-24.6-24.6 0-4.8 1.4-9.6 4.1-13.6L160 432S0 320 0 192zm104-16c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24c-66.3 0-120 53.7-120 120 0 13.3 10.7 24 24 24s24-10.7 24-24z';

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

function createLinkIconSpan(group: LinkIconGroup): HTMLSpanElement {
    const def = LINK_ICON_DEFS[group];
    const span = document.createElement('span');
    span.className = `lgs-link-icon lgs-link-icon--${group}`;
    span.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', def.viewBox);
    if (def.fill) {
        svg.setAttribute('fill', 'currentColor');
    } else {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    }

    for (const el of def.elements) {
        const child = document.createElementNS(SVG_NS, el.tag);
        for (const [k, v] of Object.entries(el.attrs)) {
            child.setAttribute(k, v);
        }
        svg.appendChild(child);
    }

    span.appendChild(svg);
    return span;
}

function buildUserIdentitySpan(user: ResolvedLinkUser, labelOverride?: string): HTMLSpanElement {
    const colorClass = VALID_USER_COLORS.has(user.color) ? user.color : 'Gray';
    const wrapper = document.createElement('span');
    wrapper.className = `lgs-link-user-inline user-${colorClass}`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'lgs-link-user-name';
    nameSpan.textContent = labelOverride || user.name || '未知用户';
    wrapper.appendChild(nameSpan);

    const oiColor = prizeLevelColor(user.ccfLevel ?? 0);
    if (oiColor) {
        wrapper.appendChild(
            createPrizeSvg('0 0 16 16', OI_PATH, oiColor, `OI 等级 ${user.ccfLevel}`)
        );
    }
    const xcpcColor = prizeLevelColor(user.xcpcLevel ?? 0);
    if (xcpcColor) {
        wrapper.appendChild(
            createPrizeSvg('0 0 384 512', XCPC_PATH, xcpcColor, `ICPC/CCPC 等级 ${user.xcpcLevel}`)
        );
    }
    if (user.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'lgs-link-user-badge';
        badgeSpan.textContent = user.badge;
        badgeSpan.title = user.badge;
        wrapper.appendChild(badgeSpan);
    }

    return wrapper;
}

function appendOrUpdateMeta(anchor: HTMLAnchorElement, text: string): void {
    let meta = anchor.querySelector<HTMLSpanElement>(':scope > .lgs-link-meta');
    if (!meta) {
        meta = document.createElement('span');
        meta.className = 'lgs-link-meta';
        anchor.appendChild(meta);
    }
    meta.textContent = text;
}

export interface PendingMarkdownLink {
    anchor: HTMLAnchorElement;
    rawHref: string;
    originalText: string;
    hasImage: boolean;
    parsed: ParsedEnhancedLink;
    bareUrl: boolean;
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
        const bareUrl = !hasImage && isBareUrlText(originalText, rawHref);

        anchor.setAttribute('href', parsed.canonicalHref);
        const isLuoguContentPrompt =
            parsed.source === 'luogu' &&
            (parsed.kind === 'article' || parsed.kind === 'paste') &&
            Boolean(parsed.inSitePath);

        if (isLuoguContentPrompt && parsed.inSitePath) {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
            anchor.setAttribute('data-lgs-route', parsed.inSitePath);
            anchor.dataset.lgsLuoguPrompt = parsed.kind;
            anchor.dataset.lgsId = parsed.id;
            anchor.dataset.lgsExternalHref = parsed.externalHref || parsed.canonicalHref;
        } else if (parsed.inSitePath) {
            anchor.setAttribute('data-lgs-route', parsed.inSitePath);
            anchor.removeAttribute('target');
            anchor.removeAttribute('rel');
        } else {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
        }

        if (!hasImage) {
            anchor.classList.add('lgs-link');
            const iconSpan = createLinkIconSpan(parsed.iconGroup);

            if (parsed.parsedLabel) {
                if (bareUrl) {
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'lgs-link-text';
                    labelSpan.textContent = parsed.parsedLabel;
                    anchor.replaceChildren(iconSpan, labelSpan);
                } else {
                    anchor.prepend(iconSpan);
                    if (
                        shouldAppendAnnotation(originalText, parsed.parsedLabel, parsed.matchToken)
                    ) {
                        appendOrUpdateMeta(anchor, `· ${parsed.parsedLabel}`);
                    }
                }
            } else {
                anchor.prepend(iconSpan);
            }

            if (!anchor.title) {
                if (isLuoguContentPrompt) {
                    anchor.title = parsed.canonicalHref;
                } else if (parsed.inSitePath) {
                    anchor.title = '站内打开';
                }
            }
        }

        items.push({ anchor, rawHref, originalText, hasImage, parsed, bareUrl });
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
    const { anchor, originalText, hasImage, bareUrl } = item;
    anchor.title = `${user.name} (UID ${user.id})`;
    if (hasImage) return;

    const trimmedOrig = originalText.trim();
    const matchesUserName =
        trimmedOrig.length > 0 &&
        trimmedOrig.replace(/^@/, '').toLowerCase() === user.name.toLowerCase();

    if (bareUrl) {
        anchor.replaceChildren(buildUserIdentitySpan(user));
    } else if (matchesUserName) {
        anchor.replaceChildren(buildUserIdentitySpan(user, trimmedOrig));
    } else {
        const sep = document.createElement('span');
        sep.className = 'lgs-link-user-sep';
        sep.textContent = '·';
        anchor.append(sep, buildUserIdentitySpan(user));
    }
}

export function applyResolvedArticleLink(
    item: PendingMarkdownLink,
    article: ResolvedLinkArticle
): void {
    const { anchor, originalText, hasImage, bareUrl } = item;
    anchor.title = article.authorName ? `${article.title} · ${article.authorName}` : article.title;
    if (article.title) {
        anchor.dataset.lgsResolvedTitle = article.title;
    }
    if (hasImage || !article.title) return;

    if (bareUrl) {
        const iconSpan = createLinkIconSpan(item.parsed.iconGroup);
        const labelSpan = document.createElement('span');
        labelSpan.className = 'lgs-link-text';
        labelSpan.textContent = article.title;
        anchor.replaceChildren(iconSpan, labelSpan);
    } else if (shouldAppendAnnotation(originalText, article.title)) {
        appendOrUpdateMeta(anchor, `· 《${article.title}》`);
    }
}

export function applyResolvedPasteLink(item: PendingMarkdownLink, paste: ResolvedLinkPaste): void {
    const { anchor, originalText, hasImage, bareUrl } = item;
    const resolvedLabel = paste.authorName ? `${paste.authorName} 的剪贴板` : `剪贴板 ${paste.id}`;
    anchor.title = paste.preview
        ? `[剪贴板 ${paste.id}] ${paste.authorName ? paste.authorName + ': ' : ''}${paste.preview}`
        : resolvedLabel;
    anchor.dataset.lgsResolvedTitle = resolvedLabel;
    if (hasImage) return;

    if (bareUrl) {
        const iconSpan = createLinkIconSpan(item.parsed.iconGroup);
        const labelSpan = document.createElement('span');
        labelSpan.className = 'lgs-link-text';
        labelSpan.textContent = resolvedLabel;
        anchor.replaceChildren(iconSpan, labelSpan);
    } else if (shouldAppendAnnotation(originalText, resolvedLabel, paste.id)) {
        appendOrUpdateMeta(anchor, `· ${resolvedLabel}`);
    }
}
