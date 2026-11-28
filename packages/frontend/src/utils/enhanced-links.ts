export type InSiteLinkKind = 'user' | 'article' | 'paste';
export type LuoguExternalLinkKind =
    | 'luogu-problem'
    | 'luogu-training'
    | 'luogu-contest'
    | 'luogu-discuss'
    | 'luogu-team'
    | 'luogu-record'
    | 'luogu-other';
export type KnownOjKind =
    | 'codeforces'
    | 'atcoder'
    | 'uoj'
    | 'qoj'
    | 'loj'
    | 'spoj'
    | 'vjudge'
    | 'hydro';
export type EnhancedLinkKind = InSiteLinkKind | LuoguExternalLinkKind | KnownOjKind | 'external';
export type LinkIconGroup = InSiteLinkKind | 'luogu' | KnownOjKind | 'external';

export interface ParsedEnhancedLink {
    kind: EnhancedLinkKind;
    iconGroup: LinkIconGroup;
    id: string;
    numericId?: number;
    inSitePath: string | null;
    canonicalHref: string;
    parsedLabel: string | null;
    matchToken: string | null;
}

export type TextLinkSegment =
    | { type: 'text'; text: string }
    | { type: 'link'; rawUrl: string; trailing: string; parsed: ParsedEnhancedLink | null };

const UINT32_MAX = 4_294_967_295;
const LID_RE = /^[A-Za-z0-9]{1,8}$/;
const PROBLEM_ID_RE = /^[A-Za-z0-9_]{1,32}$/;
const DIGITS_RE = /^\d+$/;
const CF_INDEX_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

const LUOGU_HOSTS = new Set([
    'luogu.com.cn',
    'www.luogu.com.cn',
    'luogu.com',
    'www.luogu.com',
    'luogu.me',
    'www.luogu.me'
]);

const CF_HOSTS = new Set([
    'codeforces.com',
    'www.codeforces.com',
    'codeforces.ml',
    'www.codeforces.ml',
    'mirror.codeforces.com'
]);

const ATCODER_HOSTS = new Set(['atcoder.jp', 'www.atcoder.jp']);
const UOJ_HOSTS = new Set(['uoj.ac', 'www.uoj.ac']);
const QOJ_HOSTS = new Set(['qoj.ac', 'www.qoj.ac']);
const LOJ_HOSTS = new Set(['loj.ac', 'www.loj.ac']);
const SPOJ_HOSTS = new Set(['spoj.com', 'www.spoj.com']);
const VJUDGE_HOSTS = new Set(['vjudge.net', 'www.vjudge.net', 'vjudge.csgrandeur.cn']);
const HYDRO_HOSTS = new Set(['hydro.ac', 'www.hydro.ac']);

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)'"\]}>，。；：！？）》」』】]+$/;

function getRuntimeOrigin(explicitOrigin?: string): string {
    if (explicitOrigin) return explicitOrigin;
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }
    return 'https://luogu.saver.local';
}

function isSameOrigin(hostname: string, baseOrigin: string): boolean {
    try {
        return new URL(baseOrigin).hostname.toLowerCase() === hostname.toLowerCase();
    } catch {
        return false;
    }
}

function parseLuoguPath(
    url: URL
): (Omit<ParsedEnhancedLink, 'iconGroup'> & { iconGroup?: LinkIconGroup }) | null {
    const cleanPath = url.pathname.replace(/\/+$/, '') || '/';
    const suffix = `${url.search}${url.hash}`;

    if (cleanPath === '/space/show') {
        const uidRaw = url.searchParams.get('uid');
        if (uidRaw && DIGITS_RE.test(uidRaw)) {
            const uid = Number(uidRaw);
            if (Number.isInteger(uid) && uid >= 1 && uid <= UINT32_MAX) {
                return {
                    kind: 'user',
                    iconGroup: 'user',
                    id: uidRaw,
                    numericId: uid,
                    inSitePath: `/user/${uid}`,
                    canonicalHref: `/user/${uid}`,
                    parsedLabel: null,
                    matchToken: uidRaw
                };
            }
        }
    }

    const parts = cleanPath.split('/').filter(Boolean);
    const [prefix, id] = parts;

    if (parts.length === 2 && prefix && id) {
        if (prefix === 'user' && DIGITS_RE.test(id)) {
            const uid = Number(id);
            if (Number.isInteger(uid) && uid >= 1 && uid <= UINT32_MAX) {
                const path = `/user/${uid}${suffix}`;
                return {
                    kind: 'user',
                    iconGroup: 'user',
                    id: String(uid),
                    numericId: uid,
                    inSitePath: path,
                    canonicalHref: path,
                    parsedLabel: null,
                    matchToken: String(uid)
                };
            }
        }

        if (prefix === 'article' && LID_RE.test(id)) {
            const path = `/article/${id}${suffix}`;
            return {
                kind: 'article',
                iconGroup: 'article',
                id,
                inSitePath: path,
                canonicalHref: path,
                parsedLabel: null,
                matchToken: id
            };
        }

        if (prefix === 'paste' && LID_RE.test(id)) {
            const path = `/paste/${id}${suffix}`;
            return {
                kind: 'paste',
                iconGroup: 'paste',
                id,
                inSitePath: path,
                canonicalHref: path,
                parsedLabel: null,
                matchToken: id
            };
        }

        const externalMap: Record<
            string,
            { kind: LuoguExternalLinkKind; pattern: RegExp; prefixLabel: string }
        > = {
            problem: { kind: 'luogu-problem', pattern: PROBLEM_ID_RE, prefixLabel: '题目 ' },
            training: { kind: 'luogu-training', pattern: DIGITS_RE, prefixLabel: '题单 #' },
            contest: { kind: 'luogu-contest', pattern: DIGITS_RE, prefixLabel: '比赛 #' },
            discuss: { kind: 'luogu-discuss', pattern: DIGITS_RE, prefixLabel: '讨论 #' },
            team: { kind: 'luogu-team', pattern: DIGITS_RE, prefixLabel: '团队 #' },
            record: { kind: 'luogu-record', pattern: DIGITS_RE, prefixLabel: '记录 #' }
        };

        const ext = externalMap[prefix];
        if (ext && ext.pattern.test(id)) {
            return {
                kind: ext.kind,
                iconGroup: 'luogu',
                id,
                inSitePath: null,
                canonicalHref: `https://www.luogu.com.cn/${prefix}/${id}${suffix}`,
                parsedLabel: `${ext.prefixLabel}${id}`,
                matchToken: id
            };
        }
    }

    return {
        kind: 'luogu-other',
        iconGroup: 'luogu',
        id: '',
        inSitePath: null,
        canonicalHref: url.toString(),
        parsedLabel: null,
        matchToken: null
    };
}

