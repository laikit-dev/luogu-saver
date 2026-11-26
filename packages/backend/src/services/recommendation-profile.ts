import type { RecommendationArticleRow } from '@/services/article.service';
import type { ArticleCategory } from '@/shared/article';

export type PersonaTagTone = 'primary' | 'info' | 'success' | 'warning' | 'purple';

export interface PersonaTag {
    id: string;
    label: string;
    description: string;
    tone: PersonaTagTone;
}

export interface TopicTag {
    tag: string;
    count: number;
    score: number;
    share: number;
}

export interface ProfileCategoryStat {
    category: ArticleCategory;
    count: number;
    share: number;
}

export interface ProfileClusterArticle {
    id: string;
    title: string;
    category: ArticleCategory;
}

export interface ProfileInterestCluster {
    label: string;
    weight: number;
    share: number;
    dominantCategory: ArticleCategory | null;
    keywords: string[];
    sampleArticles: ProfileClusterArticle[];
}

export interface ProfileFavoriteAuthor {
    id: number;
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
    count: number;
}

export type ReadingRhythmPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ReadingRhythmBucket {
    period: ReadingRhythmPeriod;
    count: number;
    share: number;
}

export interface ProfileRecentArticle {
    id: string;
    title: string;
    category: ArticleCategory;
    viewedAt: string;
}

export interface InterestProfileSummary {
    trackingEnabled: boolean;
    subjectKind: 'user' | 'device' | null;
    viewedCount: number;
    retentionDays: number;
    personaTags: PersonaTag[];
    topicTags: TopicTag[];
    categories: ProfileCategoryStat[];
    clusters: ProfileInterestCluster[];
    favoriteAuthors: ProfileFavoriteAuthor[];
    readingRhythm: ReadingRhythmBucket[];
    recentArticles: ProfileRecentArticle[];
}

export interface WeightedClusterInput {
    weight: number;
    articleIds: string[];
}

const CATEGORY_LABELS: Record<number, string> = {
    1: '个人记录',
    2: '题解',
    3: '科技·工程',
    4: '算法·理论',
    5: '生活·游记',
    6: '学习·文化课',
    7: '休闲·娱乐',
    8: '闲话'
};

const TOPIC_LEXICON: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
    { tag: '动态规划', pattern: /\bdp\b|动规|动态规划|状压|数位\s*dp|区间\s*dp|斜率优化/i },
    { tag: '线段树', pattern: /线段树|吉司机|主席树|可持久化线段树|\bzkw\b/i },
    { tag: '图论', pattern: /图论|最短路|dijkstra|spfa|tarjan|拓扑排序|二分图|最小生成树/i },
    { tag: '树上问题', pattern: /树链剖分|树剖|\blca\b|点分治|树形\s*dp|虚树|重链剖分/i },
    { tag: '网络流', pattern: /网络流|最大流|费用流|dinic|最小割/i },
    { tag: '数论', pattern: /数论|莫比乌斯|欧拉筛|线性筛|同余|中国剩余定理|\bcrt\b|exgcd|原根/i },
    {
        tag: '字符串',
        pattern: /字符串|\bkmp\b|ac\s*自动机|后缀自动机|\bsam\b|manacher|\btrie\b|字典树/i
    },
    { tag: '平衡树', pattern: /平衡树|\bfhq\b|treap|splay|红黑树/i },
    { tag: '多项式', pattern: /多项式|\bfft\b|\bntt\b|生成函数|拉格朗日插值/i },
    { tag: '概率期望', pattern: /概率|期望|马尔可夫/i },
    { tag: '博弈论', pattern: /博弈|sg\s*函数|\bnim\b/i },
    { tag: '计算几何', pattern: /计算几何|凸包|半平面交|旋转卡壳/i },
    { tag: '分块与莫队', pattern: /分块|莫队/i },
    { tag: '搜索与剪枝', pattern: /\bdfs\b|\bbfs\b|启发式搜索|迭代加深|折半搜索/i },
    { tag: '贪心与二分', pattern: /贪心|二分答案|三分/i },
    { tag: '组合数学', pattern: /组合数学|容斥|二项式反演|卡特兰|斯特林/i },
    { tag: 'NOIP', pattern: /\bnoip\b/i },
    { tag: 'NOI', pattern: /\bnoi\b(?!p)/i },
    { tag: 'CSP', pattern: /\bcsp(?:-[js])?\b/i },
    { tag: '省选', pattern: /省选/i },
    { tag: 'ICPC / XCPC', pattern: /\b(?:icpc|ccpc|xcpc)\b/i },
    { tag: 'Codeforces', pattern: /codeforces|\bcf\s*\d+/i },
    { tag: 'AtCoder', pattern: /atcoder|\b(?:abc|arc|agc)\s*\d+/i },
    { tag: '游记', pattern: /游记/i },
    { tag: '退役记', pattern: /退役/i },
    { tag: '模板整理', pattern: /模板|板子/i },
    { tag: '文化课', pattern: /文化课|\bwhk\b|高考|期中|期末/i },
    { tag: '题单与总结', pattern: /题单|做题记录|刷题记录|杂题/i },
    { tag: 'C++', pattern: /c\+\+|\bcpp\b|\bstl\b/i },
    { tag: 'Python', pattern: /\bpython\b/i },
    { tag: '前端开发', pattern: /前端|\bvue\b|\breact\b|typescript|javascript|\bcss\b/i },
    { tag: 'Linux / 运维', pattern: /\blinux\b|\bdocker\b|\bnginx\b|\bubuntu\b/i },
    { tag: 'AI / 大模型', pattern: /\bllm\b|大模型|机器学习|深度学习|神经网络|transformer/i },
    { tag: '计算机底层', pattern: /操作系统|编译原理|计算机网络|汇编|体系结构/i }
];

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const MAX_TOPIC_TAGS = 15;
const MAX_PERSONA_TAGS = 6;
const MAX_FAVORITE_AUTHORS = 5;
const MAX_RECENT_ARTICLES = 8;

