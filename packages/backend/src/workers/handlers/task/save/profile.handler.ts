import { UnrecoverableError } from 'bullmq';

import type { SaveTask } from '@/shared/task';
import { fetch } from '@/utils/fetch';
import { C3vkMode } from '@/shared/c3vk';
import type { LentilleDataResponse, UserData } from '@/types/luogu-api';
import { UserService } from '@/services/user.service';
import { logger } from '@/lib/logger';
import { emitToRoom } from '@/lib/socket';
import { TaskHandler, TaskTextResult, WorkflowResult } from '@/workers/types';
import { UserColor, UserPrize } from '@/shared/user';

export class ProfileHandler implements TaskHandler<SaveTask> {
    public taskType = 'save:profile';

    public async handle(task: SaveTask): Promise<WorkflowResult<TaskTextResult>> {
        const rawTargetId = task.payload.targetId;
        if (typeof rawTargetId !== 'string' || !/^[1-9]\d*$/.test(rawTargetId)) {
            throw new UnrecoverableError(
                `Invalid profile targetId: ${JSON.stringify(rawTargetId)}`
            );
        }
        const uid = Number(rawTargetId);
        if (!Number.isInteger(uid) || uid < 1 || uid > 4294967295) {
            throw new UnrecoverableError(
                `Invalid profile targetId: ${JSON.stringify(rawTargetId)}`
            );
        }

        const url = `https://www.luogu.com/user/${uid}`;
        const resp: LentilleDataResponse<UserData> = await fetch(url, C3vkMode.MODERN);

        const userData = resp?.data?.user;
        if (!userData || typeof userData !== 'object' || userData.uid !== uid) {
            throw new UnrecoverableError(`Profile response shape invalid for uid=${uid}`);
        }

        // Luogu user-page response shape (verified against live luogu.com.cn 2026-05):
        //   resp.data.prizes : Array<{ prize: { year, contest, event, prize, score?, rank? } }>
        // Each entry is wrapped in a one-level `prize` object that we must unwrap.
        // The `resp.data.user.prize` field, despite its name, is unrelated and may be empty.
        const rawPrizes = (resp.data as { prizes?: unknown }).prizes;
        const prizes: UserPrize[] = Array.isArray(rawPrizes)
            ? rawPrizes
                  .map(entry => {
                      const inner =
                          entry && typeof entry === 'object'
                              ? ((entry as { prize?: unknown }).prize ?? entry)
                              : null;
                      return inner;
                  })
                  .filter(
                      (p): p is UserPrize =>
                          !!p &&
                          typeof p === 'object' &&
                          typeof (p as UserPrize).year === 'number' &&
                          typeof (p as UserPrize).contest === 'string' &&
                          typeof (p as UserPrize).prize === 'string'
                  )
                  .map(p => ({
                      year: p.year,
                      contest: p.contest,
                      event: typeof p.event === 'string' ? p.event : null,
                      prize: p.prize,
                      ...(typeof p.score === 'number' ? { score: p.score } : {}),
                      ...(typeof p.rank === 'number' ? { rank: p.rank } : {})
                  }))
            : [];

        const rawSlogan = (userData as { slogan?: unknown }).slogan;
        const slogan = typeof rawSlogan === 'string' && rawSlogan.length > 0 ? rawSlogan : null;
        const rawIntro = (userData as { introduction?: unknown }).introduction;
        const introduction = typeof rawIntro === 'string' && rawIntro.length > 0 ? rawIntro : null;
        const result = await UserService.saveLuoguUserProfile({
            uid: userData.uid,
            name: userData.name,
            color: userData.color as UserColor,
            ccfLevel: userData.ccfLevel ?? 0,
            xcpcLevel: userData.xcpcLevel ?? 0,
            slogan,
            introduction,
            prizes
        });

        if (!result.changed && !result.recorded) {
            logger.info({ uid }, 'Profile content and retained history unchanged, skipping update');
            return { skipNextStep: true, data: { text: '' } };
        }

        emitToRoom(`user_${uid}`, `user:${uid}:profile-updated`);
        logger.info({ uid, prizeCount: prizes.length, recorded: result.recorded }, 'Profile saved');

        // The text payload mirrors the contract of save:article / save:paste: emit
        // whatever raw textual content was saved so downstream LLM steps (if any
        // are wired up later — currently profile is single-step) can consume it.
        // Slogan is omitted because of low signal value; prize structure is JSON-only.
        return {
            skipNextStep: false,
            data: {
                text: introduction ?? ''
            }
        };
    }
}