function parseKnownOjLink(hostname: string, url: URL): ParsedEnhancedLink | null {
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const canonicalHref = url.toString();

    if (CF_HOSTS.has(hostname)) {
        let parsedLabel: string | null = null;
        let matchToken: string | null = null;
        let id = '';

        if (
            parts[0] === 'problemset' &&
            parts[1] === 'problem' &&
            parts[2] &&
            parts[3] &&
            DIGITS_RE.test(parts[2]) &&
            CF_INDEX_RE.test(parts[3])
        ) {
            id = `${parts[2]}${parts[3].toUpperCase()}`;
            parsedLabel = `CF ${id}`;
            matchToken = id;
        } else if (
            parts[0] === 'contest' &&
            parts[1] &&
            parts[2] === 'problem' &&
            parts[3] &&
            DIGITS_RE.test(parts[1]) &&
            CF_INDEX_RE.test(parts[3])
        ) {
            id = `${parts[1]}${parts[3].toUpperCase()}`;
            parsedLabel = `CF ${id}`;
            matchToken = id;
        } else if (
            parts[0] === 'gym' &&
            parts[1] &&
            parts[2] === 'problem' &&
            parts[3] &&
            DIGITS_RE.test(parts[1]) &&
            CF_INDEX_RE.test(parts[3])
        ) {
            id = `${parts[1]}${parts[3].toUpperCase()}`;
            parsedLabel = `CF Gym ${id}`;
            matchToken = id;
        } else if (parts[0] === 'contest' && parts[1] && DIGITS_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `CF 比赛 #${id}`;
            matchToken = id;
        } else if (parts[0] === 'gym' && parts[1] && DIGITS_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `CF Gym #${id}`;
            matchToken = id;
        } else if (
            parts[0] === 'blog' &&
            parts[1] === 'entry' &&
            parts[2] &&
            DIGITS_RE.test(parts[2])
        ) {
            id = parts[2];
            parsedLabel = `CF 博客 #${id}`;
            matchToken = id;
        } else if (parts[0] === 'profile' && parts[1] && HANDLE_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `CF @${id}`;
            matchToken = id;
        }

        return {
            kind: 'codeforces',
            iconGroup: 'codeforces',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel,
            matchToken
        };
    }

    if (ATCODER_HOSTS.has(hostname)) {
        let parsedLabel: string | null = null;
        let matchToken: string | null = null;
        let id = '';

        if (parts[0] === 'contests' && parts[1] && parts[2] === 'tasks' && parts[3]) {
            id = parts[3].toUpperCase();
            parsedLabel = `AtCoder ${id}`;
            matchToken = parts[3];
        } else if (parts[0] === 'contests' && parts[1]) {
            id = parts[1].toUpperCase();
            parsedLabel = `AtCoder ${id}`;
            matchToken = parts[1];
        } else if (parts[0] === 'users' && parts[1] && HANDLE_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `AtCoder @${id}`;
            matchToken = id;
        }

        return {
            kind: 'atcoder',
            iconGroup: 'atcoder',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel,
            matchToken
        };
    }

    if (UOJ_HOSTS.has(hostname) || QOJ_HOSTS.has(hostname)) {
        const isUoj = UOJ_HOSTS.has(hostname);
        const kind: KnownOjKind = isUoj ? 'uoj' : 'qoj';
        const tag = isUoj ? 'UOJ' : 'QOJ';
        let parsedLabel: string | null = null;
        let matchToken: string | null = null;
        let id = '';

        if (parts[0] === 'problem' && parts[1] && DIGITS_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `${tag} #${id}`;
            matchToken = id;
        } else if (
            parts[0] === 'contest' &&
            parts[1] &&
            parts[2] === 'problem' &&
            parts[3] &&
            DIGITS_RE.test(parts[3])
        ) {
            id = parts[3];
            parsedLabel = `${tag} #${id}`;
            matchToken = id;
        } else if (parts[0] === 'contest' && parts[1] && DIGITS_RE.test(parts[1])) {
            id = parts[1];
            parsedLabel = `${tag} 比赛 #${id}`;
            matchToken = id;
        } else if (
            isUoj &&
            parts[0] === 'blog' &&
            parts[2] === 'blog' &&
            parts[3] &&
            DIGITS_RE.test(parts[3])
        ) {
            id = parts[3];
            parsedLabel = `UOJ 博客 #${id}`;
            matchToken = id;
        }

        return {
            kind,
            iconGroup: kind,
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel,
            matchToken
        };
    }

    if (LOJ_HOSTS.has(hostname)) {
        const isProb = parts[0] === 'p' && parts[1] && DIGITS_RE.test(parts[1]);
        const id = isProb ? parts[1]! : '';
        return {
            kind: 'loj',
            iconGroup: 'loj',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel: isProb ? `LOJ #${id}` : null,
            matchToken: isProb ? id : null
        };
    }

    if (SPOJ_HOSTS.has(hostname)) {
        const isProb = parts[0] === 'problems' && parts[1] && /^[A-Za-z0-9_]+$/.test(parts[1]);
        const id = isProb ? parts[1]! : '';
        return {
            kind: 'spoj',
            iconGroup: 'spoj',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel: isProb ? `SPOJ ${id}` : null,
            matchToken: isProb ? id : null
        };
    }

    if (VJUDGE_HOSTS.has(hostname)) {
        const isProb = parts[0] === 'problem' && parts[1] && /^[A-Za-z0-9_-]+$/.test(parts[1]);
        const id = isProb ? parts[1]! : '';
        return {
            kind: 'vjudge',
            iconGroup: 'vjudge',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel: isProb ? `VJudge ${id}` : null,
            matchToken: isProb ? id : null
        };
    }

    if (HYDRO_HOSTS.has(hostname)) {
        let id = '';
        if (parts[0] === 'p' && parts[1] && PROBLEM_ID_RE.test(parts[1])) {
            id = parts[1];
        } else if (
            parts[0] === 'd' &&
            parts[2] === 'p' &&
            parts[3] &&
            PROBLEM_ID_RE.test(parts[3])
        ) {
            id = parts[3];
        }
        return {
            kind: 'hydro',
            iconGroup: 'hydro',
            id,
            inSitePath: null,
            canonicalHref,
            parsedLabel: id ? `Hydro ${id}` : null,
            matchToken: id || null
        };
    }

    return null;
}

