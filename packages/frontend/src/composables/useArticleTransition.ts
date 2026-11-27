import { nextTick } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

const PENDING_TITLE_TTL_MS = 2000;
const ARTICLE_ROUTE_RE = /^\/article\/([^/?#]+)/;

const SVG_NS = 'http://www.w3.org/2000/svg';
const OI_PATH =
    'M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z';
const XCPC_PATH =
    'M0 192C0 86 86 0 192 0S384 86 384 192c0 128-160 240-160 240l27.9 41.8c2.7 4 4.1 8.8 4.1 13.6 0 13.6-11 24.6-24.6 24.6l-78.9 0c-13.6 0-24.6-11-24.6-24.6 0-4.8 1.4-9.6 4.1-13.6L160 432S0 320 0 192zm104-16c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24c-66.3 0-120 53.7-120 120 0 13.3 10.7 24 24 24s24-10.7 24-24z';

export interface ArticleCurtainAuthor {
    name?: string;
    color?: string;
    ccfLevel?: number;
    xcpcLevel?: number;
    badge?: string | null;
}

export interface ArticleCurtainMeta {
    title?: string;
    author?: ArticleCurtainAuthor | string;
    category?: string;
    updatedAt?: string;
}

interface ContentAreaRect {
    areaLeft: number;
    areaTop: number;
    areaWidth: number;
    areaHeight: number;
}

let pendingTitleState: { articleId: string; title: string; timestamp: number } | null = null;
let handledCurtainArticleId: string | null = null;
let preloadedArticleView: Promise<unknown> | null = null;
let activeCurtainCleanup: (() => void) | null = null;

function normalizeCurtainMeta(meta?: ArticleCurtainMeta | string): ArticleCurtainMeta {
    if (!meta) return {};
    if (typeof meta === 'string') return { title: meta };
    return meta;
}

export function extractArticleIdFromRoute(to: RouteLocationRaw | null | undefined): string | null {
    if (!to) return null;
    const rawPath = typeof to === 'string' ? to : typeof to.path === 'string' ? to.path : '';
    const match = rawPath.match(ARTICLE_ROUTE_RE);
    return match?.[1] ?? null;
}

export function preloadArticleDetailView() {
    if (!preloadedArticleView) {
        preloadedArticleView = import('@/views/article/ArticleDetailView.vue').catch(() => {
            preloadedArticleView = null;
        });
    }
}

export function consumeArticlePendingTitle(articleId: string): string {
    const current = pendingTitleState;
    pendingTitleState = null;
    if (!current || current.articleId !== articleId) return '';
    if (performance.now() - current.timestamp > PENDING_TITLE_TTL_MS) return '';
    return current.title;
}

export function consumeCurtainHandled(articleId: string): boolean {
    const handled = handledCurtainArticleId === articleId;
    handledCurtainArticleId = null;
    return handled;
}

function setPendingTitle(articleId: string, title?: string) {
    const cleaned = title?.trim();
    if (!cleaned) {
        pendingTitleState = null;
        return;
    }
    pendingTitleState = {
        articleId,
        title: cleaned,
        timestamp: performance.now()
    };
}

function prizeLevelColor(level: number): string | null {
    if (level < 3) return null;
    if (level <= 5) return 'var(--ui-prize-green-color)';
    if (level <= 7) return 'var(--ui-prize-blue-color)';
    return 'var(--ui-prize-gold-color)';
}

function createPrizeSvg(viewBox: string, fill: string, pathData: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', fill);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = 'middle';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
}

function createAuthorElement(authorInput?: ArticleCurtainAuthor | string): HTMLElement | null {
    if (!authorInput) return null;
    const author: ArticleCurtainAuthor =
        typeof authorInput === 'string' ? { name: authorInput } : authorInput;
    const cleanedName = author.name?.trim();
    if (!cleanedName) return null;

    const colorClass = author.color && /^[A-Za-z]+$/.test(author.color) ? author.color : 'Gray';
    const container = document.createElement('span');
    container.className = `user-link-container user-${colorClass}`;
    Object.assign(container.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        minWidth: '0',
        maxWidth: '100%'
    });

    const nameEl = document.createElement('span');
    nameEl.textContent = cleanedName;
    Object.assign(nameEl.style, {
        color: 'inherit',
        fontWeight: '600',
        overflowWrap: 'anywhere'
    });
    container.appendChild(nameEl);

    const oiColor = prizeLevelColor(author.ccfLevel ?? 0);
    const xcpcColor = prizeLevelColor(author.xcpcLevel ?? 0);
    if (oiColor || xcpcColor) {
        const badges = document.createElement('span');
        badges.className = 'user-prize-badges';
        Object.assign(badges.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            marginLeft: 'var(--ui-space-1)',
            height: '14px',
            lineHeight: '1',
            verticalAlign: 'middle'
        });
        if (oiColor) badges.appendChild(createPrizeSvg('0 0 16 16', oiColor, OI_PATH));
        if (xcpcColor) badges.appendChild(createPrizeSvg('0 0 384 512', xcpcColor, XCPC_PATH));
        container.appendChild(badges);
    }

    const cleanedBadge = author.badge?.trim();
    if (cleanedBadge) {
        const badgeEl = document.createElement('span');
        badgeEl.textContent = cleanedBadge;
        Object.assign(badgeEl.style, {
            display: 'inline-block',
            overflow: 'hidden',
            color: '#fff',
            fontSize: '12px',
            lineHeight: '18px',
            padding: '0 5px',
            borderRadius: 'var(--ui-tag-radius)',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '120px',
            background: 'var(--luogu-user-color, var(--ui-primary-color))',
            verticalAlign: 'middle'
        });
        container.appendChild(badgeEl);
    }

    return container;
}

