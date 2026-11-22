import { Context, Next } from 'koa';

export const responseHelper = async (ctx: Context, next: Next) => {
    ctx.success = (data: unknown = null, msg: string = 'Success') => {
        ctx.status = 200;
        ctx.body = {
            code: 200,
            message: msg,
            data
        };
    };
    ctx.fail = (code: number, msg: string, data: unknown = null) => {
        ctx.status = 200;
        const normalized = String(msg ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        ctx.body = {
            code,
            message: normalized || 'Unknown error',
            data
        };
    };
    try {
        await next();
        if (ctx.status === 404 && !ctx.body) {
            ctx.fail(404, 'Not Found');
        }
    } catch (err) {
        const error: Error & { status?: number } =
            err instanceof Error ? err : new Error(String(err));
        const status = error.status || 500;
        ctx.fail(status, error.message || 'Internal Server Error');
        if (status >= 500) ctx.app.emit('error', err, ctx);
    }
};
