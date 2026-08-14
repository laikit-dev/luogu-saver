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
