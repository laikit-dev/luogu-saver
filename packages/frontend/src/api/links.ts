import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';

export interface ResolvedLinkUser {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

export interface ResolvedLinkArticle {
    id: string;
    title: string;
    category: number;
    authorName: string | null;
}

export interface ResolvedLinkPaste {
    id: string;
    authorName: string | null;
    preview: string;
}

export interface ResolveLinksRequest {
    userIds?: number[];
    articleIds?: string[];
    pasteIds?: string[];
}

export interface ResolveLinksResponse {
    users: Record<string, ResolvedLinkUser>;
    articles: Record<string, ResolvedLinkArticle>;
    pastes: Record<string, ResolvedLinkPaste>;
}

const MAX_BATCH_SIZE = 100;

const userCache = new Map<number, ResolvedLinkUser | null>();
const articleCache = new Map<string, ResolvedLinkArticle | null>();
const pasteCache = new Map<string, ResolvedLinkPaste | null>();

const inFlightUsers = new Map<number, Promise<void>>();
const inFlightArticles = new Map<string, Promise<void>>();
const inFlightPastes = new Map<string, Promise<void>>();

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function fetchResolveBatch(
    userIds: number[],
    articleIds: string[],
    pasteIds: string[]
): Promise<void> {
    if (userIds.length === 0 && articleIds.length === 0 && pasteIds.length === 0) return;

    const userChunks = chunkArray(userIds, MAX_BATCH_SIZE);
    const articleChunks = chunkArray(articleIds, MAX_BATCH_SIZE);
    const pasteChunks = chunkArray(pasteIds, MAX_BATCH_SIZE);
    const totalChunks = Math.max(userChunks.length, articleChunks.length, pasteChunks.length);

    for (let i = 0; i < totalChunks; i++) {
        const uChunk = userChunks[i] ?? [];
        const aChunk = articleChunks[i] ?? [];
        const pChunk = pasteChunks[i] ?? [];
        const res = (await apiFetch('/archive/resolve-links', {
            method: 'POST',
            data: { userIds: uChunk, articleIds: aChunk, pasteIds: pChunk }
        })) as ApiResponse<ResolveLinksResponse>;

        if (res.code !== 200 || !res.data) continue;

        for (const uid of uChunk) {
            userCache.set(uid, res.data.users?.[String(uid)] ?? null);
        }
        for (const aid of aChunk) {
            articleCache.set(aid, res.data.articles?.[aid] ?? null);
        }
        for (const pid of pChunk) {
            pasteCache.set(pid, res.data.pastes?.[pid] ?? null);
        }
    }
}

export async function resolveLinksBatch(req: ResolveLinksRequest): Promise<ResolveLinksResponse> {
    const wantUsers = [...new Set(req.userIds ?? [])];
    const wantArticles = [...new Set(req.articleIds ?? [])];
    const wantPastes = [...new Set(req.pasteIds ?? [])];

    const missingUsers = wantUsers.filter(id => !userCache.has(id) && !inFlightUsers.has(id));
    const missingArticles = wantArticles.filter(
        id => !articleCache.has(id) && !inFlightArticles.has(id)
    );
    const missingPastes = wantPastes.filter(id => !pasteCache.has(id) && !inFlightPastes.has(id));

    const waitPromises: Promise<void>[] = [];
    for (const id of wantUsers) {
        const pending = inFlightUsers.get(id);
        if (pending) waitPromises.push(pending);
    }
    for (const id of wantArticles) {
        const pending = inFlightArticles.get(id);
        if (pending) waitPromises.push(pending);
    }
    for (const id of wantPastes) {
        const pending = inFlightPastes.get(id);
        if (pending) waitPromises.push(pending);
    }

    if (missingUsers.length > 0 || missingArticles.length > 0 || missingPastes.length > 0) {
        const batchPromise = fetchResolveBatch(missingUsers, missingArticles, missingPastes)
            .catch(() => {
                // Keep UI resilient; unresolved links retain clean fallback chips.
            })
            .finally(() => {
                for (const id of missingUsers) inFlightUsers.delete(id);
                for (const id of missingArticles) inFlightArticles.delete(id);
                for (const id of missingPastes) inFlightPastes.delete(id);
            });

        for (const id of missingUsers) inFlightUsers.set(id, batchPromise);
        for (const id of missingArticles) inFlightArticles.set(id, batchPromise);
        for (const id of missingPastes) inFlightPastes.set(id, batchPromise);
        waitPromises.push(batchPromise);
    }

    if (waitPromises.length > 0) {
        await Promise.all(new Set(waitPromises));
    }

    const users: Record<string, ResolvedLinkUser> = {};
    for (const id of wantUsers) {
        const hit = userCache.get(id);
        if (hit) users[String(id)] = hit;
    }
    const articles: Record<string, ResolvedLinkArticle> = {};
    for (const id of wantArticles) {
        const hit = articleCache.get(id);
        if (hit) articles[id] = hit;
    }
    const pastes: Record<string, ResolvedLinkPaste> = {};
    for (const id of wantPastes) {
        const hit = pasteCache.get(id);
        if (hit) pastes[id] = hit;
    }

    return { users, articles, pastes };
}
