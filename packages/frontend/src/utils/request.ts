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
 * Chinese user-facing message for a rejected `apiFetch` call.
 *
 * Transport failures (no HTTP response) and timeouts get their own wording; every other rejection
 * uses `fallback`, which must describe the failed action. Raw Axios/backend English text is never
 * returned.
 */
export function requestErrorMessage(error: unknown, fallback: string): string {
    if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return '请求超时，请稍后重试。';
        }
        if (!error.response) return '网络连接失败，请检查网络后重试。';
    }
    return fallback;
}
