export type MarkdownWorkerRequest = {
    id: number;
    markdown: string;
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
