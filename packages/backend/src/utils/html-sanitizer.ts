import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'code',
    'pre',
    'blockquote',
    'hr',
    'ul',
    'ol',
    'li',
    'a',
    'span',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'img'
];

const NON_TEXT_TAGS = [
    'script',
    'style',
    'textarea',
    'option',
    'noscript',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'form',
    'input',
    'button',
    'select',
    'meta',
    'link',
    'base'
];

function isSafeUrl(value: string, allowedProtocols: readonly string[]): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
    try {
        const parsed = new URL(trimmed);
        return allowedProtocols.includes(parsed.protocol);
    } catch {
        return false;
    }
}

/**
 * Sanitizes admin-authored site HTML (announcements and notifications) against a strict allowlist.
 */
export function sanitizeSiteHtml(raw: unknown): string {
    const input = String(raw ?? '');
    if (!input) return '';

    return sanitizeHtml(input, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: {
            a: ['href', 'title', 'target', 'rel'],
            img: ['src', 'alt', 'title', 'width', 'height'],
            th: ['colspan', 'rowspan', 'align'],
            td: ['colspan', 'rowspan', 'align']
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowedSchemesByTag: {
            a: ['http', 'https', 'mailto'],
            img: ['http', 'https']
        },
        allowProtocolRelative: false,
        disallowedTagsMode: 'discard',
        nonTextTags: NON_TEXT_TAGS,
        transformTags: {
            a(tagName, attribs) {
                const next: Record<string, string> = {};
                if (attribs.href && isSafeUrl(attribs.href, ['http:', 'https:', 'mailto:'])) {
                    next.href = attribs.href.trim();
                }
                if (attribs.title !== undefined) next.title = attribs.title;
                if (attribs.target === '_blank') {
                    next.target = '_blank';
                    next.rel = 'noopener noreferrer';
                } else if (attribs.rel !== undefined) {
                    next.rel = attribs.rel;
                }
                return { tagName, attribs: next };
            },
            img(tagName, attribs) {
                const next: Record<string, string> = {};
                if (attribs.src && isSafeUrl(attribs.src, ['http:', 'https:'])) {
                    next.src = attribs.src.trim();
                }
                if (attribs.alt !== undefined) next.alt = attribs.alt;
                if (attribs.title !== undefined) next.title = attribs.title;
                if (attribs.width !== undefined) next.width = attribs.width;
                if (attribs.height !== undefined) next.height = attribs.height;
                return { tagName, attribs: next };
            }
        }
    });
}
