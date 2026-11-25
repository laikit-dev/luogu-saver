import DOMPurify from 'dompurify';

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

const FORBID_TAGS = [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'meta',
    'link',
    'base'
];

const ALLOWED_ATTRS_BY_TAG: Record<string, Record<string, true>> = {
    a: { href: true, title: true, target: true, rel: true },
    img: { src: true, alt: true, title: true, width: true, height: true },
    th: { colspan: true, rowspan: true, align: true },
    td: { colspan: true, rowspan: true, align: true }
};

const ALLOWED_ATTR = [
    'href',
    'title',
    'target',
    'rel',
    'src',
    'alt',
    'width',
    'height',
    'colspan',
    'rowspan',
    'align'
];

let hookInstalled = false;

export function isSafeHttpUrl(
    value: string | null | undefined,
    options: { allowRelative?: boolean; allowMailto?: boolean } = {}
): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (options.allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        return true;
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
        if (options.allowMailto && parsed.protocol === 'mailto:') return true;
        return false;
    } catch {
        return false;
    }
}

function ensureSanitizerHook() {
    if (hookInstalled || !DOMPurify.isSupported) return;
    hookInstalled = true;

    DOMPurify.addHook('afterSanitizeAttributes', node => {
        if (!(node instanceof Element)) return;
        const tag = node.tagName.toLowerCase();
        const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_ATTRS_BY_TAG, tag)
            ? ALLOWED_ATTRS_BY_TAG[tag]
            : undefined;

        for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            if (!allowed || !Object.prototype.hasOwnProperty.call(allowed, name)) {
                node.removeAttribute(attr.name);
            }
        }

        if (tag === 'a') {
            const href = node.getAttribute('href');
            if (href !== null && !isSafeHttpUrl(href, { allowRelative: true, allowMailto: true })) {
                node.removeAttribute('href');
            }
            const target = node.getAttribute('target');
            if (target === '_blank') {
                node.setAttribute('rel', 'noopener noreferrer');
            } else if (target !== null) {
                node.removeAttribute('target');
            }
        }

        if (tag === 'img') {
            const src = node.getAttribute('src');
            if (src !== null && !isSafeHttpUrl(src, { allowRelative: true })) {
                node.removeAttribute('src');
            }
        }
    });
}

/**
 * Sanitizes rich site HTML (announcements, notifications, and admin previews) before `v-html`.
 */
export function sanitizeRichHtml(raw: string | null | undefined): string {
    if (!raw) return '';
    ensureSanitizerHook();
    return DOMPurify.sanitize(raw, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        FORBID_TAGS,
        FORBID_ATTR: ['style', 'id', 'name'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        RETURN_TRUSTED_TYPE: false
    });
}
