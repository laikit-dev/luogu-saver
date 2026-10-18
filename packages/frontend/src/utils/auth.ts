import { computed, ref } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { AUTH_TOKEN_STORAGE_KEY } from '@/utils/constants.ts';
import { getApiUrl } from '@/utils/api-base-url.ts';
import type { AuthMeResponse } from '@/api/auth.ts';

const tokenStorage = useLocalStorage(AUTH_TOKEN_STORAGE_KEY, '');

export type CurrentAuthState = 'idle' | 'loading' | 'ready' | 'expired' | 'failed';

export const authToken = tokenStorage;
export const currentAuth = ref<AuthMeResponse | null>(null);
/** Hydration state of `currentAuth` for the stored token; see `ensureCurrentAuth` in api/auth.ts. */
export const currentAuthState = ref<CurrentAuthState>('idle');

export const isAuthenticated = computed(() => Boolean(authToken.value));
export const currentRole = computed(() => currentAuth.value?.role ?? null);

export function setAuthToken(token: string) {
    authToken.value = token;
    currentAuth.value = null;
    currentAuthState.value = 'idle';
}

export function clearAuthToken() {
    authToken.value = '';
    currentAuth.value = null;
    currentAuthState.value = 'idle';
}

export function setCurrentAuth(auth: AuthMeResponse | null) {
    currentAuth.value = auth;
    currentAuthState.value = auth ? 'ready' : 'idle';
}

export function startCpOAuthLogin(redirect: string = window.location.pathname) {
    const query = new URLSearchParams({
        redirect,
        frontendOrigin: window.location.origin
    });
    window.location.href = getApiUrl(`/auth/cp/login?${query}`);
}
