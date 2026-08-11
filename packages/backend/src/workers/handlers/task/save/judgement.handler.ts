import axios from 'axios';
import { UnrecoverableError } from 'bullmq';
import { config } from '@/config';
import type { SaveTask } from '@/shared/task';
import { logger } from '@/lib/logger';
import {
    JudgementService,
    type JudgementFetchedResult,
    type JudgementSyncResult
} from '@/services/judgement.service';
import { LuoguJudgementResponseSchema } from '@/shared/judgement';
import { normalizeErrorReason } from '@/utils/error-reason';
import type { TaskHandler, WorkflowResult } from '@/workers/types';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const LUOGU_JUDGEMENT_URL = 'https://www.luogu.com.cn/judgement';

function upstreamFailure(error: unknown): Error {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const code = typeof error.code === 'string' ? error.code : undefined;
        return new Error(
            status
                ? `Luogu judgement request failed with HTTP ${status}`
                : `Luogu judgement request failed${code ? ` (${code})` : ''}`
        );
    }
    return new Error('Luogu judgement request failed');
}

export class JudgementHandler implements TaskHandler<SaveTask> {
    public taskType = 'save:judgement';

    public async handle(task: SaveTask): Promise<WorkflowResult<JudgementSyncResult>> {
        if (task.payload.targetId !== 'latest') {
            throw new UnrecoverableError('Judgement targetId must be latest');
        }

        try {
            const upstream = await this.fetchFromLuogu();
            return {
                skipNextStep: false,
                data: await JudgementService.persistFetchedResult(upstream)
            };
        } catch (error) {
            const reason = normalizeErrorReason(error);
            try {
                await JudgementService.recordFetchFailure(reason);
            } catch (logError) {
                logger.error(
                    { reason: normalizeErrorReason(logError) },
                    'Failed to persist judgement synchronization error log'
                );
            }
            logger.error({ reason }, 'Judgement synchronization failed');
            throw new Error(reason);
        }
    }

    private async fetchFromLuogu(): Promise<JudgementFetchedResult> {
        try {
            const response = await axios.get<unknown>(LUOGU_JUDGEMENT_URL, {
                timeout: config.network.timeout,
                maxRedirects: 0,
                maxContentLength: MAX_RESPONSE_BYTES,
                maxBodyLength: MAX_RESPONSE_BYTES,
                decompress: true,
                validateStatus: status => status >= 200 && status < 300,
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                    Referer: 'https://www.luogu.com.cn/judgement',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const parsed = LuoguJudgementResponseSchema.safeParse(response.data);
            if (!parsed.success) throw new Error('Luogu judgement response validation failed');
            return { data: parsed.data, rawResponse: JSON.stringify(response.data) };
        } catch (error) {
            if (error instanceof Error && error.message.includes('validation failed')) throw error;
            throw upstreamFailure(error);
        }
    }
}
