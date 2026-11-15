import { UnrecoverableError } from 'bullmq';

import { fetch } from '@/utils/fetch';
import { C3vkMode } from '@/shared/c3vk';
import type { Reply } from '@/types/luogu-api';
import { CommentService, type LuoguComment } from '@/services/comment.service';
import { UserService } from '@/services/user.service';
import { buildUser } from '@/utils/luogu-api';
import { logger } from '@/lib/logger';
import { emitToRoom } from '@/lib/socket';
import type { SaveTask, TaskHandler, TaskTextResult, WorkflowResult } from '@/workers/types';
import { ArticleService } from '@/services/article.service';

const COMMENTS_MAX_PAGES = 200;

interface RepliesData {
    replySlice: Reply[];
}

export class CommentsHandler implements TaskHandler<SaveTask> {
    public taskType = 'save:comments';

    public async handle(task: SaveTask): Promise<WorkflowResult<TaskTextResult>> {
        const lid = task.payload.targetId;
        // Article ids are short alphanumeric slugs (length <= 8).
        if (typeof lid !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(lid)) {
            throw new UnrecoverableError(`Invalid comments targetId: ${JSON.stringify(lid)}`);
        }

        const forceUpdate = task.payload.metadata?.forceUpdate === true;
        const article = await ArticleService.getArticleByIdWithoutCache(lid);
        if (!forceUpdate && !CommentService.isCommentsStale(article)) {
            logger.info({ lid }, 'Comments are fresh, skipping refresh');
            return {
                skipNextStep: true,
                data: {
                    text: ''
                }
            };
        }

        // Cursor pagination: /article/{lid}/replies?sort=&after={lastCommentId}.
        // An empty replySlice signals the end. Verified against live luogu.com 2026-05.
        const collected: Reply[] = [];
        const seenIds = new Set<number>();
        let after: number | null = null;

        for (let page = 0; page < COMMENTS_MAX_PAGES; page++) {
            const url =
                `https://www.luogu.com/article/${lid}/replies?sort=` +
                (after !== null ? `&after=${after}` : '');
            const resp: RepliesData = await fetch(url, C3vkMode.MODERN);

            const slice = resp?.replySlice;
            if (!Array.isArray(slice) || slice.length === 0) break;

            let advanced = false;
            for (const reply of slice) {
                if (
                    !reply ||
                    typeof reply.id !== 'number' ||
                    !reply.author ||
                    typeof reply.author.uid !== 'number'
                ) {
                    continue;
                }
                if (seenIds.has(reply.id)) continue;
                seenIds.add(reply.id);
                collected.push(reply);
                advanced = true;
            }

            const last = slice[slice.length - 1];
            const nextCursor = last && typeof last.id === 'number' ? last.id : null;
            // Stop if the cursor did not move or no new rows were added, to avoid loops.
            if (nextCursor === null || nextCursor === after || !advanced) break;
            after = nextCursor;
        }

        // Upsert comment authors into the user table first (reuses the inline path,
        // so badges / colors are available), then store the comments.
        const authorsByUid = new Map<number, Reply['author']>();
        for (const reply of collected) {
            authorsByUid.set(reply.author.uid, reply.author);
        }
        for (const author of authorsByUid.values()) {
            await UserService.upsertLuoguUser(buildUser(author));
        }

        const comments: LuoguComment[] = collected.map(reply => ({
            id: reply.id,
            authorId: reply.author.uid,
            time: typeof reply.time === 'number' ? reply.time : 0,
            content: typeof reply.content === 'string' ? reply.content : ''
        }));

        await CommentService.saveLuoguComments(lid, comments);

        emitToRoom(`article_${lid}`, `article:${lid}:comments-updated`);
        logger.info({ lid, commentCount: comments.length }, 'Comments saved');

        return {
            skipNextStep: false,
            data: {
                text: ''
            }
        };
    }
}
