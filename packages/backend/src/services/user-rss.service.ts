import { createHash } from 'node:crypto';
import { create } from 'xmlbuilder2';
import { config } from '@/config';
import type { ArchiveEvent, ArchiveKind } from '@/shared/archive';
import { UserTimelineService } from '@/services/user-timeline.service';
import { parseArchiveUid } from '@/utils/archive-query';

export interface ArchiveRssFeed {
    xml: string;
    etag: string;
}

export class UserRssService {
    public static async buildForUser(uid: number, kinds?: ArchiveKind[]): Promise<ArchiveRssFeed> {
        uid = parseArchiveUid(uid);
        const page = await UserTimelineService.listForUser(uid, { kinds, limit: 50 });
        return this.renderFeed(uid, page.items, config.archive.publicBaseUrl);
    }

    public static renderFeed(
        uid: number,
        events: ArchiveEvent[],
        publicBaseUrl: string
    ): ArchiveRssFeed {
        const profileLink = new URL(`/user/${uid}`, publicBaseUrl).href;
        const channel = create({ encoding: 'UTF-8', invalidCharReplacement: '\uFFFD' })
            .ele('rss', { version: '2.0' })
            .ele('channel');
        channel.ele('title').txt(`洛谷 UID ${uid} 的归档记录`);
        channel.ele('link').txt(profileLink);
        channel
            .ele('description')
            .txt(
                '本站记录的文章收录、归档版本与公开资料快照。记录时间不代表作者在原站的编辑时间。'
            );
        for (let index = 0; index < Math.min(events.length, 50); index++) {
            const event = events[index];
            const link = new URL(
                event.kind === 'profile'
                    ? `/user/${event.uid}`
                    : `/article/${encodeURIComponent(event.articleId!)}`,
                publicBaseUrl
            );
            if (event.kind !== 'article') link.searchParams.set('version', String(event.version));
            const description =
                event.kind === 'article'
                    ? '本站首次收录了这篇文章。此时间为本站记录时间。'
                    : event.kind === 'version'
                      ? `本站记录了文章的第 ${event.version} 个归档版本。新增快照不代表作者在原站进行了编辑。`
                      : `本站记录了第 ${event.version} 份公开资料快照。这不是账号注册时间，也不代表原站编辑时间。`;
            const item = channel.ele('item');
            item.ele('title').txt(
                event.kind === 'version' ? `归档版本 ${event.version}：${event.title}` : event.title
            );
            item.ele('link').txt(link.href);
            item.ele('guid', { isPermaLink: 'false' }).txt(`urn:luogu-saver:${event.eventId}`);
            item.ele('pubDate').txt(new Date(event.observedAt).toUTCString());
            item.ele('description').txt(description);
        }
        const xml = channel.end();
        return { xml, etag: `"${createHash('sha256').update(xml).digest('hex')}"` };
    }

    public static matchesEtag(ifNoneMatch: string, etag: string): boolean {
        return ifNoneMatch.split(',').some(value => {
            const candidate = value.trim();
            return candidate === '*' || candidate.replace(/^W\//, '') === etag;
        });
    }
}
