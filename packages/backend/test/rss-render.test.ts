import { describe, expect, it, vi } from 'vitest';
import { create } from 'xmlbuilder2';
import type { ArchiveEvent } from '../src/shared/archive';

vi.mock('@/config', () => ({ config: { archive: { publicBaseUrl: 'https://archive.example' } } }));
vi.mock('@/services/user-timeline.service', () => ({ UserTimelineService: {} }));

import { UserRssService } from '../src/services/user-rss.service';

type RssItem = {
    title: string;
    link: string;
    guid: { '@isPermaLink': string; '#': string };
    pubDate: string;
    description: string;
};
type RssDocument = {
    rss: { '@version': string; channel: { link: string; item?: RssItem | RssItem[] } };
};

const events: ArchiveEvent[] = [
    {
        eventId: 'profile:13',
        kind: 'profile',
        uid: 42,
        title: 'Profile snapshot #9 · A & B',
        articleId: null,
        version: 9,
        observedAt: '2026-09-25T12:00:00.000Z',
        publishedAt: null
    },
    {
        eventId: 'version:12',
        kind: 'version',
        uid: 42,
        title: 'A & B <em>quoted</em> "title"\u0000',
        articleId: 'article1',
        version: 7,
        observedAt: '2026-09-25T11:00:00.000Z',
        publishedAt: '2020-01-01T00:00:00.000Z'
    },
    {
        eventId: 'article:article1',
        kind: 'article',
        uid: 42,
        title: 'Initial archive',
        articleId: 'article1',
        version: null,
        observedAt: '2026-09-25T10:00:00.000Z',
        publishedAt: '2020-01-01T00:00:00.000Z'
    }
];

describe('public archive RSS serialization', () => {
    it('escapes XML-special text and emits absolute selectable snapshot links', () => {
        const feed = UserRssService.renderFeed(42, events, 'https://archive.example');
        const document = create(feed.xml).end({ format: 'object' }) as unknown as RssDocument;
        expect(document.rss['@version']).toBe('2.0');
        expect(document.rss.channel.link).toBe('https://archive.example/user/42');
        const items = document.rss.channel.item as RssItem[];
        expect(items.map(item => item.link)).toEqual([
            'https://archive.example/user/42?version=9',
            'https://archive.example/article/article1?version=7',
            'https://archive.example/article/article1'
        ]);
        expect(items.map(item => item.guid)).toEqual(
            events.map(event => ({
                '@isPermaLink': 'false',
                '#': `urn:luogu-saver:${event.eventId}`
            }))
        );
        expect(items.map(item => item.pubDate)).toEqual(
            events.map(event => new Date(event.observedAt).toUTCString())
        );
        expect(feed.xml).not.toContain('<em>');
        expect(feed.xml).not.toContain('\u0000');
    });

    it('does not embed bodies or account information attached to event records', () => {
        const enriched = events.map(event => ({
            ...event,
            content: 'BODY_SECRET',
            snapshot: { introduction: 'PROFILE_SECRET' },
            actor: 'ACTOR_SECRET',
            loginToken: 'TOKEN_SECRET',
            deleteReason: 'DELETE_SECRET'
        }));
        const { xml } = UserRssService.renderFeed(42, enriched, 'https://archive.example');
        for (const secret of [
            'BODY_SECRET',
            'PROFILE_SECRET',
            'ACTOR_SECRET',
            'TOKEN_SECRET',
            'DELETE_SECRET'
        ]) {
            expect(xml).not.toContain(secret);
        }
    });

    it('preserves event GUIDs while visibility and title changes alter the ETag', () => {
        const original = UserRssService.renderFeed(42, events, 'https://archive.example');
        expect(UserRssService.renderFeed(42, events, 'https://archive.example').etag).toBe(
            original.etag
        );
        const renamed = UserRssService.renderFeed(
            42,
            events.map(event => ({ ...event, title: 'Changed title' })),
            'https://archive.example'
        );
        const cleared = UserRssService.renderFeed(
            42,
            events.filter(event => event.kind !== 'profile'),
            'https://archive.example'
        );
        expect(renamed.etag).not.toBe(original.etag);
        expect(cleared.etag).not.toBe(original.etag);
        for (const event of events) {
            expect(renamed.xml).toContain(`urn:luogu-saver:${event.eventId}`);
        }
        expect(cleared.xml).not.toContain('urn:luogu-saver:profile:13');
    });

    it('renders an empty valid feed when no public events remain', () => {
        const feed = UserRssService.renderFeed(42, [], 'https://archive.example');
        const document = create(feed.xml).end({ format: 'object' }) as unknown as RssDocument;
        expect(document.rss['@version']).toBe('2.0');
        expect(document.rss.channel.item).toBeUndefined();
        expect(document.rss.channel.link).toBe('https://archive.example/user/42');
    });

    it('recognizes conditional GET validators without accepting a different feed', () => {
        const first = UserRssService.renderFeed(42, events, 'https://archive.example');
        const empty = UserRssService.renderFeed(42, [], 'https://archive.example');
        expect(UserRssService.matchesEtag(`"other", W/${first.etag}`, first.etag)).toBe(true);
        expect(UserRssService.matchesEtag('*', first.etag)).toBe(true);
        expect(UserRssService.matchesEtag(first.etag, empty.etag)).toBe(false);
    });
});
