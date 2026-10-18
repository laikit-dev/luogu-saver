import { Context, Next } from 'koa';
import { logger } from '@/lib/logger';
import { Permission } from '@/shared/permission';
import { WORKFLOW_TEMPLATES_PERMISSION } from '@/lib/workflow-templates';
import { RegisteredUserService } from '@/services/registered-user.service';

export const authorization = async (ctx: Context, next: Next) => {
    if (ctx.headers['authorization']) {
        try {
            const token = ctx.headers['authorization'].replace('Bearer ', '') as string;
            const user = await RegisteredUserService.validateBearerToken(token);
            if (user) {
                ctx.user = user;
            }
        } catch (error) {
            logger.error({ error }, 'Token validation failed');
        }
    }
    await next();
};

export const requiresPermission = (permissionBit: number) => async (ctx: Context, next: Next) => {
    if (!ctx.user || ctx.user.id === undefined) {
        ctx.fail(401, 'Unauthorized');
        return;
    }

    const role = ctx.user.role;

    if (role !== -1 && !(role & Permission.LOGIN)) {
        ctx.fail(403, 'You have been banned');
        return;
    }

    if (role !== -1 && (role & permissionBit) !== permissionBit) {
        ctx.fail(403, 'Permission denied');
        return;
    }

    await next();
};

export const checkWorkflowPermission = async (ctx: Context, next: Next) => {
    const templateId = ctx.params.name;
    if (!Object.prototype.hasOwnProperty.call(WORKFLOW_TEMPLATES_PERMISSION, templateId)) {
        ctx.fail(400, 'Invalid workflow template');
        return;
    }

    const permission = WORKFLOW_TEMPLATES_PERMISSION[templateId];
    if (permission === null) {
        await next();
        return;
    }

    if (!ctx.user || ctx.user.id === undefined) {
        ctx.fail(401, 'Unauthorized');
        return;
    }

    const role = ctx.user.role;

    if (role !== -1 && !(role & Permission.LOGIN)) {
        ctx.fail(403, 'You have been banned');
        return;
    }

    if (role !== -1 && (role & permission) !== permission) {
        ctx.fail(403, 'Permission denied');
        return;
    }

    await next();
};
