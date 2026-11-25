import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProfileSnapshotData } from '@/entities/user-profile-history';
import { toProfileSnapshot } from '@/services/helpers/profile-snapshot.helper';
import type { UserPrize } from '@/entities/user';
import type { UserColor } from '@/shared/user';
import { normalizePublishTime } from '@/services/helpers/publish-time.helper';
import {
    MICROS_PER_SECOND,
    parseInstant,
    toUnixSeconds,
    type Micros
} from '@/services/helpers/peer-time.helper';

/** Stream names in the order a round requests them (`spec/peering-system.spec.md` Section 5.1). */
export const PEER_STREAMS = [
    'users',
    'profile-versions',
    'articles',
    'article-versions',
    'comments',
    'pastes',
    'judgements'
] as const;

export type PeerStream = (typeof PEER_STREAMS)[number];

export function isPeerStream(value: string): value is PeerStream {
    return (PEER_STREAMS as readonly string[]).includes(value);
}

const UINT32_MAX = 4_294_967_295;
const TEXT_MAX_BYTES = 65_535;
const MEDIUMTEXT_MAX_BYTES = 16_777_215;

export function sha256Hex(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

/** Prizes in the protocol's `Prize` shape: `score` and `rank` are numbers or absent. */
export function toPeerPrizes(prizes: readonly UserPrize[] | null): UserPrize[] {
    return (prizes ?? []).map(prize => ({
        year: prize.year,
        contest: prize.contest,
        event: prize.event ?? null,
        prize: prize.prize,
        ...(typeof prize.score === 'number' ? { score: prize.score } : {}),
        ...(typeof prize.rank === 'number' ? { rank: prize.rank } : {})
    }));
}

/**
 * A profile snapshot in the protocol's `Snapshot` shape with a fixed key order, so that two
 * snapshots are equal JSON values iff their serializations are equal strings.
 */
export function toPeerSnapshot(
    data: Omit<ProfileSnapshotData, 'prizes'> & { prizes: UserPrize[] | null }
): ProfileSnapshotData {
    return toProfileSnapshot({ ...data, prizes: toPeerPrizes(data.prizes) });
}

const uidSchema = z.number().int().min(1).max(UINT32_MAX);
const int32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const contentIdSchema = z.string().regex(/^[A-Za-z0-9]{1,8}$/);

const instantSchema = z.string().transform((value, ctx): Micros => {
    const instant = parseInstant(value);
    if (instant === null) {
        ctx.addIssue({ code: 'custom', message: 'Expected YYYY-MM-DDTHH:mm:ss.sssZ' });
        return z.NEVER;
    }
    return instant;
});

/** Instants stored in a `DATETIME` (seconds) column are truncated before any comparison. */
const secondInstantSchema = instantSchema.transform(
    instant => Math.floor(instant / MICROS_PER_SECOND) * MICROS_PER_SECOND
);

function charsAtMost(max: number) {
    return z.string().refine(value => [...value].length <= max, `At most ${max} characters`);
}

function bytesAtMost(max: number) {
    return z
        .string()
        .refine(value => Buffer.byteLength(value, 'utf8') <= max, `At most ${max} bytes`);
}

const nameSchema = charsAtMost(255).refine(value => value.length > 0, 'Expected a non-empty name');
const colorSchema = charsAtMost(255).refine(value => value.length > 0, 'Expected a color');

const prizesSchema = z
    .array(
        z.object({
            year: z.number().int(),
            contest: z.string(),
            event: z.string().nullable().optional(),
            prize: z.string(),
            score: z.unknown().optional(),
            rank: z.unknown().optional()
        })
    )
    .transform(prizes => toPeerPrizes(prizes as UserPrize[]));

/** Publish instants map to Unix seconds through the local publish-time normalization. */
const publishedAtSchema = instantSchema
    .nullable()
    .transform(instant => (instant === null ? null : normalizePublishTime(toUnixSeconds(instant))));

export interface PeerUserItem {
    uid: number;
    name: string;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
    changedAt: Micros;
    profile: null | {
        slogan: string | null;
        introduction: string | null;
        prizes: UserPrize[];
        fetchedAt: Micros;
    };
}

export interface PeerProfileVersionItem {
    uid: number;
    observedAt: Micros;
    snapshot: ProfileSnapshotData;
}

export interface PeerArticleItem {
    id: string;
    title: string;
    content: string;
    authorId: number;
    category: number;
    solutionForPid: string | null;
    upvote: number;
    favorCount: number;
    publishTime: number | null;
    archivedAt: Micros;
    checkedAt: Micros;
}

export interface PeerArticleVersionItem {
    articleId: string;
    observedAt: Micros;
    title: string;
    content: string;
}

export interface PeerComment {
    id: number;
    authorId: number;
    content: string;
    time: number;
}

export interface PeerCommentsItem {
    articleId: string;
    fetchedAt: Micros;
    comments: PeerComment[];
}

export interface PeerPasteItem {
    id: string;
    content: string;
    authorId: number;
    publishTime: number | null;
    archivedAt: Micros;
    checkedAt: Micros;
}

export interface PeerJudgementItem {
    uid: number;
    name: string;
    reason: string | null;
    revokedPermission: number;
    addedPermission: number;
    time: number;
    user: Record<string, unknown>;
}

export interface PeerItemByStream {
    users: PeerUserItem;
    'profile-versions': PeerProfileVersionItem;
    articles: PeerArticleItem;
    'article-versions': PeerArticleVersionItem;
    comments: PeerCommentsItem;
    pastes: PeerPasteItem;
    judgements: PeerJudgementItem;
}

export type PeerItemSchemas = { [S in PeerStream]: z.ZodType<PeerItemByStream[S]> };

/**
 * Builds the incoming item validators. `textLimit` bounds every MEDIUMTEXT value in UTF-8 bytes so
 * that one escaped row fits into one statement under the server's `max_allowed_packet`.
 */
export function createPeerItemSchemas(textLimit: number): PeerItemSchemas {
    const mediumTextSchema = bytesAtMost(Math.min(textLimit, MEDIUMTEXT_MAX_BYTES));
    const optionalTextSchema = bytesAtMost(TEXT_MAX_BYTES).nullable();
    const snapshotDetails = {
        name: nameSchema,
        color: colorSchema,
        ccfLevel: int32Schema.min(0),
        xcpcLevel: int32Schema.min(0)
    };
    const profileFields = {
        slogan: optionalTextSchema,
        introduction: mediumTextSchema.nullable(),
        prizes: prizesSchema
    };

    const users = z
        .object({
            uid: uidSchema,
            ...snapshotDetails,
            badge: optionalTextSchema,
            changedAt: instantSchema,
            profile: z.object({ ...profileFields, fetchedAt: secondInstantSchema }).nullable()
        })
        .transform(
            (item): PeerUserItem => ({
                uid: item.uid,
                name: item.name,
                color: item.color as UserColor,
                ccfLevel: item.ccfLevel,
                xcpcLevel: item.xcpcLevel,
                badge: item.badge === null ? null : item.badge.trim() || null,
                changedAt: item.changedAt,
                profile: item.profile && {
                    slogan: item.profile.slogan || null,
                    introduction: item.profile.introduction || null,
                    prizes: item.profile.prizes,
                    fetchedAt: item.profile.fetchedAt
                }
            })
        );

    const profileVersions = z
        .object({
            uid: uidSchema,
            observedAt: instantSchema,
            snapshot: z.object({ id: uidSchema, ...snapshotDetails, ...profileFields })
        })
        .refine(item => item.snapshot.id === item.uid, {
            message: 'snapshot.id differs from uid',
            path: ['snapshot', 'id']
        })
        .transform(
            (item): PeerProfileVersionItem => ({
                uid: item.uid,
                observedAt: item.observedAt,
                snapshot: toPeerSnapshot({
                    ...item.snapshot,
                    color: item.snapshot.color as UserColor
                })
            })
        );

    const articles = z
        .object({
            id: contentIdSchema,
            title: charsAtMost(255),
            content: mediumTextSchema,
            authorId: uidSchema,
            category: int32Schema,
            solutionForPid: charsAtMost(50).nullable(),
            upvote: int32Schema,
            favorCount: int32Schema,
            publishedAt: publishedAtSchema,
            archivedAt: instantSchema,
            checkedAt: instantSchema
        })
        .transform(
            ({ publishedAt, ...item }): PeerArticleItem => ({ ...item, publishTime: publishedAt })
        );

    const articleVersions = z.object({
        articleId: contentIdSchema,
        observedAt: instantSchema,
        title: charsAtMost(255),
        content: mediumTextSchema
    });

    const comments = z.object({
        articleId: contentIdSchema,
        fetchedAt: secondInstantSchema,
        comments: z.array(
            z
                .object({
                    id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
                    authorId: uidSchema,
                    content: mediumTextSchema,
                    publishedAt: instantSchema
                })
                .transform(
                    (comment): PeerComment => ({
                        id: comment.id,
                        authorId: comment.authorId,
                        content: comment.content,
                        time: toUnixSeconds(comment.publishedAt)
                    })
                )
        )
    });

    const pastes = z
        .object({
            id: contentIdSchema,
            content: mediumTextSchema,
            authorId: uidSchema,
            publishedAt: publishedAtSchema,
            archivedAt: instantSchema,
            checkedAt: instantSchema
        })
        .transform(
            ({ publishedAt, ...item }): PeerPasteItem => ({ ...item, publishTime: publishedAt })
        );

    const judgements = z.object({
        uid: uidSchema,
        name: nameSchema,
        reason: optionalTextSchema,
        revokedPermission: z.number().int().min(0).max(UINT32_MAX),
        addedPermission: z.number().int().min(0).max(UINT32_MAX),
        time: instantSchema.transform(toUnixSeconds).pipe(z.number().int().min(1).max(UINT32_MAX)),
        user: z.record(z.string(), z.unknown())
    });

    return {
        users,
        'profile-versions': profileVersions,
        articles,
        'article-versions': articleVersions,
        comments,
        pastes,
        judgements
    };
}
