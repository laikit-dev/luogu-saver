import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/rag',
        name: 'rag',
        component: () => import('@/views/rag/RagView.vue'),
        meta: {
            activeMenu: 'rag',
            title: 'RAG 问答'
        }
    }
] as RouteRecordRaw[];
