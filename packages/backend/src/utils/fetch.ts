import { C3vkMode } from '@/shared/c3vk';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { UnrecoverableError } from 'bullmq';
import {
    getTorAxiosConfig,
    isNative429TorOnly,
    markNative429TorOnly,
    rotateTorExitIp
} from '@/utils/tor';

export interface LuoguHttpErrorMeta {
    errorCode?: number;
    errorMessage?: string;
    errorType?: string;
}

export class LuoguHttpError extends UnrecoverableError {
    public readonly status: number;
    public readonly errorCode?: number;
    public readonly errorMessage?: string;
    public readonly errorType?: string;

    constructor(status: number, message: string, meta: LuoguHttpErrorMeta = {}) {
        super(message);
        this.name = 'LuoguHttpError';
        this.status = status;
        this.errorCode = meta.errorCode;
        this.errorMessage = meta.errorMessage;
        this.errorType = meta.errorType;
    }
}

function extractLuoguErrorMeta(raw: unknown): LuoguHttpErrorMeta {
    let parsed: unknown = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return {};
        }
    }
    if (!parsed || typeof parsed !== 'object') return {};

    const payload = (parsed as { data?: unknown }).data;
    if (!payload || typeof payload !== 'object') return {};

    const record = payload as Record<string, unknown>;
    const meta: LuoguHttpErrorMeta = {};
    if (typeof record.errorCode === 'number' && Number.isFinite(record.errorCode)) {
        meta.errorCode = record.errorCode;
    }
    if (typeof record.errorMessage === 'string' && record.errorMessage.trim()) {
        meta.errorMessage = record.errorMessage.trim();
    }
    if (typeof record.errorType === 'string' && record.errorType.trim()) {
        meta.errorType = record.errorType.trim();
    }
    return meta;
}

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36 LGS-Crawler/1.0.0';

const axiosConfig: AxiosRequestConfig = {
    maxRedirects: 0,
    validateStatus: () => true
};

function isRetriableRequestError(err: any): boolean {
    const code = err.code;
    const msg = err.message || '';
    return (
        code === 'ECONNABORTED' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        msg.includes('timeout')
    );
}

function handleRequestError(err: any): never {
    if (isRetriableRequestError(err))
        throw new Error('Network timeout or connection error: ' + err.code);
    throw new UnrecoverableError(err.message || 'Unknown network error');
}

