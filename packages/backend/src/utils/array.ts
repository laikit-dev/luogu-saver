/** Unbiased partial Fisher-Yates sampling without replacement. */
export function sampleWithoutReplacement<T>(
    pool: readonly T[],
    count: number,
    exclude?: ReadonlySet<T>
): T[] {
    if (count <= 0 || pool.length === 0) return [];
    const candidates =
        exclude && exclude.size > 0 ? pool.filter(item => !exclude.has(item)) : [...pool];
    const limit = Math.min(count, candidates.length);
    for (let i = 0; i < limit; i++) {
        const j = i + Math.floor(Math.random() * (candidates.length - i));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, limit);
}
