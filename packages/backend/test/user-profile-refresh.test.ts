import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Koa from 'koa';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { z } from 'zod';

const fixtures = vi.hoisted(() => ({
    getUser: vi.fn(),
    isStale: vi.fn(),
    createTask: vi.fn(),
    dispatchTask: vi.fn()
}));

vi.mock('@/services/user.service', () => ({
    UserService: { getUserById: fixtures.getUser, isProfileStale: fixtures.isStale }
}));
vi.mock('@/services/user-profile-history.service', () => ({ UserProfileHistoryService: {} }));
vi.mock('@/services/task.service', () => ({
    TaskService: { createTask: fixtures.createTask, dispatchTask: fixtures.dispatchTask }
}));
vi.mock('@/services/registered-user.service', () => ({ RegisteredUserService: {} }));
vi.mock('@/lib/workflow-templates', () => ({ WORKFLOW_TEMPLATES_PERMISSION: {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import userRouter from '../src/routers/user.router';
import { responseHelper } from '../src/middlewares/response';

const responseSchema = z.object({
    code: z.number(),
    data: z.object({
        id: z.number(),
        name: z.string(),
        profileStale: z.boolean(),
        profileRefreshTaskId: z.string().nullable()
    })
});

let server: Server;
let origin: string;

beforeAll(async () => {
    const app = new Koa();
    app.use(responseHelper);
    app.use(userRouter.routes());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback port');
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
});

beforeEach(() => {
    vi.resetAllMocks();
    fixtures.getUser.mockResolvedValue({
        id: 42,
        name: 'Stored profile',
        color: 'Gray',
        ccfLevel: 0,
        xcpcLevel: 0,
        slogan: null,
        introduction: null,
        prizes: [],
        profileFetchedAt: new Date('2020-01-01T00:00:00Z'),
        createdAt: new Date('2020-01-01T00:00:00Z'),
        updatedAt: new Date('2020-01-01T00:00:00Z')
    });
    fixtures.isStale.mockReturnValue(true);
    fixtures.createTask.mockResolvedValue({ id: 'task0001' });
    fixtures.dispatchTask.mockResolvedValue(undefined);
});

describe('public profile refresh state', () => {
    it('keeps stored stale data readable without claiming a running refresh when queue submission fails', async () => {
        fixtures.dispatchTask.mockRejectedValue(new Error('Queue unavailable'));
        const response = await fetch(`${origin}/user/query/42`);
        expect(response.status).toBe(200);
        const body = responseSchema.parse(await response.json());
        expect(body.code).toBe(200);
        expect(body.data).toEqual({
            id: 42,
            name: 'Stored profile',
            profileStale: true,
            profileRefreshTaskId: null
        });
    });

    it('does not start another upstream refresh for fresh stored data', async () => {
        fixtures.isStale.mockReturnValue(false);
        const response = await fetch(`${origin}/user/query/42`);
        const body = responseSchema.parse(await response.json());
        expect(body.code).toBe(200);
        expect(body.data.profileStale).toBe(false);
        expect(body.data.profileRefreshTaskId).toBeNull();
        expect(fixtures.createTask).not.toHaveBeenCalled();
        expect(fixtures.dispatchTask).not.toHaveBeenCalled();
    });
});
