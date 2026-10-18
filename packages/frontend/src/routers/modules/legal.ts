import type { RouteRecordRaw } from 'vue-router';

export default [
    {
        path: '/privacy',
        name: 'privacy',
        component: () => import('@/views/legal/LegalView.vue'),
        props: { docKey: 'privacy' },
        meta: {
            activeMenu: '',
            title: '隐私协议'
        }
    },
    {
        path: '/disclaimer',
        name: 'disclaimer',
        component: () => import('@/views/legal/LegalView.vue'),
        props: { docKey: 'disclaimer' },
        meta: {
            activeMenu: '',
            title: '免责声明'
        }
    },
    {
        path: '/deletion',
        name: 'deletion',
        component: () => import('@/views/legal/LegalView.vue'),
        props: { docKey: 'deletion' },
        meta: {
            activeMenu: '',
            title: '数据移除政策'
        }
    }
] as RouteRecordRaw[];
