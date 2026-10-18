import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/statistic',
        name: 'statistic',
        component: () => import('@/views/statistic/StatisticView.vue'),
        meta: {
            activeMenu: 'statistic',
            title: '统计数据'
        }
    }
] as RouteRecordRaw[];
