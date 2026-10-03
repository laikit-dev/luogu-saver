import axios from 'axios';
import crypto from 'crypto';
import { config } from '@/config';
import { redisClient } from '@/lib/redis';
import { RegisteredUserService } from '@/services/registered-user.service';

type DiscoveryDocument = {
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
};

export type StoredOAuthState = {
    codeVerifier: string;
    redirect: string;
    frontendOrigin: string;
};

type CpOAuthTokenResponse = {
    access_token?: string;
};

type CpOAuthLinkedAccount = {
    platform?: string;
    platformUid?: string;
    platformUsername?: string;
};

type CpOAuthUserInfo = {
    sub?: string;
    username?: string;
    display_name?: string;
    avatar_url?: string;
    linked_accounts?: CpOAuthLinkedAccount[];
};

type LocalLoginResult = {
    token: string;
    uid: number;
    role: number;
};

const STATE_KEY_PREFIX = 'auth:cp:state:';

export class AuthService {
    private static discoveryCache: DiscoveryDocument | null = null;

    private static get cpOAuthConfig() {
        return config.auth.cpOAuth;
    }

    private static async getDiscoveryDocument(): Promise<DiscoveryDocument> {
        if (this.discoveryCache) return this.discoveryCache;

        const response = await axios.get<DiscoveryDocument>(this.cpOAuthConfig.discoveryUrl, {
            timeout: config.network.timeout
        });
        const discovery = response.data;

        if (
            !discovery.authorization_endpoint ||
            !discovery.token_endpoint ||
            !discovery.userinfo_endpoint
        ) {
            throw new Error('Invalid CP OAuth discovery document');
        }

        this.discoveryCache = discovery;
        return discovery;
    }

    private static getStateKey(state: string): string {
        return `${STATE_KEY_PREFIX}${state}`;
    }

    private static base64url(buffer: Buffer): string {
        return buffer.toString('base64url');
    }

    private static normalizeRedirect(redirect: unknown): string {
        if (typeof redirect !== 'string' || !redirect.startsWith('/')) return '/';
        if (redirect.startsWith('//')) return '/';
        return redirect;
    }

    static isAllowedFrontendOrigin(origin: unknown): origin is string {
        if (typeof origin !== 'string') return false;
        if (this.cpOAuthConfig.allowedFrontendOrigins.includes(origin)) return true;

        try {
            const callbackUrl = new URL(this.cpOAuthConfig.frontendRedirectUri);
            return (
                (callbackUrl.protocol === 'https:' || callbackUrl.protocol === 'http:') &&
                callbackUrl.origin === origin
            );
        } catch {
            return false;
        }
    }

    private static async storeState(state: string, data: StoredOAuthState) {
        await redisClient.set(
            this.getStateKey(state),
            JSON.stringify(data),
            'EX',
            this.cpOAuthConfig.stateExpireSeconds
        );
    }

    static async consumeState(state: string): Promise<StoredOAuthState | null> {
        const key = this.getStateKey(state);
        const rawState = await redisClient.getdel(key);
        if (!rawState) return null;

        const storedState = JSON.parse(rawState) as StoredOAuthState;
        return this.isAllowedFrontendOrigin(storedState.frontendOrigin) ? storedState : null;
    }

    static async createAuthorizationUrl(
        redirect: unknown,
        frontendOrigin: string
    ): Promise<string> {
        if (!this.cpOAuthConfig.clientId) throw new Error('CP OAuth clientId is not configured');
        if (!this.cpOAuthConfig.redirectUri) {
            throw new Error('CP OAuth redirectUri is not configured');
        }

        const discovery = await this.getDiscoveryDocument();
        const state = crypto.randomBytes(16).toString('hex');
        const codeVerifier = this.base64url(crypto.randomBytes(32));
        const codeChallenge = this.base64url(
            crypto.createHash('sha256').update(codeVerifier).digest()
        );

        await this.storeState(state, {
            codeVerifier,
            redirect: this.normalizeRedirect(redirect),
            frontendOrigin
        });

        const authorizationUrl = new URL(discovery.authorization_endpoint);
        authorizationUrl.searchParams.set('response_type', 'code');
        authorizationUrl.searchParams.set('client_id', this.cpOAuthConfig.clientId);
        authorizationUrl.searchParams.set('redirect_uri', this.cpOAuthConfig.redirectUri);
        authorizationUrl.searchParams.set('scope', this.cpOAuthConfig.scopes.join(' '));
        authorizationUrl.searchParams.set('state', state);
        authorizationUrl.searchParams.set('code_challenge', codeChallenge);
        authorizationUrl.searchParams.set('code_challenge_method', 'S256');

        return authorizationUrl.toString();
    }

    private static async exchangeCode(code: string, codeVerifier: string): Promise<string> {
        const discovery = await this.getDiscoveryDocument();
        const body: Record<string, string> = {
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.cpOAuthConfig.redirectUri,
            client_id: this.cpOAuthConfig.clientId,
            code_verifier: codeVerifier
        };

        if (this.cpOAuthConfig.clientSecret) body.client_secret = this.cpOAuthConfig.clientSecret;

        const response = await axios.post<CpOAuthTokenResponse>(discovery.token_endpoint, body, {
            timeout: config.network.timeout,
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.data.access_token) throw new Error('CP OAuth did not return access_token');
        return response.data.access_token;
    }

    private static async fetchUserInfo(accessToken: string): Promise<CpOAuthUserInfo> {
        const discovery = await this.getDiscoveryDocument();
        const response = await axios.get<CpOAuthUserInfo>(discovery.userinfo_endpoint, {
            timeout: config.network.timeout,
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;
    }

    private static extractLuoguAccount(userInfo: CpOAuthUserInfo): CpOAuthLinkedAccount {
        const luoguAccount = userInfo.linked_accounts?.find(
            account => account.platform === 'luogu'
        );
        if (!luoguAccount || !luoguAccount.platformUid) {
            throw new Error(
                '当前 CP OAuth 账号尚未绑定洛谷账号。要绑定，请前往 https://www.cpoauth.com/profile?tab=bindings 并按提示操作。'
            );
        }
        return luoguAccount;
    }

    static async completeCpOAuthLogin(
        code: string,
        codeVerifier: string
    ): Promise<LocalLoginResult> {
        const accessToken = await this.exchangeCode(code, codeVerifier);
        const userInfo = await this.fetchUserInfo(accessToken);
        if (!userInfo.sub) throw new Error('CP OAuth did not return sub');

        const luoguAccount = this.extractLuoguAccount(userInfo);
        const luoguUid = Number(luoguAccount.platformUid);

        if (!Number.isInteger(luoguUid) || luoguUid <= 0) {
            throw new Error('Linked Luogu account ID is invalid');
        }

        const registeredUser = await RegisteredUserService.upsertCpOAuthUser({
            cpOAuthSub: userInfo.sub,
            luoguUid,
            name:
                luoguAccount.platformUsername ||
                userInfo.display_name ||
                userInfo.username ||
                `User ${luoguUid}`,
            avatarUrl: userInfo.avatar_url
        });

        if (!registeredUser.token) throw new Error('Registered user token is missing');

        return {
            token: registeredUser.token,
            uid: registeredUser.id,
            role: registeredUser.role
        };
    }
}
