const REDACTED_RESULT_KEYS: Record<string, true> = {
    content: true,
    text: true,
    reason: true,
    embedding: true,
    embeddingRecords: true
};

/**
 * Strips raw article/paste bodies, internal LLM censorship explanations, and raw embedding vectors
 * from task/workflow query responses so public status polling cannot leak sensitive payloads.
 */
export function sanitizePublicTaskResult(value: unknown): unknown {
    if (value === null || value === undefined || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(item => sanitizePublicTaskResult(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (REDACTED_RESULT_KEYS[key]) continue;
        sanitized[key] = sanitizePublicTaskResult(entry);
    }
    return sanitized;
}