function extractArticleTopics(
    row: RecommendationArticleRow
): Array<{ tag: string; boost: number }> {
    const matched = new Map<string, number>();

    if (Array.isArray(row.tags)) {
        for (const rawTag of row.tags) {
            const tag = typeof rawTag === 'string' ? rawTag.trim() : '';
            if (tag.length > 0 && tag.length <= 24) {
                matched.set(tag, 1.2);
            }
        }
    }

    const corpus = `${row.title || ''}\n${row.summary || ''}`;
    for (const entry of TOPIC_LEXICON) {
        if (entry.pattern.test(corpus) && !matched.has(entry.tag)) {
            matched.set(entry.tag, 1);
        }
    }

    return Array.from(matched.entries()).map(([tag, boost]) => ({ tag, boost }));
}

function classifyBeijingPeriod(timestampMs: number): ReadingRhythmPeriod {
    const hour = Math.floor((timestampMs + BEIJING_OFFSET_MS) / 3_600_000) % 24;
    const normalizedHour = hour < 0 ? hour + 24 : hour;
    if (normalizedHour >= 6 && normalizedHour <= 11) return 'morning';
    if (normalizedHour >= 12 && normalizedHour <= 17) return 'afternoon';
    if (normalizedHour >= 18 && normalizedHour <= 22) return 'evening';
    return 'night';
}

export function createDisabledInterestProfile(): InterestProfileSummary {
    return {
        trackingEnabled: false,
        subjectKind: null,
        viewedCount: 0,
        retentionDays: 0,
        personaTags: [],
        topicTags: [],
        categories: [],
        clusters: [],
        favoriteAuthors: [],
        readingRhythm: [],
        recentArticles: []
    };
}

