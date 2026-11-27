export type InSiteLinkKind = 'user' | 'article' | 'paste';
export type ExternalLuoguLinkKind =
    | 'problem'
    | 'training'
    | 'contest'
    | 'discuss'
    | 'team'
    | 'record';
export type EnhancedLinkKind = InSiteLinkKind | ExternalLuoguLinkKind;

export interface ParsedEnhancedLink {
    kind: EnhancedLinkKind;
    id: string;
    numericId?: number;
    inSitePath: string | null;
    canonicalHref: string;
    defaultLabel: string;
}

export type TextLinkSegment =
    | { type: 'text'; text: string }
    | { type: 'link'; rawUrl: string; trailing: string; parsed: ParsedEnhancedLink | null };

const UINT32_MAX = 4_294_967_295;
const LID_RE = /^[A-Za-z0-9]{1,8}$/;
const PROBLEM_ID_RE = /^[A-Za-z0-9_]{1,32}$/;
const DIGITS_RE = /^\d+$/;
const LUOGU_HOSTS = new Set([
    'luogu.com.cn',
    'www.luogu.com.cn',
    'luogu.com',
    'www.luogu.com',
    'luogu.me',
    'www.luogu.me'
]);

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)'"\]}>，。；：！？）》」』】]+$/;

function getRuntimeOrigin(explicitOrigin?: string): string {
    if (explicitOrigin) return explicitOrigin;
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }
    return 'https://luogu.saver.local';
}

function isSupportedHost(hostname: string, baseOrigin: string): boolean {
    const lower = hostname.toLowerCase();
    if (LUOGU_HOSTS.has(lower)) return true;
    try {
        return new URL(baseOrigin).hostname.toLowerCase() === lower;
    } catch {
        return false;
    }
}

export function parseEnhancedLink(
    rawHref: string,
    explicitOrigin?: string
): ParsedEnhancedLink | null {
    const trimmed = rawHref.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    // Protocol-less shorthand schemes (mailto:, javascript:, etc.) should never be parsed as Luogu paths.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:/i.test(trimmed)) {
        return null;
    }

    const baseOrigin = getRuntimeOrigin(explicitOrigin);
    let url: URL;
    try {
        url = new URL(trimmed, baseOrigin);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const isRelativeInput = trimmed.startsWith('/') && !trimmed.startsWith('//');
    if (!isRelativeInput && !isSupportedHost(url.hostname, baseOrigin)) return null;

    const cleanPath = url.pathname.replace(/\/+$/, '') || '/';
    const suffix = `${url.search}${url.hash}`;

    if (cleanPath === '/space/show') {
        const uidRaw = url.searchParams.get('uid');
        if (uidRaw && DIGITS_RE.test(uidRaw)) {
            const uid = Number(uidRaw);
            if (Number.isInteger(uid) && uid >= 1 && uid <= UINT32_MAX) {
                return {
                    kind: 'user',
                    id: uidRaw,
                    numericId: uid,
                    inSitePath: `/user/${uid}`,
                    canonicalHref: `/user/${uid}`,
                    defaultLabel: `用户 ${uid}`
                };
            }
        }
        return null;
    }

    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length !== 2) return null;

    const [prefix, id] = parts;
    if (!prefix || !id) return null;

    if (prefix === 'user' && DIGITS_RE.test(id)) {
        const uid = Number(id);
        if (Number.isInteger(uid) && uid >= 1 && uid <= UINT32_MAX) {
            const path = `/user/${uid}${suffix}`;
            return {
                kind: 'user',
                id: String(uid),
                numericId: uid,
                inSitePath: path,
                canonicalHref: path,
                defaultLabel: `用户 ${uid}`
            };
        }
        return null;
    }

    if (prefix === 'article' && LID_RE.test(id)) {
        const path = `/article/${id}${suffix}`;
        return {
            kind: 'article',
            id,
            inSitePath: path,
            canonicalHref: path,
            defaultLabel: `文章 ${id}`
        };
    }

    if (prefix === 'paste' && LID_RE.test(id)) {
        const path = `/paste/${id}${suffix}`;
        return {
            kind: 'paste',
            id,
            inSitePath: path,
            canonicalHref: path,
            defaultLabel: `剪贴板 ${id}`
        };
    }

    const externalMap: Record<
        string,
        { kind: ExternalLuoguLinkKind; pattern: RegExp; prefixLabel: string }
    > = {
        problem: { kind: 'problem', pattern: PROBLEM_ID_RE, prefixLabel: '' },
        training: { kind: 'training', pattern: DIGITS_RE, prefixLabel: '题单 #' },
        contest: { kind: 'contest', pattern: DIGITS_RE, prefixLabel: '比赛 #' },
        discuss: { kind: 'discuss', pattern: DIGITS_RE, prefixLabel: '讨论 #' },
        team: { kind: 'team', pattern: DIGITS_RE, prefixLabel: '团队 #' },
        record: { kind: 'record', pattern: DIGITS_RE, prefixLabel: '记录 #' }
    };

    const ext = externalMap[prefix];
    if (ext && ext.pattern.test(id)) {
        return {
            kind: ext.kind,
            id,
            inSitePath: null,
            canonicalHref: `https://www.luogu.com.cn/${prefix}/${id}${suffix}`,
            defaultLabel: `${ext.prefixLabel}${id}`
        };
    }

    return null;
}

export function isBareOrIdLinkText(
    rawText: string,
    rawHref: string,
    parsed: ParsedEnhancedLink
): boolean {
    const text = rawText.trim();
    if (!text) return true;
    const normalizedHref = rawHref.trim().replace(/\/+$/, '');
    const normalizedText = text.replace(/\/+$/, '');
    if (normalizedText === normalizedHref || /^https?:\/\//i.test(text)) return true;
    if (normalizedText === parsed.id) return true;
    if (parsed.inSitePath && normalizedText === parsed.inSitePath.replace(/\/+$/, '')) return true;
    if (parsed.kind === 'user') {
        if (
            normalizedText === `uid=${parsed.id}` ||
            normalizedText.toLowerCase() === `uid ${parsed.id}` ||
            normalizedText === `@${parsed.id}`
        ) {
            return true;
        }
    }
    return false;
}

export function splitTextWithEnhancedLinks(text: string): TextLinkSegment[] {
    if (!text) return [];
    const segments: TextLinkSegment[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(URL_IN_TEXT_RE)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
            segments.push({ type: 'text', text: text.slice(lastIndex, index) });
        }

        const matched = match[0];
        let rawUrl = matched;
        let trailing = '';

        // Preserve balanced closing parenthesis when a URL itself ends with `)`.
        const punctMatch = matched.match(TRAILING_PUNCT_RE);
        if (punctMatch) {
            let candidateTrailing = punctMatch[0];
            let candidateUrl = matched.slice(0, matched.length - candidateTrailing.length);
            while (
                candidateTrailing.startsWith(')') &&
                (candidateUrl.match(/\(/g)?.length ?? 0) > (candidateUrl.match(/\)/g)?.length ?? 0)
            ) {
                candidateUrl += ')';
                candidateTrailing = candidateTrailing.slice(1);
            }
            rawUrl = candidateUrl;
            trailing = candidateTrailing;
        }

        if (rawUrl) {
            segments.push({
                type: 'link',
                rawUrl,
                trailing,
                parsed: parseEnhancedLink(rawUrl)
            });
        } else {
            segments.push({ type: 'text', text: matched });
        }

        lastIndex = index + matched.length;
    }

    if (lastIndex < text.length) {
        segments.push({ type: 'text', text: text.slice(lastIndex) });
    }
    return segments;
}
