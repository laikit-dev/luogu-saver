import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/discovery/user-articles',
        name: 'user-article-discovery',
        component: () => import('@/views/discovery/UserArticleDiscoveryView.vue'),
        meta: {
            activeMenu: 'discovery/user-articles',
            title: '用户文章爬取'
        }
    }
] as RouteRecordRaw[];
