import type { JudgementItem } from '@/api/judgement.ts';

export function groupJudgementsForCards(items: JudgementItem[]): JudgementItem[][] {
    const groups: JudgementItem[][] = [];
    const byChange = new Map<string, JudgementItem[]>();
    for (const item of items) {
        if (item.hidden) {
            groups.push([item]);
            continue;
        }
        const key = JSON.stringify([item.revoked_permission, item.added_permission, item.reason]);
        const group = byChange.get(key);
        if (group) {
            group.push(item);
        } else {
            const newGroup = [item];
            byChange.set(key, newGroup);
            groups.push(newGroup);
        }
    }
    return groups;
}

export const judgementPermissions: Readonly<Record<number, string>> = {
    1: '登录鉴权',
    2: '进入主站',
    4: '进入后台',
    8: '题目管理',
    16: '团队管理',
    32: '比赛管理',
    64: '秩序管理',
    128: '未知权限 #128',
    256: '用户管理',
    512: '专栏管理',
    32768: '自由发言',
    65536: '发送私信',
    131072: '使用专栏',
    262144: '未知权限 #262144',
    524288: '使用图床',
    2097152: '题库志愿者',
    4194304: '专栏志愿者',
    1073741824: '超级用户'
};

export function getJudgementPermissionNames(value: number): string[] {
    if (!value) return [];
    const names = Object.entries(judgementPermissions)
        .map(([permission, name]) => ({ permission: Number(permission), name }))
        .filter(({ permission }) => (value & permission) === permission)
        .map(({ name }) => name);
    return names.length > 0 ? names : [`未知权限 (${value})`];
}

export interface JudgementDisplayOptions {
    avatar: boolean;
    reason: boolean;
    time: boolean;
    badge: boolean;
    ccf: boolean;
    xcpc: boolean;
    layout?: 'card' | 'table';
}

export const judgementUserColors: Readonly<Record<string, string>> = {
    red: '#FE4C61',
    orange: '#F39C11',
    green: '#52C41A',
    blue: '#3498DB',
    purple: '#9D3DCF',
    gray: '#BFBFBF',
    cheater: '#AD8B00'
};
