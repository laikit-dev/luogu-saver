import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/judgement',
        name: 'judgement',
        component: () => import('@/views/judgement/JudgementView.vue'),
        meta: {
            activeMenu: 'judgement',
            title: '陶片放逐'
        }
    }
] as RouteRecordRaw[];
