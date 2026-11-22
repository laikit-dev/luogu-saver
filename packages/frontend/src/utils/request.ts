import axios, { isAxiosError } from 'axios';
import { getDeviceId } from '@/utils/device-id.ts';
import { API_BASE_URL } from '@/utils/api-base-url.ts';
import { authToken } from '@/utils/auth.ts';
import { trackingAllowed } from '@/utils/tracking-consent.ts';

export const apiFetch = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000
});

apiFetch.interceptors.request.use(config => {
    if (authToken.value) {
        config.headers['Authorization'] = `Bearer ${authToken.value}`;
    }

    if (trackingAllowed.value) {
        config.headers['X-Consent-Tracking'] = 'true';
        config.headers['X-Device-ID'] = getDeviceId();
    } else {
        config.headers['X-Consent-Tracking'] = 'false';
    }
    return config;
});

apiFetch.interceptors.response.use(response => response.data);

/**
 * User-facing message for a rejected `apiFetch` call.
 *
 * Returns specific timeout/network wording for transport errors, prefers explicit backend or thrown
 * error messages when available, and falls back to `fallback` for raw Axios HTTP errors.
 */
export function requestErrorMessage(error: unknown, fallback: string): string {
    if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return '请求超时，请稍后重试';
        }
        if (!error.response) return '网络连接失败，请检查网络';
        const responseMessage = (error.response.data as { message?: unknown } | undefined)?.message;
        if (typeof responseMessage === 'string' && responseMessage.trim()) {
            return responseMessage.trim();
        }
        return fallback;
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return fallback;
}
