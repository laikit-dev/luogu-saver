import type { UserSummary } from '@/types/luogu-api';
import { User } from '@/entities/user';
import { UserColor } from '@/shared/user';

export function buildUser(user: UserSummary): Partial<User> {
    return {
        id: user.uid,
        name: user.name,
        color: user.color as UserColor,
        ccfLevel: user.ccfLevel ?? 0,
        xcpcLevel: user.xcpcLevel ?? 0,
        badge: user.badge
    };
}
