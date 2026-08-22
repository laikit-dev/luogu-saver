import { Cacheable } from '@/decorators/cacheable';
import renderMarkdown from '@/lib/markdown';

export class RendererService {
     
    @Cacheable(60 * 60 * 24 * 30, (_, identifier: string) => `markdown:${identifier}`)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    static async renderMarkdown(content: string, _: string): Promise<string> {
        return renderMarkdown(content);
    }
}
