import { z } from 'zod';

export const FrontendOriginSchema = z.string().refine(origin => {
    try {
        const url = new URL(origin);
        return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            url.origin === origin &&
            !url.hostname.includes('*')
        );
    } catch {
        return false;
    }
}, 'Expected an exact HTTP(S) origin without a path, credentials, or wildcard');

const CpOAuthSchema = z.object({
    discoveryUrl: z.string().default('https://www.cpoauth.com/.well-known/openid-configuration'),
    clientId: z.string().default(''),
    clientSecret: z.string().default(''),
    redirectUri: z.string().default(''),
    frontendRedirectUri: z.string().default('/auth/callback'),
    allowedFrontendOrigins: z.array(FrontendOriginSchema).default([]),
    scopes: z.array(z.string()).default(['openid', 'profile', 'link:luogu']),
    stateExpireSeconds: z.number().default(600)
});

export const AuthSchema = z.object({
    cpOAuth: z.preprocess(value => value ?? {}, CpOAuthSchema)
});
