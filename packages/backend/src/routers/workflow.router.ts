import Router from 'koa-router';
import { Context, DefaultState } from 'koa';
import { WorkflowService } from '@/services/workflow.service';
import { logger } from '@/lib/logger';
import { checkWorkflowPermission, requiresPermission } from '@/middlewares/authorization';
import { Permission } from '@/shared/permission';

const router = new Router<DefaultState, Context>({ prefix: '/workflow' });

router.post('/create', requiresPermission(Permission.CREATE_WORKFLOW), async (ctx: Context) => {
    const flowDef = ctx.request.body as any;

    if (!flowDef) {
        ctx.fail(400, 'Invalid flow definition.');
        return;
    }

    try {
        const result = await WorkflowService.createWorkflow(flowDef);
        ctx.success(result);
    } catch (error) {
        logger.error({ error }, 'Failed to create workflow');
        ctx.fail(500, error instanceof Error ? error.message : 'Unknown error');
    }
});

router.post('/create/template/:name', checkWorkflowPermission, async (ctx: Context) => {
    const { name } = ctx.params;
    const params = ctx.request.body;
    if (params && typeof params !== 'object') {
        ctx.fail(400, 'Invalid parameters. Expected an object.');
        return;
    }

    if (!name) {
        ctx.fail(400, 'Template name is required');
        return;
    }

    try {
        if (params && typeof params === 'object' && 'forceUpdate' in params) {
            delete params.forceUpdate;
        }
        const result = await WorkflowService.createWorkflowFromTemplate(name, params);
        ctx.success(result);
    } catch (error) {
        logger.error({ error, name }, 'Failed to create workflow from template');
        ctx.fail(500, error instanceof Error ? error.message : 'Unknown error');
    }
});

router.get('/query/:id', async (ctx: Context) => {
    const { id } = ctx.params;

    if (!id) {
        ctx.fail(400, 'Workflow ID is required');
        return;
    }

    try {
        const workflow = await WorkflowService.getWorkflowById(id);
        if (!workflow) {
            ctx.fail(404, 'Workflow not found');
            return;
        }
        ctx.success(workflow);
    } catch (error) {
        logger.error({ error, id }, 'Failed to get workflow status');
        ctx.fail(500, error instanceof Error ? error.message : 'Unknown error');
    }
});

export default router;
