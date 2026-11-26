import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import {
    hasRole,
    isValidUserRole,
    normalizeUserRole,
    ROLE_ADMIN,
    ROLE_DEFAULT,
    UserRole
} from '../src/shared/permission';
import { sanitizePublicTaskResult } from '../src/utils/task-result-sanitizer';
import { WORKFLOW_TEMPLATES, WORKFLOW_TEMPLATES_PERMISSION } from '../src/lib/workflow-templates';

const mocks = vi.hoisted(() => ({
    getArticleByIdWithoutCache: vi.fn(),
    getPasteByIdWithoutCache: vi.fn()
}));

vi.mock('@/services/article.service', () => ({
    ArticleService: {
        getArticleByIdWithoutCache: mocks.getArticleByIdWithoutCache
    }
}));

vi.mock('@/services/paste.service', () => ({
    PasteService: {
        getPasteByIdWithoutCache: mocks.getPasteByIdWithoutCache
    }
}));

import { ReadArticleHandler } from '../src/workers/handlers/task/read/read-article.handler';
import { ReadPasteHandler } from '../src/workers/handlers/task/read/read-paste.handler';

describe('4-state UserRole model', () => {
    it('validates only the four canonical role values and normalizes legacy bitmasks', () => {
        expect(ROLE_ADMIN).toBe(UserRole.ADMIN);
        expect(ROLE_DEFAULT).toBe(UserRole.USER);

        expect(isValidUserRole(UserRole.BANNED)).toBe(true);
        expect(isValidUserRole(UserRole.USER)).toBe(true);
        expect(isValidUserRole(UserRole.MODERATOR)).toBe(true);
        expect(isValidUserRole(UserRole.ADMIN)).toBe(true);
        expect(isValidUserRole(3)).toBe(false);
        expect(isValidUserRole(128)).toBe(false);
        expect(isValidUserRole(-2)).toBe(false);

        expect(normalizeUserRole(-1)).toBe(UserRole.ADMIN);
        expect(normalizeUserRole(0)).toBe(UserRole.BANNED);
        expect(normalizeUserRole(1)).toBe(UserRole.USER);
        expect(normalizeUserRole(2)).toBe(UserRole.MODERATOR);
        // Legacy default bitmask `LOGIN | CREATE_WORKFLOW` (3) maps to USER.
        expect(normalizeUserRole(3)).toBe(UserRole.USER);
        expect(normalizeUserRole(null)).toBe(UserRole.BANNED);
    });

    it('enforces strict role hierarchy BANNED < USER < MODERATOR < ADMIN', () => {
        expect(hasRole(UserRole.BANNED, UserRole.USER)).toBe(false);
        expect(hasRole(UserRole.USER, UserRole.USER)).toBe(true);
        expect(hasRole(UserRole.USER, UserRole.MODERATOR)).toBe(false);
        expect(hasRole(UserRole.USER, UserRole.ADMIN)).toBe(false);
        expect(hasRole(UserRole.MODERATOR, UserRole.USER)).toBe(true);
        expect(hasRole(UserRole.MODERATOR, UserRole.MODERATOR)).toBe(true);
        expect(hasRole(UserRole.MODERATOR, UserRole.ADMIN)).toBe(false);
        expect(hasRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
    });
});

describe('workflow template permissions and read guards', () => {
    it('restricts censor pipeline to MODERATOR without tracking read-article and rebuilds to ADMIN', () => {
        expect(WORKFLOW_TEMPLATES_PERMISSION['article-censor-pipeline']).toBe(UserRole.MODERATOR);
        expect(WORKFLOW_TEMPLATES_PERMISSION['search-reindex-pipeline']).toBe(UserRole.ADMIN);
        expect(WORKFLOW_TEMPLATES_PERMISSION['article-summary-rebuild-pipeline']).toBe(
            UserRole.ADMIN
        );
        expect(WORKFLOW_TEMPLATES_PERMISSION['article-embedding-rebuild-pipeline']).toBe(
            UserRole.ADMIN
        );

        const censorFlow = WORKFLOW_TEMPLATES['article-censor-pipeline']({ targetId: 'art1' });
        const readNode = censorFlow.tasks.find(t => t.name === 'read-article');
        expect(readNode?.track).not.toBe(true);
    });

    it('rejects soft-deleted articles and pastes in ReadArticleHandler and ReadPasteHandler', async () => {
        mocks.getArticleByIdWithoutCache.mockResolvedValue({
            id: 'a1',
            deleted: true,
            content: 'secret deleted body'
        });
        mocks.getPasteByIdWithoutCache.mockResolvedValue({
            id: 'p1',
            deleted: true,
            content: 'secret deleted paste'
        });

        const articleHandler = new ReadArticleHandler();
        await expect(
            articleHandler.handle({
                type: 'read' as never,
                payload: { target: 'article', targetId: 'a1', metadata: {} }
            })
        ).rejects.toThrow(UnrecoverableError);

        const pasteHandler = new ReadPasteHandler();
        await expect(
            pasteHandler.handle({
                type: 'read' as never,
                payload: { target: 'paste', targetId: 'p1', metadata: {} }
            })
        ).rejects.toThrow(UnrecoverableError);
    });

    it('redacts sensitive content, text, internal reason, and embeddings from public task results', () => {
        const raw = {
            censor: {
                name: 'censor',
                result: {
                    rating: 85,
                    category: 'Sensitive',
                    reason: 'internal metaphor details',
                    userDisplayMessage: 'Unable to process due to safety policies.'
                }
            },
            'read-article': {
                name: 'read-article',
                result: {
                    id: 'a1',
                    title: 'Title',
                    content: 'full markdown body',
                    text: 'full markdown body',
                    embedding: [0.1, 0.2],
                    embeddingRecords: [{ kind: 'summary', embedding: [0.1, 0.2] }]
                }
            }
        };

        expect(sanitizePublicTaskResult(raw)).toEqual({
            censor: {
                name: 'censor',
                result: {
                    rating: 85,
                    category: 'Sensitive',
                    userDisplayMessage: 'Unable to process due to safety policies.'
                }
            },
            'read-article': {
                name: 'read-article',
                result: {
                    id: 'a1',
                    title: 'Title'
                }
            }
        });
    });
});
