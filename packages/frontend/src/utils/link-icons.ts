import type { LinkIconGroup } from '@/utils/enhanced-links';

export interface SvgPrimitive {
    tag: 'path' | 'rect' | 'circle';
    attrs: Record<string, string>;
}

export interface LinkIconDef {
    viewBox: string;
    fill?: boolean;
    elements: SvgPrimitive[];
}

export const LINK_ICON_DEFS: Record<LinkIconGroup, LinkIconDef> = {
    luogu: {
        viewBox: '0 0 32 32',
        fill: true,
        elements: [
            {
                tag: 'path',
                attrs: {
                    'fill-rule': 'evenodd',
                    'clip-rule': 'evenodd',
                    d: 'M16.5595 0L16.2797 1.9926L16.2788 2.00192L13.3661 21.0724L32 29.8647L31.2365 31.5774L31.0491 32H0L0.275114 30.0093L0.27696 29.999L4.8679 0H16.5595ZM12.0976 29.3917H24.9043L12.9571 23.7544L12.0976 29.3917ZM2.96071 29.3917H9.5062L10.5402 22.6135L4.43321 19.7338L2.96071 29.3917ZM4.84311 17.0527L10.9501 19.9325L13.5951 2.60828H7.04864L4.84311 17.0527Z'
                }
            }
        ]
    },
    article: {
        viewBox: '0 0 24 24',
        elements: [
            {
                tag: 'path',
                attrs: { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }
            },
            { tag: 'path', attrs: { d: 'M14 2v4a2 2 0 0 0 2 2h4' } },
            { tag: 'path', attrs: { d: 'M10 9H8' } },
            { tag: 'path', attrs: { d: 'M16 13H8' } },
            { tag: 'path', attrs: { d: 'M16 17H8' } }
        ]
    },
    paste: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'rect', attrs: { width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' } },
            {
                tag: 'path',
                attrs: {
                    d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'
                }
            }
        ]
    },
    user: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' } },
            { tag: 'circle', attrs: { cx: '12', cy: '7', r: '4' } }
        ]
    },
    codeforces: {
        viewBox: '0 0 24 24',
        fill: true,
        elements: [
            { tag: 'rect', attrs: { x: '2', y: '10', width: '5', height: '11', rx: '1' } },
            { tag: 'rect', attrs: { x: '9.5', y: '4', width: '5', height: '17', rx: '1' } },
            { tag: 'rect', attrs: { x: '17', y: '8', width: '5', height: '13', rx: '1' } }
        ]
    },
    atcoder: {
        viewBox: '0 0 24 24',
        fill: true,
        elements: [
            {
                tag: 'path',
                attrs: {
                    d: 'M12 3 3 20h3.8l2-4.2h6.4l2 4.2H21L12 3Zm-1.7 9.6L12 9l1.7 3.6h-3.4Z'
                }
            }
        ]
    },
    uoj: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    qoj: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    loj: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    spoj: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    vjudge: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    hydro: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'm18 16 4-4-4-4' } },
            { tag: 'path', attrs: { d: 'm6 8-4 4 4 4' } },
            { tag: 'path', attrs: { d: 'm14.5 4-5 16' } }
        ]
    },
    external: {
        viewBox: '0 0 24 24',
        elements: [
            { tag: 'path', attrs: { d: 'M15 3h6v6' } },
            { tag: 'path', attrs: { d: 'M10 14 21 3' } },
            {
                tag: 'path',
                attrs: { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }
            }
        ]
    }
};
