import 'koa';
import type { AuthenticatedUser } from '@/services/registered-user.service';

declare module 'koa' {
    interface Context {
        success(data?: any, msg?: string): void;
        fail(code: number, msg: string, data?: any): void;
        user: AuthenticatedUser;
        track(event: string, data: string): void;
    }
}
