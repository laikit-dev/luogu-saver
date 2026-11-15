import OpenAI from 'openai';
import { Job, UnrecoverableError } from 'bullmq';
import type {
    ChildrenValues,
    RagTask,
    TaskCommonResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { shouldSkip } from '@/workers/helpers/common.helper';
import { llm } from '@/lib/llm';
import { SearchService } from '@/services/search.service';
import { ArticleService } from '@/services/article.service';
import { clampInt } from '@/utils/number';
import { normalizeErrorReason } from '@/utils/error-reason';
import { logger } from '@/lib/logger';

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 8;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_READ_CHARS = 1800;

type ToolCallSummary = {
    name: string;
    arguments: Record<string, unknown>;
    status: 'ok' | 'error';
    resultCount?: number;
    articleId?: string;
    error?: string;
};

type ToolExecutionResult = {
    payload: Record<string, unknown>;
    summary: ToolCallSummary;
};

const RAG_ANSWER_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'keyword_search',
            description:
                'Search archived Luogu articles by keyword, algorithm name, title, summary, author name, or tags.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query text.'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 5,
                        description: 'Maximum number of search results. Defaults to 5.'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_article',
            description:
                'Read one archived article by ID when a search result or initial context needs more detail.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: {
                        type: 'string',
                        description: 'Article ID.'
                    },
                    maxChars: {
                        type: 'integer',
                        minimum: 500,
                        maximum: 3000,
                        description: 'Maximum content characters to return. Defaults to 1800.'
                    }
                },
                required: ['id']
            }
        }
    }
];

export class RagAnswerHandler implements TaskHandler<RagTask> {
    public taskType = 'rag:answer';

    public async handle(
        _task: RagTask,
        job: Job<RagTask>
    ): Promise<WorkflowResult<TaskCommonResult>> {
        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;
        if (shouldSkip(childrenValues)) {
            return { skipNextStep: true, data: { text: '', documents: [], toolCalls: [] } };
        }

        const context = Object.values(childrenValues).find(
            value => typeof value?.data?.text === 'string'
        )?.data;
        if (!context?.text) throw new UnrecoverableError(`No RAG context found for job ${job.id}`);

        const answer = await this.answerWithTools(context, job.id);

        return {
            skipNextStep: false,
            data: {
                text: answer.text,
                documents: context.documents || [],
                toolCalls: answer.toolCalls
            }
        };
    }

    private async answerWithTools(context: any, jobId?: string) {
        const messages = this.buildInitialMessages(context);
        const toolCalls: ToolCallSummary[] = [];
        let executedToolCalls = 0;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const response = await llm.chat(messages, 'answer', {
                tools: RAG_ANSWER_TOOLS,
                toolChoice: 'auto'
            });
            const assistantMessage = response.raw.choices[0]?.message;
            const requestedToolCalls = assistantMessage?.tool_calls || [];

            if (!assistantMessage || requestedToolCalls.length === 0) {
                return {
                    text: assistantMessage?.content || '',
                    toolCalls
                };
            }

            messages.push({
                role: 'assistant',
                content: assistantMessage.content || null,
                tool_calls: requestedToolCalls
            } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

            for (const toolCall of requestedToolCalls) {
                if (executedToolCalls >= MAX_TOOL_CALLS) {
                    messages.push(
                        this.toToolMessage(toolCall.id, {
                            ok: false,
                            error: 'Tool call limit reached'
                        })
                    );
                    continue;
                }

                const execution = await this.executeToolCall(toolCall);
                executedToolCalls += 1;
                toolCalls.push(execution.summary);
                messages.push(this.toToolMessage(toolCall.id, execution.payload));
            }
        }

        logger.info({ jobId, toolCalls: toolCalls.length }, 'RAG tool-call rounds exhausted');
        messages.push({
            role: 'user',
            content:
                '工具调用轮次已结束。请基于初始材料和已经返回的工具结果给出最终答案，不要再调用工具。'
        });

        const response = await llm.chat(messages, 'answer');
        return {
            text: response.content || '',
            toolCalls
        };
    }

