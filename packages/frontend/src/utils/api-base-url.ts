export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export function resolvePublicApiBaseUrl(apiBaseUrl: string, pageOrigin: string): string {
    const baseWithTrailingSlash = `${apiBaseUrl.replace(/\/$/, '')}/`;
    return new URL(baseWithTrailingSlash, `${pageOrigin.replace(/\/$/, '')}/`).href;
}

export function getPublicApiBaseUrl(): string {
    if (typeof window === 'undefined') return API_BASE_URL;
    return resolvePublicApiBaseUrl(API_BASE_URL, window.location.origin);
}

export function getApiUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL.replace(/\/$/, '')}${normalizedPath}`;
}
