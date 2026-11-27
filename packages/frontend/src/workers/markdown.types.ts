import type { RenderMarkdownOptions } from '@luogu-saver-next/markdown-renderer';

export type MarkdownWorkerRequest = {
    id: number;
    markdown: string;
    options?: RenderMarkdownOptions;
};

export type MarkdownWorkerResponse =
    | {
          id: number;
          html: string;
      }
    | {
          id: number;
          error: string;
      };