function measureContentArea(): ContentAreaRect {
    const sider = document.querySelector<HTMLElement>('.desktop-sider');
    const topbar = document.querySelector<HTMLElement>('.mobile-topbar');
    const areaLeft = sider ? Math.round(sider.getBoundingClientRect().right) : 0;
    const areaTop = topbar ? Math.round(topbar.getBoundingClientRect().bottom) : 0;
    return {
        areaLeft,
        areaTop,
        areaWidth: Math.max(1, window.innerWidth - areaLeft),
        areaHeight: Math.max(1, window.innerHeight - areaTop)
    };
}

function createCurtainDom(area: ContentAreaRect, metaInput?: ArticleCurtainMeta | string) {
    const meta = normalizeCurtainMeta(metaInput);

    const curtain = document.createElement('div');
    curtain.className = 'article-expand-curtain';
    Object.assign(curtain.style, {
        position: 'fixed',
        left: `${area.areaLeft}px`,
        top: `${area.areaTop}px`,
        width: `${area.areaWidth}px`,
        height: `${area.areaHeight}px`,
        transformOrigin: 'top left',
        backgroundColor: 'var(--ui-body-color)',
        backgroundImage:
            'linear-gradient(135deg, var(--ui-body-gradient-start), var(--ui-body-gradient-end))',
        zIndex: '1090',
        pointerEvents: 'auto',
        contain: 'strict',
        willChange: 'transform, opacity'
    });

    const caption = document.createElement('div');
    caption.className = 'article-expand-curtain-caption';
    Object.assign(caption.style, {
        position: 'fixed',
        left: `${area.areaLeft}px`,
        top: `${area.areaTop}px`,
        width: `${area.areaWidth}px`,
        height: `${area.areaHeight}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '32px',
        boxSizing: 'border-box',
        zIndex: '1091',
        pointerEvents: 'none',
        contain: 'layout style',
        willChange: 'transform, opacity'
    });

    const cleanedCategory = meta.category?.trim();
    if (cleanedCategory) {
        const eyebrow = document.createElement('div');
        eyebrow.textContent = cleanedCategory;
        Object.assign(eyebrow.style, {
            fontSize: '12px',
            fontWeight: '600',
            lineHeight: '1.4',
            color: 'var(--ui-primary-color)',
            padding: '2px 10px',
            borderRadius: 'var(--ui-tag-radius)',
            background: 'color-mix(in srgb, var(--ui-primary-color) 10%, transparent)'
        });
        caption.appendChild(eyebrow);
    }

    const cleanedTitle = meta.title?.trim();
    if (cleanedTitle) {
        const titleNode = document.createElement('div');
        titleNode.textContent = cleanedTitle;
        Object.assign(titleNode.style, {
            fontFamily: 'var(--ui-font-family-display)',
            fontSize: 'clamp(20px, 2.4vw, 26px)',
            fontWeight: '700',
            lineHeight: '1.35',
            letterSpacing: '-0.015em',
            color: 'var(--ui-card-title-color)',
            maxWidth: 'min(680px, 88%)',
            textAlign: 'center',
            display: '-webkit-box',
            webkitBoxOrient: 'vertical',
            webkitLineClamp: '2',
            overflow: 'hidden',
            overflowWrap: 'anywhere'
        });
        caption.appendChild(titleNode);
    }

    const authorNode = createAuthorElement(meta.author);
    const cleanedUpdatedAt = meta.updatedAt?.trim();
    if (authorNode || cleanedUpdatedAt) {
        const metaRow = document.createElement('div');
        Object.assign(metaRow.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            maxWidth: 'min(680px, 88%)',
            fontSize: '13px',
            lineHeight: '1.5',
            color: 'var(--ui-secondary-text-color)',
            textAlign: 'center'
        });
        if (authorNode) {
            metaRow.appendChild(authorNode);
        }
        if (authorNode && cleanedUpdatedAt) {
            const sep = document.createElement('span');
            sep.textContent = '·';
            sep.style.color = 'var(--ui-muted-text-color)';
            metaRow.appendChild(sep);
        }
        if (cleanedUpdatedAt) {
            const timeEl = document.createElement('span');
            timeEl.textContent = cleanedUpdatedAt;
            metaRow.appendChild(timeEl);
        }
        caption.appendChild(metaRow);
    }

    const barTrack = document.createElement('div');
    Object.assign(barTrack.style, {
        width: '96px',
        height: '2px',
        marginTop: '2px',
        borderRadius: '999px',
        background: 'color-mix(in srgb, var(--ui-primary-color) 20%, transparent)',
        overflow: 'hidden'
    });
    const barFill = document.createElement('div');
    Object.assign(barFill.style, {
        width: '100%',
        height: '100%',
        background: 'var(--ui-primary-color)',
        transformOrigin: 'left center',
        willChange: 'transform'
    });
    barTrack.appendChild(barFill);
    caption.appendChild(barTrack);

    document.body.appendChild(curtain);
    document.body.appendChild(caption);

    return { curtain, caption, barFill };
}

export async function navigateWithArticleCurtain(
    router: Router,
    to: RouteLocationRaw,
    cardEl: HTMLElement | null,
    metaInput: ArticleCurtainMeta | string | undefined,
    reducedMotion: boolean
): Promise<void> {
    const articleId = extractArticleIdFromRoute(to);
    if (!articleId) {
        await router.push(to);
        return;
    }

    const meta = normalizeCurtainMeta(metaInput);
    setPendingTitle(articleId, meta.title);

    if (
        reducedMotion ||
        !cardEl ||
        typeof document === 'undefined' ||
        typeof cardEl.animate !== 'function'
    ) {
        await router.push(to);
        return;
    }

    const srcRect = cardEl.getBoundingClientRect();
    if (srcRect.width <= 0 || srcRect.height <= 0) {
        await router.push(to);
        return;
    }

    activeCurtainCleanup?.();
    preloadArticleDetailView();
    handledCurtainArticleId = articleId;

    const area = measureContentArea();
    const dx = srcRect.left - area.areaLeft;
    const dy = srcRect.top - area.areaTop;
    const sx = srcRect.width / area.areaWidth;
    const sy = srcRect.height / area.areaHeight;

    const { curtain, caption, barFill } = createCurtainDom(area, meta);

    let cancelled = false;
    let settleTimer: number | null = null;
    const animations: Animation[] = [];

    const cleanup = () => {
        if (cancelled) return;
        cancelled = true;
        if (settleTimer !== null) {
            window.clearTimeout(settleTimer);
            settleTimer = null;
        }
        for (const anim of animations) {
            try {
                anim.cancel();
            } catch {
                // Ignore already-finished animations
            }
        }
        curtain.remove();
        caption.remove();
        if (handledCurtainArticleId === articleId) {
            handledCurtainArticleId = null;
        }
        if (activeCurtainCleanup === cleanup) {
            activeCurtainCleanup = null;
        }
    };
    activeCurtainCleanup = cleanup;

    try {
        // Phase 1: expand the theme canvas from card bounds while fading in the unscaled caption.
        const expandAnim = curtain.animate(
            [
                {
                    transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
                    opacity: 0.92
                },
                {
                    transform: 'translate3d(0, 0, 0) scale(1, 1)',
                    opacity: 1
                }
            ],
            {
                duration: 220,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'forwards'
            }
        );
        const captionInAnim = caption.animate(
            [
                { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
                { opacity: 1, transform: 'translate3d(0, 0, 0)' }
            ],
            {
                duration: 180,
                delay: 50,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'both'
            }
        );
        const barAnim = barFill.animate(
            [{ transform: 'scaleX(0.12)' }, { transform: 'scaleX(0.92)' }],
            {
                duration: 320,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards'
            }
        );
        animations.push(expandAnim, captionInAnim, barAnim);

        try {
            await expandAnim.finished;
        } catch {
            if (cancelled) return;
        }

        if (cancelled) return;

        // Phase 2: switch route and let the title + loading skeleton mount/paint behind the curtain.
        await router.push(to);
        await nextTick();
        const scrollEl = document.querySelector<HTMLElement>('.page-scroll-container');
        if (scrollEl && !router.currentRoute.value.hash) {
            scrollEl.scrollTop = 0;
        }

        await new Promise<void>(resolve => {
            settleTimer = window.setTimeout(() => {
                settleTimer = null;
                resolve();
            }, 90);
        });

        if (cancelled) return;

        // Phase 3: release pointer events and fade out both curtain and caption cleanly.
        curtain.style.pointerEvents = 'none';
        const curtainOutAnim = curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 180,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards'
        });
        const captionOutAnim = caption.animate(
            [
                { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                { opacity: 0, transform: 'translate3d(0, -4px, 0)' }
            ],
            {
                duration: 180,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards'
            }
        );
        animations.push(curtainOutAnim, captionOutAnim);

        try {
            await Promise.all([curtainOutAnim.finished, captionOutAnim.finished]);
        } catch {
            // Fall through to cleanup
        }
    } finally {
        cleanup();
    }
}

export function playArticleRevealCurtain(metaInput?: ArticleCurtainMeta | string): () => void {
    if (typeof document === 'undefined' || typeof document.body?.animate !== 'function') {
        return () => {};
    }

    activeCurtainCleanup?.();

    const meta = normalizeCurtainMeta(metaInput);
    const area = measureContentArea();
    const { curtain, caption, barFill } = createCurtainDom(
        area,
        meta.title ? meta : { ...meta, title: '正在加载文章' }
    );
    curtain.style.pointerEvents = 'none';

    let cancelled = false;
    let settleTimer: number | null = null;
    const animations: Animation[] = [];

    const cleanup = () => {
        if (cancelled) return;
        cancelled = true;
        if (settleTimer !== null) {
            window.clearTimeout(settleTimer);
            settleTimer = null;
        }
        for (const anim of animations) {
            try {
                anim.cancel();
            } catch {
                // Ignore already-finished animations
            }
        }
        curtain.remove();
        caption.remove();
        if (activeCurtainCleanup === cleanup) {
            activeCurtainCleanup = null;
        }
    };
    activeCurtainCleanup = cleanup;

    const captionInAnim = caption.animate(
        [
            { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ],
        {
            duration: 140,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both'
        }
    );
    const barAnim = barFill.animate(
        [{ transform: 'scaleX(0.15)' }, { transform: 'scaleX(0.92)' }],
        {
            duration: 260,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards'
        }
    );
    animations.push(captionInAnim, barAnim);

    settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (cancelled) return;

        const curtainOutAnim = curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 200,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards'
        });
        const captionOutAnim = caption.animate(
            [
                { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                { opacity: 0, transform: 'translate3d(0, -4px, 0)' }
            ],
            {
                duration: 200,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards'
            }
        );
        animations.push(curtainOutAnim, captionOutAnim);

        void Promise.all([curtainOutAnim.finished, captionOutAnim.finished])
            .then(() => cleanup())
            .catch(() => cleanup());
    }, 130);

    return cleanup;
}