export function buildInterestProfileSummary(params: {
    subjectKind: 'user' | 'device';
    retentionDays: number;
    decayFactor: number;
    hydratedRows: RecommendationArticleRow[];
    viewedAtByArticleId: ReadonlyMap<string, number>;
    clusters: readonly WeightedClusterInput[];
}): InterestProfileSummary {
    const { subjectKind, retentionDays, decayFactor, hydratedRows, viewedAtByArticleId, clusters } =
        params;

    const viewedCount = hydratedRows.length;
    if (viewedCount === 0) {
        return {
            trackingEnabled: true,
            subjectKind,
            viewedCount: 0,
            retentionDays,
            personaTags: [],
            topicTags: [],
            categories: [],
            clusters: [],
            favoriteAuthors: [],
            readingRhythm: [
                { period: 'morning', count: 0, share: 0 },
                { period: 'afternoon', count: 0, share: 0 },
                { period: 'evening', count: 0, share: 0 },
                { period: 'night', count: 0, share: 0 }
            ],
            recentArticles: []
        };
    }

    const rowById = new Map<string, RecommendationArticleRow>();
    const weightById = new Map<string, number>();
    const categoryStats = new Map<ArticleCategory, { count: number; weight: number }>();
    const topicStats = new Map<string, { count: number; score: number }>();
    const authorStats = new Map<number, { author: ProfileFavoriteAuthor; weight: number }>();
    const rhythmCounts: Record<ReadingRhythmPeriod, number> = {
        morning: 0,
        afternoon: 0,
        evening: 0,
        night: 0
    };

    let totalWeight = 0;
    let factor = 1;
    let articlesWithAuthor = 0;
    let highRankAuthorArticles = 0;

    for (const row of hydratedRows) {
        rowById.set(row.id, row);
        weightById.set(row.id, factor);
        totalWeight += factor;

        const existingCat = categoryStats.get(row.category);
        if (existingCat) {
            existingCat.count += 1;
            existingCat.weight += factor;
        } else {
            categoryStats.set(row.category, { count: 1, weight: factor });
        }

        for (const { tag, boost } of extractArticleTopics(row)) {
            const existingTopic = topicStats.get(tag);
            const delta = factor * boost;
            if (existingTopic) {
                existingTopic.count += 1;
                existingTopic.score += delta;
            } else {
                topicStats.set(tag, { count: 1, score: delta });
            }
        }

        if (row.author) {
            articlesWithAuthor += 1;
            if (row.author.color === 'Red' || row.author.color === 'Purple') {
                highRankAuthorArticles += 1;
            }
            const existingAuthor = authorStats.get(row.author.id);
            if (existingAuthor) {
                existingAuthor.author.count += 1;
                existingAuthor.weight += factor;
            } else {
                authorStats.set(row.author.id, {
                    author: {
                        id: row.author.id,
                        name: row.author.name,
                        color: row.author.color,
                        ccfLevel: row.author.ccfLevel ?? 0,
                        xcpcLevel: row.author.xcpcLevel ?? 0,
                        badge: row.author.badge ?? null,
                        count: 1
                    },
                    weight: factor
                });
            }
        }

        const ts = viewedAtByArticleId.get(row.id);
        if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
            rhythmCounts[classifyBeijingPeriod(ts)] += 1;
        }

        factor *= decayFactor;
    }

    const categories: ProfileCategoryStat[] = Array.from(categoryStats.entries())
        .map(([category, stat]) => ({
            category,
            count: stat.count,
            share: totalWeight > 0 ? Number((stat.weight / totalWeight).toFixed(4)) : 0
        }))
        .sort((a, b) => b.share - a.share || b.count - a.count || a.category - b.category);

    const sortedTopics = Array.from(topicStats.entries())
        .map(([tag, stat]) => ({ tag, count: stat.count, score: stat.score }))
        .sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, MAX_TOPIC_TAGS);
    const maxTopicScore = sortedTopics[0]?.score ?? 0;
    const topicTags: TopicTag[] = sortedTopics.map(item => ({
        tag: item.tag,
        count: item.count,
        score: Number(item.score.toFixed(3)),
        share: maxTopicScore > 0 ? Number((item.score / maxTopicScore).toFixed(4)) : 0
    }));

    const totalClusterWeight = clusters.reduce((sum, c) => sum + c.weight, 0);
    const formattedClusters: ProfileInterestCluster[] = clusters
        .map(cluster => {
            const memberRows = cluster.articleIds
                .map(id => rowById.get(id))
                .filter((row): row is RecommendationArticleRow => Boolean(row));
            if (memberRows.length === 0) return null;

            const clusterCatWeights = new Map<ArticleCategory, number>();
            const clusterTopicScores = new Map<string, number>();
            for (const row of memberRows) {
                const w = weightById.get(row.id) ?? 1;
                clusterCatWeights.set(row.category, (clusterCatWeights.get(row.category) ?? 0) + w);
                for (const { tag, boost } of extractArticleTopics(row)) {
                    clusterTopicScores.set(tag, (clusterTopicScores.get(tag) ?? 0) + w * boost);
                }
            }

            let dominantCategory: ArticleCategory | null = null;
            let bestCatWeight = -1;
            for (const [cat, w] of clusterCatWeights.entries()) {
                if (w > bestCatWeight) {
                    bestCatWeight = w;
                    dominantCategory = cat;
                }
            }

            const keywords = Array.from(clusterTopicScores.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, 3)
                .map(([tag]) => tag);

            const label =
                keywords.length > 0
                    ? keywords.slice(0, 2).join(' · ')
                    : dominantCategory !== null
                      ? `${CATEGORY_LABELS[dominantCategory] || '综合'}方向`
                      : '综合兴趣';

            return {
                label,
                weight: Number(cluster.weight.toFixed(3)),
                share:
                    totalClusterWeight > 0
                        ? Number((cluster.weight / totalClusterWeight).toFixed(4))
                        : 0,
                dominantCategory,
                keywords,
                sampleArticles: memberRows.slice(0, 3).map(row => ({
                    id: row.id,
                    title: row.title,
                    category: row.category
                }))
            };
        })
        .filter((item): item is ProfileInterestCluster => item !== null);

    const favoriteAuthors: ProfileFavoriteAuthor[] = Array.from(authorStats.values())
        .sort(
            (a, b) =>
                b.weight - a.weight || b.author.count - a.author.count || a.author.id - b.author.id
        )
        .slice(0, MAX_FAVORITE_AUTHORS)
        .map(item => item.author);

    const rhythmTotal =
        rhythmCounts.morning + rhythmCounts.afternoon + rhythmCounts.evening + rhythmCounts.night;
    const periods: ReadingRhythmPeriod[] = ['morning', 'afternoon', 'evening', 'night'];
    const readingRhythm: ReadingRhythmBucket[] = periods.map(period => ({
        period,
        count: rhythmCounts[period],
        share: rhythmTotal > 0 ? Number((rhythmCounts[period] / rhythmTotal).toFixed(4)) : 0
    }));

    const personaTags = buildPersonaTags({
        viewedCount,
        categories,
        clusters: formattedClusters,
        topicTags,
        favoriteAuthors,
        readingRhythm,
        articlesWithAuthor,
        highRankAuthorArticles
    });

    const recentArticles: ProfileRecentArticle[] = hydratedRows
        .slice(0, MAX_RECENT_ARTICLES)
        .map(row => {
            const ts = viewedAtByArticleId.get(row.id);
            return {
                id: row.id,
                title: row.title,
                category: row.category,
                viewedAt:
                    typeof ts === 'number' && Number.isFinite(ts) && ts > 0
                        ? new Date(ts).toISOString()
                        : new Date().toISOString()
            };
        });

    return {
        trackingEnabled: true,
        subjectKind,
        viewedCount,
        retentionDays,
        personaTags,
        topicTags,
        categories,
        clusters: formattedClusters,
        favoriteAuthors,
        readingRhythm,
        recentArticles
    };
}