export function parseEnhancedLink(
    rawHref: string,
    explicitOrigin?: string
): ParsedEnhancedLink | null {
    const trimmed = rawHref.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

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
    const hostname = url.hostname.toLowerCase();

    if (isRelativeInput || isSameOrigin(hostname, baseOrigin)) {
        const parsed = parseLuoguPath(url);
        if (!parsed || parsed.kind === 'luogu-other') {
            return null;
        }
        return {
            ...parsed,
            iconGroup: parsed.iconGroup ?? 'luogu'
        };
    }

    if (LUOGU_HOSTS.has(hostname)) {
        const parsed = parseLuoguPath(url);
        if (parsed) {
            return {
                ...parsed,
                iconGroup: parsed.iconGroup ?? 'luogu'
            };
        }
    }

    const oj = parseKnownOjLink(hostname, url);
    if (oj) return oj;

    return {
        kind: 'external',
        iconGroup: 'external',
        id: '',
        inSitePath: null,
        canonicalHref: url.toString(),
        parsedLabel: null,
        matchToken: null
    };
}

export function isBareUrlText(rawText: string, rawHref: string): boolean {
    const text = rawText.trim();
    if (!text) return true;
    if (/^https?:\/\//i.test(text)) return true;
    const normalizedText = text.replace(/\/+$/, '');
    const normalizedHref = rawHref.trim().replace(/\/+$/, '');
    return normalizedText === normalizedHref;
}

export function shouldAppendAnnotation(
    originalText: string,
    annotation: string,
    matchToken?: string | null
): boolean {
    const lowerText = originalText.trim().toLowerCase();
    if (!lowerText) return false;
    const lowerAnn = annotation.trim().toLowerCase();
    if (!lowerAnn || lowerText.includes(lowerAnn)) return false;
    if (matchToken && lowerText.includes(matchToken.trim().toLowerCase())) {
        return false;
    }
    return true;
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
