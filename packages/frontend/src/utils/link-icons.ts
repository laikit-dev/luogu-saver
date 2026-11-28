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
        viewBox: '0 0 24 24',
        fill: true,
        elements: [
            {
                tag: 'path',
                attrs: {
                    d: 'M12.424 0c-.435-.005-.964.138-1.569.65-.967.817-2.554 3.235-3.56 4.38s-2.002 1.65-2.48 2.493c-.477.844-.824 1.598-.385 2.568s2.308 2.592 3.018 3.247.724.566 1.24.68c.517.113 1.38.188 1.857 0 .478-.19.993-.63 1.006-1.133s-.515-1.409-.928-1.887c-.413-.479-1.213-.769-1.549-.983s-.373-.076-.463-.303-.413-.59-.078-1.056c.336-.466 1.38-1.033 2.09-1.738s1.625-1.61 2.167-2.492 1.06-2.064 1.085-2.794C13.901.902 13.603.285 13.1.12a2.2 2.2 0 0 0-.676-.12m-.397 6.936c-.243.008-.443.037-.566.097-.492.24-.48.997-.151 1.515s1.618 1.223 2.124 1.59c.505.366.883.292.908.607.026.316.102.315-.757 1.287-.86.973-3.222 3.371-4.397 4.546-1.175 1.174-1.77 1.503-2.654 2.5S4.259 21.78 3.88 22.563s-.15.997.38 1.212c.531.214 2.11.34 2.804.075.695-.265.822-1.034 1.365-1.666.543-.63.721-.859 1.896-2.122.472-.507 1.242-1.32 1.998-2.118.048.151.126.324.243.525.423.727 1.922 2.219 2.537 3.009s.77 1.33 1.154 1.73c.384.402.55.564 1.152.677.602.112 1.998.188 2.459 0 .461-.189.552-.576.308-1.127-.243-.552-1.346-1.555-1.768-2.182-.423-.627-1.243-2.095-1.845-2.71s-1.025-.776-1.768-.977c-.43-.115-.982-.11-1.444-.034.769-.811 1.564-1.647 2.129-2.246 1.415-1.503 2.88-2.614 3.335-3.56.455-.948-.214-1.492-.606-2.123-.391-.631-1.124-1.363-1.743-1.666-.62-.303-1.151-.1-1.972-.151-.616-.038-1.737-.197-2.467-.173'
                }
            }
        ]
    },
    saver: {
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
            {
                tag: 'rect',
                attrs: { x: '0', y: '7.5', width: '6', height: '13.5', rx: '1.5', fill: '#FFC107' }
            },
            {
                tag: 'rect',
                attrs: { x: '9', y: '3', width: '6', height: '18', rx: '1.5', fill: '#1F8ACB' }
            },
            {
                tag: 'rect',
                attrs: {
                    x: '18',
                    y: '10.5',
                    width: '6',
                    height: '10.5',
                    rx: '1.5',
                    fill: '#D32F2F'
                }
            }
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
