import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/article/:id',
        name: 'article-detail',
        component: () => import('@/views/article/ArticleDetailView.vue'),
        meta: {
            activeMenu: '',
            title: '文章'
        }
    }
] as RouteRecordRaw[];