function mergeSetCookieToHeaders(response: AxiosResponse, headers: Record<string, string>) {
    const setCookie: string[] | undefined = response.headers['set-cookie'];
    if (!setCookie) return;
    const existingCookies = headers['Cookie']
        ? headers['Cookie'].split('; ').reduce(
              (acc, cur) => {
                  const parts = cur.split('=');
                  if (parts.length >= 2) {
                      const k = parts[0];
                      const v = parts.slice(1).join('=');
                      acc[k] = v;
                  }
                  return acc;
              },
              {} as Record<string, string>
          )
        : {};

    setCookie.forEach(cookieStr => {
        const [cookiePair] = cookieStr.split(';');
        const parts = cookiePair.split('=');
        if (parts.length >= 2) {
            const k = parts[0];
            const v = parts.slice(1).join('=');
            existingCookies[k] = v;
        }
    });

    headers['Cookie'] = Object.entries(existingCookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

async function handleLegacyC3VK(
    response: AxiosResponse,
    url: string,
    headers: Record<string, string>,
    timeout: number,
    transportConfig: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
    if (typeof response.data === 'string') {
        const m = response.data.match(/C3VK=([a-zA-Z0-9]+);/);
        if (m) {
            const c3vkValue = m[1];
            const newCookie = headers['Cookie']
                ? `${headers['Cookie']}; C3VK=${c3vkValue}`
                : `C3VK=${c3vkValue}`;
            const newHeaders = { ...headers, Cookie: newCookie };
            logger.debug({ url, c3vk: c3vkValue }, 'Detected Legacy C3VK token, retrying request');
            return await axios.get(url, {
                ...axiosConfig,
                ...transportConfig,
                headers: newHeaders,
                timeout
            });
        }
    }
    return response;
}

async function requestLuoguOnce(
    url: string,
    mode: C3vkMode,
    headers: Record<string, string>,
    timeout: number,
    transportConfig: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
    let resp: AxiosResponse;
    try {
        resp = await axios.get(url, {
            ...axiosConfig,
            ...transportConfig,
            headers,
            timeout
        });
    } catch (err: any) {
        handleRequestError(err);
    }

    if (mode === C3vkMode.LEGACY) {
        resp = await handleLegacyC3VK(resp, url, headers, timeout, transportConfig);
    }
    if (mode === C3vkMode.MODERN && resp.status === 302 && resp.headers.location) {
        mergeSetCookieToHeaders(resp, headers);
        logger.debug(
            {
                url,
                location: resp.headers.location,
                status: resp.status
            },
            'Detected New C3VK redirect, merging cookies and retrying'
        );
        try {
            resp = await axios.get(url, {
                ...axiosConfig,
                ...transportConfig,
                headers,
                timeout
            });
        } catch (err: any) {
            handleRequestError(err);
        }
    }

    return resp;
}

async function requestViaTorWithRotation(
    url: string,
    mode: C3vkMode,
    headers: Record<string, string>,
    timeout: number
): Promise<AxiosResponse> {
    const torTransportConfig = getTorAxiosConfig();
    try {
        const resp = await requestLuoguOnce(url, mode, headers, timeout, torTransportConfig);
        if (resp.status !== 429) return resp;

        logger.warn({ url, status: resp.status }, 'Tor request was rate limited, rotating exit IP');
    } catch (error) {
        if (error instanceof UnrecoverableError) throw error;
        logger.warn({ error, url }, 'Tor request failed, rotating exit IP');
    }

    try {
        await rotateTorExitIp();
    } catch (error) {
        logger.warn({ error }, 'Failed to rotate Tor exit IP before retry');
    }

    return await requestLuoguOnce(url, mode, headers, timeout, torTransportConfig);
}

/**
 * Fetch a page with C3VK handling.
 * @param url URL to fetch
 * @param mode C3VK mode
 * @param cookie Cookie object
 * @returns Page content as string
 */
export async function fetch(
    url: string,
    mode: C3vkMode,
    cookie?: Record<string, string>
): Promise<any> {
    const timeout = config.network.timeout;

    const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json; charset=UTF-8',
        'x-luogu-type': 'content-only',
        'x-lentille-request': 'content-only',
        ...(cookie
            ? {
                  Cookie: Object.entries(cookie)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('; ')
              }
            : {})
    };

    logger.debug({ url, mode }, 'Fetching the page');
    let resp: AxiosResponse;
    if (await isNative429TorOnly()) {
        logger.debug({ url }, 'Fetching the page through Tor due to native 429 marker');
        resp = await requestViaTorWithRotation(url, mode, headers, timeout);
    } else {
        try {
            resp = await requestLuoguOnce(url, mode, headers, timeout);
        } catch (error) {
            if (!config.network.tor.enabled || error instanceof UnrecoverableError) throw error;
            logger.warn({ error, url }, 'Native request failed, falling back to Tor');
            resp = await requestViaTorWithRotation(url, mode, headers, timeout);
        }

        if (resp.status === 429 && config.network.tor.enabled) {
            await markNative429TorOnly();
            logger.warn(
                { url, status: resp.status },
                'Native request was rate limited, falling back to Tor'
            );
            resp = await requestViaTorWithRotation(url, mode, headers, timeout);
        }
    }
    logger.debug({ url, status: resp.status }, 'Page fetch completed');
    if (resp.status === 401) {
        const meta = extractLuoguErrorMeta(resp.data);
        logger.warn(
            { url, cookie: headers['Cookie'], ...meta },
            "Can't fetch the page. Is the cookie expired? Received 401 Unauthorized."
        );
        throw new LuoguHttpError(401, 'Unauthorized fetch', meta);
    } else if (resp.status === 429 || resp.status === 403) {
        const meta = extractLuoguErrorMeta(resp.data);
        logger.warn(
            { url, status: resp.status, ...meta },
            `Access to the page is blocked. Received ${resp.status} status.`
        );
        throw new LuoguHttpError(resp.status, `Access blocked with code ${resp.status}`, meta);
    }
    const data = resp.data;
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
        throw new UnrecoverableError('Failed to parse response JSON');
    }
}