function buildPersonaTags(input: {
    viewedCount: number;
    categories: ProfileCategoryStat[];
    clusters: ProfileInterestCluster[];
    topicTags: TopicTag[];
    favoriteAuthors: ProfileFavoriteAuthor[];
    readingRhythm: ReadingRhythmBucket[];
    articlesWithAuthor: number;
    highRankAuthorArticles: number;
}): PersonaTag[] {
    const {
        viewedCount,
        categories,
        clusters,
        topicTags,
        favoriteAuthors,
        readingRhythm,
        articlesWithAuthor,
        highRankAuthorArticles
    } = input;

    if (viewedCount < 3) {
        return [
            {
                id: 'newcomer',
                label: '初来乍到',
                description: `已记录 ${viewedCount} 篇阅读，再看几篇画像会更精准`,
                tone: 'info'
            }
        ];
    }

    const tags: PersonaTag[] = [];
    const catShare = (cat: number) => categories.find(item => item.category === cat)?.share ?? 0;
    const pct = (value: number) => `${Math.round(value * 100)}%`;

    // 1. Primary content archetype
    const hardcoreShare = catShare(2) + catShare(4);
    if (hardcoreShare >= 0.65) {
        tags.push({
            id: 'hardcore-oier',
            label: '硬核 OIer',
            description: `题解与算法·理论类阅读权重合计占 ${pct(hardcoreShare)}`,
            tone: 'primary'
        });
    } else if (catShare(2) >= 0.35) {
        tags.push({
            id: 'solution-hunter',
            label: '题解考古学家',
            description: `题解类文章权重占 ${pct(catShare(2))}`,
            tone: 'warning'
        });
    } else if (catShare(4) >= 0.3) {
        tags.push({
            id: 'algorithm-theorist',
            label: '算法理论派',
            description: `算法·理论类文章权重占 ${pct(catShare(4))}`,
            tone: 'primary'
        });
    } else if (catShare(3) >= 0.25) {
        tags.push({
            id: 'tech-geek',
            label: '工程极客',
            description: `科技·工程类文章权重占 ${pct(catShare(3))}`,
            tone: 'info'
        });
    } else if (catShare(8) >= 0.3) {
        tags.push({
            id: 'gossip-regular',
            label: '洛谷茶馆常客',
            description: `闲话类文章权重占 ${pct(catShare(8))}`,
            tone: 'purple'
        });
    } else if (catShare(5) >= 0.25) {
        tags.push({
            id: 'travelogue-fan',
            label: '游记收藏家',
            description: `生活·游记类文章权重占 ${pct(catShare(5))}`,
            tone: 'success'
        });
    } else if (catShare(1) >= 0.3) {
        tags.push({
            id: 'record-watcher',
            label: '日记观察员',
            description: `个人记录类文章权重占 ${pct(catShare(1))}`,
            tone: 'info'
        });
    } else if (catShare(6) >= 0.2) {
        tags.push({
            id: 'study-grinder',
            label: '文化课卷王',
            description: `学习·文化课类文章权重占 ${pct(catShare(6))}`,
            tone: 'purple'
        });
    } else if (catShare(7) >= 0.2) {
        tags.push({
            id: 'leisure-reader',
            label: '摸鱼鉴赏家',
            description: `休闲·娱乐类文章权重占 ${pct(catShare(7))}`,
            tone: 'success'
        });
    }

    // 2. Semantic interest cluster shape / breadth
    if (clusters.length >= 3 && clusters[0].share < 0.52) {
        tags.push({
            id: 'multi-track',
            label: '多线并行',
            description: '语义聚类识别出 3 个均衡的兴趣方向',
            tone: 'info'
        });
    } else if (clusters.length >= 1 && clusters[0].share >= 0.72 && viewedCount >= 4) {
        tags.push({
            id: 'deep-focus',
            label: '深度专精',
            description: `主兴趣簇集中了 ${pct(clusters[0].share)} 的推荐权重`,
            tone: 'primary'
        });
    } else if (categories.length >= 5) {
        tags.push({
            id: 'all-rounder',
            label: '全站通吃',
            description: `近期阅读跨越了 ${categories.length} 个不同分区`,
            tone: 'success'
        });
    }

    // 3. Reading rhythm (UTC+8)
    if (viewedCount >= 4) {
        const rhythmShare = (period: ReadingRhythmPeriod) =>
            readingRhythm.find(item => item.period === period)?.share ?? 0;
        if (rhythmShare('night') >= 0.35) {
            tags.push({
                id: 'night-owl',
                label: '深夜刷站人',
                description: `北京时间 23:00–05:59 阅读占 ${pct(rhythmShare('night'))}`,
                tone: 'purple'
            });
        } else if (rhythmShare('morning') >= 0.35) {
            tags.push({
                id: 'early-bird',
                label: '早起卷王',
                description: `北京时间 06:00–11:59 阅读占 ${pct(rhythmShare('morning'))}`,
                tone: 'success'
            });
        } else if (rhythmShare('evening') >= 0.45) {
            tags.push({
                id: 'evening-surfer',
                label: '晚间冲浪手',
                description: `北京时间 18:00–22:59 阅读占 ${pct(rhythmShare('evening'))}`,
                tone: 'info'
            });
        }
    }

    // 4. Author affinity
    const topAuthor = favoriteAuthors[0];
    if (topAuthor && topAuthor.count >= 3) {
        tags.push({
            id: 'loyal-reader',
            label: '忠实读者',
            description: `近期反复阅读了 ${topAuthor.name} 的 ${topAuthor.count} 篇文章`,
            tone: 'warning'
        });
    }
    if (articlesWithAuthor >= 4 && highRankAuthorArticles / articlesWithAuthor >= 0.55) {
        tags.push({
            id: 'master-tracker',
            label: '大佬追踪器',
            description: `所读文章作者中红名与紫名占 ${pct(highRankAuthorArticles / articlesWithAuthor)}`,
            tone: 'warning'
        });
    }

    // 5. Top topic signature
    const topTopic = topicTags[0];
    if (topTopic && topTopic.count >= 2 && tags.length < MAX_PERSONA_TAGS) {
        tags.push({
            id: `topic-${topTopic.tag}`,
            label: `${topTopic.tag}爱好者`,
            description: `近期阅读中有 ${topTopic.count} 篇涉及「${topTopic.tag}」`,
            tone: 'purple'
        });
    }

    return tags.slice(0, MAX_PERSONA_TAGS);
}
