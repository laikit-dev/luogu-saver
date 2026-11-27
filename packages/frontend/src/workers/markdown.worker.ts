import renderMarkdown from '@luogu-saver-next/markdown-renderer/worker';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from './markdown.types';

type MarkdownWorkerScope = {
    addEventListener(
        type: 'message',
        listener: (event: MessageEvent<MarkdownWorkerRequest>) => void
    ): void;
    postMessage(message: MarkdownWorkerResponse): void;
};

const workerScope = self as unknown as MarkdownWorkerScope;

workerScope.addEventListener('message', async event => {
    const { id, markdown, options } = event.data;
    try {
        workerScope.postMessage({ id, html: await renderMarkdown(markdown, options) });
    } catch (error) {
        workerScope.postMessage({
            id,
            error: error instanceof Error ? error.message : 'Markdown render failed'
        });
    }
});
