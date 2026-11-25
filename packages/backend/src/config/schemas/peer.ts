import { z } from 'zod';

const BaseUrlSchema = z
    .string()
    .default('')
    .refine(value => {
        if (value === '') return true;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }, 'Expected an empty string or an absolute http(s) URL')
    .transform(value => value.replace(/\/+$/, ''));

export const PeerSchema = z.object({
    baseUrl: BaseUrlSchema,
    token: z
        .string()
        .regex(/^[\x21-\x7e]*$/, 'Expected printable ASCII without spaces')
        .default(''),
    exportToken: z
        .string()
        .regex(
            /^(|[A-Za-z0-9_-]{43,})$/,
            'Expected an empty string or at least 43 characters of [A-Za-z0-9_-]'
        )
        .default(''),
    intervalMinutes: z.number().int().min(5).default(60)
});

export type PeerConfig = z.infer<typeof PeerSchema>;
