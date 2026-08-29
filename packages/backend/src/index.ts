import Koa from 'koa';
import bodyParser from 'koa-bodyparser';

import { config } from './config';
import { AppDataSource } from './data-source';

import router from './routers';
import { logger } from './lib/logger';

import { authorization } from '@/middlewares/authorization';
import { tracking } from './middlewares/tracking';
import { responseHelper } from './middlewares/response';
import { accessLog } from '@/middlewares/access-log';
import { apiRateLimit } from '@/middlewares/api-rate-limit';
import * as worker from '@/workers';
import { initSocket } from './lib/socket';
import http from 'http';
import { socketJoinHandler } from '@/socket';
import { DatabasePoolMonitor } from '@/services/database-pool-monitor.service';
import { JudgementSyncScheduler } from '@/services/judgement-sync-scheduler.service';

const app = new Koa({ proxy: true, proxyIpHeader: 'CF-Connecting-IP' });
const server = http.createServer(app.callback());
initSocket(server, socketJoinHandler);

app.use(accessLog);
app.use(responseHelper);
app.use(authorization);
app.use(apiRateLimit);
app.use(bodyParser());
app.use(tracking);
app.use(router.routes()).use(router.allowedMethods());

AppDataSource.initialize().then(async () => {
    DatabasePoolMonitor.start(AppDataSource);
    await worker.bootstrap();
    JudgementSyncScheduler.start();
    server.listen(config.port, config.host, () => {
        logger.info({ host: config.host, port: config.port }, `Server started.`);
    });
});
