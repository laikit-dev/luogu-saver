import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/admin',
        component: () => import('@/views/admin/AdminView.vue'),
        meta: {
            activeMenu: 'admin',
            title: '管理后台'
        },
        children: [
            {
                path: '',
                name: 'admin',
                component: () => import('@/views/admin/panels/AdminOverviewPanel.vue'),
                meta: { activeMenu: 'admin', title: '管理后台' }
            },
            {
                path: 'review',
                name: 'admin-review',
                component: () => import('@/views/admin/panels/AdminReviewPanel.vue'),
                meta: { activeMenu: 'admin', title: '内容审核' }
            },
            {
                path: 'judgements',
                name: 'admin-judgements',
                component: () => import('@/views/admin/panels/AdminJudgementPanel.vue'),
                meta: { activeMenu: 'admin', title: '陶片管理' }
            },
            {
                path: 'site',
                name: 'admin-site',
                component: () => import('@/views/admin/panels/AdminSitePanel.vue'),
                meta: { activeMenu: 'admin', title: '公告与通知' }
            },
            {
                path: 'users',
                name: 'admin-users',
                component: () => import('@/views/admin/panels/AdminUsersPanel.vue'),
                meta: { activeMenu: 'admin', title: '用户管理' }
            },
            {
                path: 'ops',
                name: 'admin-ops',
                component: () => import('@/views/admin/panels/AdminOpsPanel.vue'),
                meta: { activeMenu: 'admin', title: '系统运维' }
            }
        ]
    }
] as RouteRecordRaw[];
