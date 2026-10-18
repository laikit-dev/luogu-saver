import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'home',
        component: () => import('@/views/HomeView.vue'),
        meta: {
            activeMenu: 'home',
            title: '首页'
        }
    }
];

const modules = import.meta.glob('./modules/*.ts', { eager: true });

Object.keys(modules).forEach(key => {
    const mod = modules[key] as { default: RouteRecordRaw[] };
    const modList = mod.default || [];
    routes.push(...modList);
});

routes.push({
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: {
        title: '页面不存在'
    }
});

const router = createRouter({
    history: createWebHistory(),
    routes
});

const DEFAULT_TITLE = '洛谷保存站';

router.afterEach((to, from) => {
    if (to.path !== from.path || from.matched.length === 0) {
        document.title = to.meta.title ? `${to.meta.title} - ${DEFAULT_TITLE}` : DEFAULT_TITLE;
    }
});

export default router;
