import Router from 'koa-router';
import { Context, DefaultState } from 'koa';

const router = new Router<DefaultState, Context>({ prefix: '/paste' });

import { PasteService } from '@/services/paste.service';
import { ROLE_ADMIN } from '@/shared/permission';
import { logger } from '@/lib/logger';

router.get('/query/:id', async (ctx: Context) => {
    const pasteId = ctx.params.id;
    try {
        const paste = await PasteService.getPasteById(pasteId);
        if (!paste) {
            ctx.fail(404, 'Paste not found');
            return;
        }
        if (paste.deleted && ctx.user?.role !== ROLE_ADMIN) {
            ctx.fail(403, paste.deleteReason);
            return;
        }
        ctx.success(paste);
    } catch (error) {
        logger.error({ error, pasteId }, 'Failed to retrieve paste');
        ctx.fail(500, 'Failed to retrieve paste');
    }
});

router.get('/count', async (ctx: Context) => {
    try {
        const count = await PasteService.getPasteCount();
        ctx.success({ count });
    } catch (error) {
        logger.error({ error }, 'Failed to retrieve paste count');
        ctx.fail(500, 'Failed to retrieve paste count');
    }
});

export default router;
