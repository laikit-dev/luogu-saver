import { Context, Next } from 'koa';
import { logger } from '@/lib/logger';
import { hasRole, normalizeUserRole, UserRole } from '@/shared/permission';
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

export const requiresRole = (requiredRole: UserRole) => async (ctx: Context, next: Next) => {
    if (!ctx.user || ctx.user.id === undefined) {
        ctx.fail(401, 'Unauthorized');
        return;
    }

    const actualRole = normalizeUserRole(ctx.user.role);
    if (actualRole === UserRole.BANNED) {
        ctx.fail(403, 'You have been banned');
        return;
    }

    if (!hasRole(actualRole, requiredRole)) {
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

    const requiredRole = WORKFLOW_TEMPLATES_PERMISSION[templateId];
    if (requiredRole === null) {
        await next();
        return;
    }

    if (!ctx.user || ctx.user.id === undefined) {
        ctx.fail(401, 'Unauthorized');
        return;
    }

    const actualRole = normalizeUserRole(ctx.user.role);
    if (actualRole === UserRole.BANNED) {
        ctx.fail(403, 'You have been banned');
        return;
    }

    if (!hasRole(actualRole, requiredRole)) {
        ctx.fail(403, 'Permission denied');
        return;
    }

    await next();
};
