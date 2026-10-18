import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import { authToken, currentAuth, currentAuthState, setCurrentAuth } from '@/utils/auth.ts';

export interface RegisteredUser {
    id: number;
    cpOAuthSub: string;
    luoguUid: number;
    name: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AuthMeResponse {
    uid: number;
    role: number;
    registeredUser: RegisteredUser | null;
}

export async function getCurrentUser() {
    return (await apiFetch('/auth/me')) as ApiResponse<AuthMeResponse>;
}

let pendingAuth: { token: string; promise: Promise<void> } | null = null;

/**
 * Loads `currentAuth` for the stored token and keeps `currentAuthState` in sync.
 *
 * - No token: clears `currentAuth`, state becomes `idle`.
 * - Already `ready` for the current token and `force` is not set: resolves immediately.
 * - Concurrent calls for the same token share one request.
 * - `/auth/me` code 401: state becomes `expired` (the server did not accept the token).
 * - Any other failure: state becomes `failed`.
 * - The token is never cleared here; the user decides whether to log in again.
 * - A response that arrives after the token changed is discarded.
 *
 * The returned promise never rejects.
 */
export function ensureCurrentAuth(options: { force?: boolean } = {}): Promise<void> {
    const token = authToken.value;
    if (!token) {
        setCurrentAuth(null);
        return Promise.resolve();
    }
    if (!options.force && currentAuthState.value === 'ready' && currentAuth.value) {
        return Promise.resolve();
    }
    if (pendingAuth?.token === token) return pendingAuth.promise;

    currentAuthState.value = 'loading';
    const promise = getCurrentUser()
        .then(response => {
            if (authToken.value !== token) return;
            if (response.code === 200) {
                setCurrentAuth(response.data);
            } else if (response.code === 401) {
                currentAuthState.value = 'expired';
            } else {
                currentAuthState.value = 'failed';
            }
        })
        .catch(() => {
            if (authToken.value === token) currentAuthState.value = 'failed';
        })
        .finally(() => {
            if (pendingAuth?.promise === promise) pendingAuth = null;
        });
    pendingAuth = { token, promise };
    return promise;
}
