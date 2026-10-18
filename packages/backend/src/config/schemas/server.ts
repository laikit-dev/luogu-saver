import { z } from 'zod';
import { FrontendOriginSchema } from './auth';

export const ServerSchema = z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().default(3000),
    env: z.string().default('development'),
    archive: z.preprocess(
        value => value ?? {},
        z.object({
            publicBaseUrl: FrontendOriginSchema.default('http://localhost:5173'),
            digestPollIntervalMs: z.number().int().min(60000).default(900000)
        })
    ),
    network: z.preprocess(
        value => value ?? {},
        z.object({
            timeout: z.number().default(30000),
            tor: z.preprocess(
                value => value ?? {},
                z.object({
                    enabled: z.boolean().default(false),
                    socksProxyUrl: z.string().default('socks5h://127.0.0.1:9050'),
                    controlHost: z.string().default('127.0.0.1'),
                    controlPort: z.number().default(9051),
                    controlPassword: z.string().default(''),
                    newnymCooldownMs: z.number().default(10000),
                    newnymLockTtlMs: z.number().default(30000),
                    native429FallbackTtlMs: z.number().default(7200000),
                    ipCheckUrl: z.string().default('https://api.ipify.org?format=json')
                })
            )
        })
    )
});
