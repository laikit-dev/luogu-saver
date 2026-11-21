import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import { setup as setupCssSsr } from '@css-render/vue3-ssr';
import type { ArticleSearchHit } from '@/api/search';
import SearchResultAuthor from './SearchResultAuthor.vue';

const hit: ArticleSearchHit = {
    id: 'abc',
    title: 'Article',
    summary: '',
    authorId: 42,
    authorName: 'Indexed author',
    category: 1,
    tags: [],
    updatedAt: 0,
    viewCount: 0,
    priority: 0,
    formatted: { authorName: '<mark>Indexed</mark> author' }
};
const author = {
    id: 42,
    name: hit.authorName,
    color: 'Purple',
    ccfLevel: 6,
    xcpcLevel: 8,
    badge: '<b>Aya</b>'
};

function renderHit(value: ArticleSearchHit) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/user/:uid', component: { render: () => null } }]
    });
    const app = createSSRApp({ render: () => h(SearchResultAuthor, { hit: value }) });
    app.use(router);
    setupCssSsr(app);
    return renderToString(app);
}

describe('search result authors', () => {
    it('renders the highlighted colored name, both awards, then the escaped badge text', async () => {
        const markup = await renderHit({ ...hit, author });

        expect(markup).toContain('user-Purple');
        expect(markup).toContain('href="/user/42"');
        expect(markup).toMatch(
            /<mark>Indexed<\/mark> author[\s\S]*aria-label="OI 等级 6"[\s\S]*aria-label="ICPC\/CCPC 等级 8"[\s\S]*&lt;b&gt;Aya&lt;\/b&gt;/
        );
        expect(markup).not.toContain('<b>Aya</b>');
        expect(markup).not.toContain('user-link-avatar');
        expect(markup).toContain('fill="var(--ui-prize-blue-color)"');
        expect(markup).toContain('fill="var(--ui-prize-gold-color)"');
    });

    it('shows a changed current name without applying stale index highlights', async () => {
        const markup = await renderHit({ ...hit, author: { ...author, name: 'Current author' } });

        expect(markup).toContain('Current author');
        expect(markup).not.toContain('Indexed');
        expect(markup).not.toContain('<mark>');
        expect(markup).toContain('Aya');
    });

    it.each([null, undefined])('falls back to the index when author is %s', async author => {
        const markup = await renderHit({ ...hit, author });

        expect(markup).toContain('<mark>Indexed</mark> author');
        expect(markup).toContain('href="/user/42"');
        expect(markup).not.toContain('user-prize-badge');
        expect(markup).not.toContain('user-badge');
    });
});
