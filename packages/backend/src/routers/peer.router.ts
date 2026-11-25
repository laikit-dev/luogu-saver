import Router from 'koa-router';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { Context, DefaultState } from 'koa';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { isPeerStream } from '@/services/helpers/peer-items.helper';
import { PeerCursorError, PeerExportService } from '@/services/peer-export.service';
import { normalizeErrorReason } from '@/utils/error-reason';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const COMPRESSION_THRESHOLD_BYTES = 1024;

const router = new Router<DefaultState, Context>({ prefix: '/peer/v1' });

/**
 * Read-only peering feed (`spec/peering-system.spec.md` Section 11). Responses bypass the
 * `{ code, message, data }` envelope: status codes and bodies are part of the protocol.
 */
router.get('/:stream', async ctx => {
    ctx.set('Cache-Control', 'private, no-store');
    if (!config.peer.exportToken) {
        ctx.status = 404;
        ctx.body = 'Not Found';
        return;
    }
    if (!PeerExportService.isAuthorized(ctx.get('Authorization') || undefined)) {
        ctx.status = 401;
        ctx.body = '';
        return;
    }
    const stream = ctx.params.stream;
    if (!isPeerStream(stream)) {
        ctx.status = 404;
        ctx.body = 'Not Found';
        return;
    }
    const after = ctx.query.after;
    if (Array.isArray(after)) {
        ctx.status = 400;
        ctx.body = '';
        return;
    }

    let page;
    try {
        page = await PeerExportService.buildPage(stream, after ?? '');
    } catch (error) {
        if (error instanceof PeerCursorError) {
            ctx.status = 400;
            ctx.body = '';
            return;
        }
        logger.error({ stream, reason: normalizeErrorReason(error) }, 'Peer feed page failed');
        ctx.status = 500;
        ctx.body = '';
        return;
    }

    let body = Buffer.from(JSON.stringify(page), 'utf8');
    ctx.set('Vary', 'Accept-Encoding');
    if (body.length > COMPRESSION_THRESHOLD_BYTES) {
        const encoding = ctx.acceptsEncodings('br', 'gzip', 'identity');
        if (encoding === 'br') {
            body = await brotli(body, {
                params: {
                    [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
                    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length
                }
            });
            ctx.set('Content-Encoding', 'br');
        } else if (encoding === 'gzip') {
            body = await gzipAsync(body, { level: 6 });
            ctx.set('Content-Encoding', 'gzip');
        }
    }
    ctx.status = 200;
    ctx.body = body;
    ctx.type = 'application/json';
});

export default router;
