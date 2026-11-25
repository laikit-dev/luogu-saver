import type { Component } from 'vue';
import {
    BrushIcon,
    ChartNoAxesColumnIncreasing,
    Globe2,
    Hammer,
    House,
    Image,
    Key,
    MessagesSquare,
    Search
} from 'lucide-vue-next';

export interface NavLeafItem {
    key: string;
    label: string;
    icon: Component;
    to?: string;
    href?: string;
    external?: boolean;
    shortcut?: string;
    action?: 'paintboard-dialog';
}

export interface NavBranchItem {
    key: string;
    label: string;
    icon: Component;
    children: readonly NavLeafItem[];
}

export type NavItem = NavLeafItem | NavBranchItem;

export interface NavGroup {
    key: string;
    label: string;
    items: readonly NavItem[];
}

export const PAINTBOARD_ANNOUNCEMENT_URL = 'https://www.luogu.com.cn/article/5bfg0f3w';

export const PRIMARY_NAV_GROUPS: readonly NavGroup[] = [
    {
        key: 'browse',
        label: '浏览',
        items: [
            {
                key: 'home',
                label: '首页',
                to: '/',
                icon: House
            },
            {
                key: 'search',
                label: '搜索',
                to: '/search',
                icon: Search,
                shortcut: '/'
            },
            {
                key: 'plaza',
                label: '文章广场',
                to: '/plaza',
                icon: Globe2
            },
            {
                key: 'judgement',
                label: '陶片放逐',
                to: '/judgement',
                icon: Hammer
            },
            {
                key: 'statistic',
                label: '统计数据',
                to: '/statistic',
                icon: ChartNoAxesColumnIncreasing
            }
        ]
    },
    {
        key: 'community',
        label: '社区与活动',
        items: [
            {
                key: 'benben',
                label: '猜猜犇',
                href: 'https://olsi.benben.sbs/ccb',
                external: true,
                icon: MessagesSquare
            },
            {
                key: 'paintboard',
                label: '冬日绘板',
                icon: BrushIcon,
                children: [
                    {
                        key: 'paintboard/view',
                        label: '查看绘板',
                        action: 'paintboard-dialog',
                        icon: Image
                    },
                    {
                        key: 'paintboard/token',
                        label: '申请凭据',
                        href: 'https://ak.luogu.me',
                        external: true,
                        icon: Key
                    }
                ]
            }
        ]
    }
];

export function isNavBranch(item: NavItem): item is NavBranchItem {
    return 'children' in item;
}
