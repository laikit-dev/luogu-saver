import workerAssetUrl from '@/workers/markdown.worker.ts?worker&url';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from '@/workers/markdown.types';

type PendingRender = {
    resolve(html: string): void;
    reject(error: Error): void;
    timer: number;
};

const RENDER_TIMEOUT_MS = 10_000;

let markdownWorker: Worker | null = null;
let bootstrapUrl: string | null = null;
let nextRequestId = 1;
const pendingRenders = new Map<number, PendingRender>();

function rejectPendingRenders(error: Error) {
    for (const pending of pendingRenders.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(error);
    }
    pendingRenders.clear();
}
function disposeWorker(error: Error) {
    markdownWorker?.terminate();
    markdownWorker = null;
    if (bootstrapUrl) URL.revokeObjectURL(bootstrapUrl);
    bootstrapUrl = null;
    rejectPendingRenders(error);
}

function handleWorkerMessage(event: MessageEvent<MarkdownWorkerResponse>) {
    const response = event.data;
    const pending = pendingRenders.get(response.id);
    if (!pending) return;

    window.clearTimeout(pending.timer);
    pendingRenders.delete(response.id);
    if ('html' in response) pending.resolve(response.html);
    else pending.reject(new Error(response.error));
}

function getMarkdownWorker() {
    if (markdownWorker) return markdownWorker;

    const absoluteWorkerUrl = new URL(workerAssetUrl, document.baseURI).href;
    bootstrapUrl = URL.createObjectURL(
        new Blob([`import ${JSON.stringify(absoluteWorkerUrl)};`], {
            type: 'text/javascript'
        })
    );
    markdownWorker = new Worker(bootstrapUrl, {
        name: 'markdown-renderer',
        type: 'module'
    });
    markdownWorker.addEventListener('message', handleWorkerMessage);
    markdownWorker.addEventListener('error', event => {
        disposeWorker(new Error(event.message || 'Markdown worker failed'));
    });
    markdownWorker.addEventListener('messageerror', () => {
        disposeWorker(new Error('Markdown worker returned an invalid message'));
    });
    return markdownWorker;
}

export function renderMarkdown(markdown: string) {
    const id = nextRequestId++;
    const request: MarkdownWorkerRequest = { id, markdown };

    return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            if (!pendingRenders.has(id)) return;
            disposeWorker(new Error('Markdown rendering timed out'));
        }, RENDER_TIMEOUT_MS);
        pendingRenders.set(id, { reject, resolve, timer });
        try {
            getMarkdownWorker().postMessage(request);
        } catch (error) {
            window.clearTimeout(timer);
            pendingRenders.delete(id);
            reject(error instanceof Error ? error : new Error('Markdown worker failed to start'));
        }
    });
}
