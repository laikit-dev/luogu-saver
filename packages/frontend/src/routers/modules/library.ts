import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/library',
        name: 'library',
        component: () => import('@/views/library/LibraryView.vue'),
        meta: {
            activeMenu: 'library',
            title: '我的归档'
        }
    }
] as RouteRecordRaw[];
