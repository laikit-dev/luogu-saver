import { nextTick } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

const PENDING_TITLE_TTL_MS = 2000;
const ARTICLE_ROUTE_RE = /^\/article\/([^/?#]+)/;

export interface ArticleCurtainMeta {
    title?: string;
    author?: string;
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

    const metaParts = [meta.author?.trim(), meta.updatedAt?.trim()].filter((part): part is string =>
        Boolean(part)
    );
    if (metaParts.length > 0) {
        const metaRow = document.createElement('div');
        metaRow.textContent = metaParts.join(' · ');
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