    private buildInitialMessages(
        context: any
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return [
            {
                role: 'system',
                content: `You are a retrieval-augmented question answering assistant.
Answer in Chinese.
Use Markdown.
All inline math MUST be enclosed as $formula$.
All display math MUST be enclosed as $$formula$$.
Do not use backslash-parenthesis math delimiters, backslash-bracket math delimiters, or bare LaTeX environments.
Do not write prefaces such as "下面根据已有材料" or "需要说明".
Do not invite the user to ask follow-up questions. There is no multi-turn user conversation.
You may call tools when the initial context is insufficient, ambiguous, or needs verification.
Base the final answer only on the initial context documents and tool results.
If the answer cannot be determined from the documents or tool results at all, write exactly: "现有材料无法确定。"
At the end, list cited article titles and IDs from the documents or tool results you used.
Do not reveal hidden reasoning or chain-of-thought text. Return only the final answer content.`
            },
            {
                role: 'user',
                content: `<initial_context>
${context.text}
</initial_context>`
            }
        ];
    }

    private async executeToolCall(
        toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
    ): Promise<ToolExecutionResult> {
        if (toolCall.type !== 'function') {
            return this.toolError('unsupported_tool_call', {}, 'Unsupported tool call type');
        }

        const name = toolCall.function.name;
        const args = this.parseToolArguments(toolCall.function.arguments);

        try {
            if (name === 'keyword_search') return await this.keywordSearch(args);
            if (name === 'read_article') return await this.readArticle(args);

            return this.toolError(name, args, `Unknown tool: ${name}`);
        } catch (error) {
            return this.toolError(name, args, normalizeErrorReason(error));
        }
    }

    private async keywordSearch(args: Record<string, unknown>): Promise<ToolExecutionResult> {
        const query = String(args.query || '').trim();
        if (!query) return this.toolError('keyword_search', args, 'query is required');

        const limit = clampInt(args.limit, DEFAULT_SEARCH_LIMIT, 1, 5);
        const result = await SearchService.searchArticles({ q: query, page: 1, limit });
        const hits = result.hits.map((hit: any) => ({
            id: hit.id,
            title: hit.title,
            summary: this.truncate(this.stripHtml(hit.summary || ''), 360),
            authorName: hit.authorName || '',
            category: hit.category,
            tags: Array.isArray(hit.tags) ? hit.tags.slice(0, 10) : [],
            viewCount: hit.viewCount,
            updatedAt: hit.updatedAt
        }));

        return {
            payload: {
                ok: true,
                tool: 'keyword_search',
                query,
                hits,
                total: result.total
            },
            summary: {
                name: 'keyword_search',
                arguments: { query, limit },
                status: 'ok',
                resultCount: hits.length
            }
        };
    }

    private async readArticle(args: Record<string, unknown>): Promise<ToolExecutionResult> {
        const id = String(args.id || '').trim();
        if (!id) return this.toolError('read_article', args, 'id is required');

        const maxChars = clampInt(args.maxChars, DEFAULT_READ_CHARS, 500, 3000);
        const article = await ArticleService.getArticleByIdWithoutCache(id);
        if (!article || article.deleted) {
            return this.toolError('read_article', { id, maxChars }, 'Article not found');
        }

        return {
            payload: {
                ok: true,
                tool: 'read_article',
                article: {
                    id: article.id,
                    title: article.title,
                    summary: article.summary || '',
                    authorName: article.author?.name || '',
                    category: article.category,
                    tags: article.tags || [],
                    content: this.truncate(article.content || '', maxChars)
                }
            },
            summary: {
                name: 'read_article',
                arguments: { id, maxChars },
                status: 'ok',
                articleId: article.id
            }
        };
    }

    private toolError(
        name: string,
        args: Record<string, unknown>,
        error: string
    ): ToolExecutionResult {
        return {
            payload: {
                ok: false,
                tool: name,
                error
            },
            summary: {
                name,
                arguments: args,
                status: 'error',
                error
            }
        };
    }

    private toToolMessage(
        toolCallId: string,
        payload: Record<string, unknown>
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
        return {
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(payload)
        };
    }

    private parseToolArguments(raw: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(raw || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    private truncate(text: string, maxCodePoints: number) {
        const chars = Array.from(text || '');
        if (chars.length <= maxCodePoints) return text || '';
        return `${chars.slice(0, maxCodePoints).join('')}...`;
    }

    private stripHtml(text: string) {
        return text.replace(/<[^>]*>/g, '');
    }
}
