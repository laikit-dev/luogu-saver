import { Job, UnrecoverableError } from 'bullmq';
import type {
    ChildrenValues,
    RagTask,
    TaskCommonResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { llm } from '@/lib/llm';
import { logger } from '@/lib/logger';

const MAX_QUERIES = 5;

export class RagPlanQueriesHandler implements TaskHandler<RagTask> {
    public taskType = 'rag:plan_queries';

    public async handle(
        _task: RagTask,
        job: Job<RagTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;
        if (shouldSkip(childrenValues)) return { skipNextStep: true, data: { queries: [] } };

        const originalQuery = extractUpsteamData(
            childrenValues,
            data => typeof data.text === 'string' && data.text.trim().length > 0,
            job.id
        )?.text?.trim();

        if (!originalQuery) {
            throw new UnrecoverableError(`No original query found for RAG planning job ${job.id}`);
        }

        try {
            const plannedQueries = await this.requestPlannedQueries(originalQuery);
            return {
                skipNextStep: false,
                data: {
                    queries: this.normalizeQueries(originalQuery, plannedQueries)
                }
            };
        } catch (error) {
            logger.error(
                { error, jobId: job.id },
                'Failed to plan RAG queries; using original query'
            );
            return {
                skipNextStep: false,
                data: {
                    queries: [originalQuery]
                }
            };
        }
    }

    private async requestPlannedQueries(originalQuery: string): Promise<string[]> {
        const prompt = `
<prompt>
You are a retrieval query planner for a Chinese competitive-programming archive.
Given the user's question, produce retrieval texts that improve recall.
Rules:
- Return only JSON.
- JSON schema: {"queries":["query 1","query 2"]}
- Generate at most 4 alternative retrieval texts.
- The retrieval texts may be short keyword phrases or longer natural-language descriptions.
- Prefer useful search intent descriptions over over-compressed single words when context is needed.
- Include Chinese terms, English technical terms, synonyms, likely article keywords, and related algorithm names when useful.
- Do not answer the question.
</prompt>
<question>
${originalQuery}
</question>
        `;

        const result = await llm.chat(
            [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            'chat'
        );

        return this.parseQueries(result.content || '');
    }

    private parseQueries(content: string): string[] {
        const jsonText = this.extractJsonObject(content);
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed.queries)) {
            throw new Error('Planned query response does not contain queries array');
        }
        return parsed.queries;
    }

    private extractJsonObject(content: string): string {
        const trimmed = content.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) return fenced[1].trim();

        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

        throw new Error('No JSON object found in planned query response');
    }

    private normalizeQueries(originalQuery: string, plannedQueries: unknown[]): string[] {
        const queries: string[] = [];
        const seen = new Set<string>();

        for (const query of [originalQuery, ...plannedQueries]) {
            if (typeof query !== 'string') continue;
            const normalized = query.trim();
            if (!normalized) continue;
            const key = normalized.toLocaleLowerCase();
            if (seen.has(key)) continue;
            queries.push(normalized);
            seen.add(key);
            if (queries.length >= MAX_QUERIES) break;
        }

        return queries.length ? queries : [originalQuery];
    }
}
