import { RegisteredUser } from '@/entities/registered-user';
import { Not } from 'typeorm';
import crypto from 'crypto';
import { ROLE_DEFAULT } from '@/shared/permission';

export interface AuthenticatedUser {
    id: number;
    role: number;
    luoguUid: number;
}

type CpOAuthRegisteredUserData = {
    cpOAuthSub: string;
    luoguUid: number;
    name?: string;
    avatarUrl?: string;
};

export class RegisteredUserService {
    private static isDuplicateKeyError(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: string }).code === 'ER_DUP_ENTRY'
        );
    }

    static async upsertCpOAuthUser(data: CpOAuthRegisteredUserData): Promise<RegisteredUser> {
        if (!data.cpOAuthSub) throw new Error('CP OAuth sub is required');
        if (!Number.isInteger(data.luoguUid) || data.luoguUid <= 0) {
            throw new Error('Positive Luogu user ID is required');
        }

        const repository = RegisteredUser.getRepository();
        const duplicateLuoguUid = await repository.findOne({
            where: {
                luoguUid: data.luoguUid,
                cpOAuthSub: Not(data.cpOAuthSub)
            }
        });

        if (duplicateLuoguUid) {
            throw new Error('Luogu account is already bound to another CP OAuth account');
        }

        const existing = await repository.findOne({ where: { cpOAuthSub: data.cpOAuthSub } });
        const registeredUser = repository.create({
            id: existing?.id,
            cpOAuthSub: data.cpOAuthSub,
            luoguUid: data.luoguUid,
            name: data.name || `User ${data.luoguUid}`,
            avatarUrl: data.avatarUrl || null,
            token: existing?.token || crypto.randomBytes(16).toString('hex'),
            role: existing?.role ?? ROLE_DEFAULT
        });

        try {
            await repository.upsert(registeredUser, ['cpOAuthSub']);
        } catch (error) {
            if (this.isDuplicateKeyError(error)) {
                throw new Error('Luogu account is already bound to another CP OAuth account');
            }
            throw error;
        }

        const saved = await repository.findOneByOrFail({ cpOAuthSub: data.cpOAuthSub });
        return saved;
    }

    static async getById(id: number): Promise<RegisteredUser | null> {
        return RegisteredUser.findOne({ where: { id } });
    }

    static async validateBearerToken(token: string): Promise<AuthenticatedUser | null> {
        const registeredUser = await RegisteredUser.findOne({
            where: { token },
            select: ['id', 'role', 'luoguUid']
        });
        return registeredUser
            ? {
                  id: registeredUser.id,
                  role: registeredUser.role,
                  luoguUid: registeredUser.luoguUid
              }
            : null;
    }

    static async updateRole(id: number, role: number): Promise<RegisteredUser | null> {
        const registeredUser = await RegisteredUser.findOne({ where: { id } });
        if (!registeredUser) return null;
        registeredUser.role = role;
        return registeredUser.save();
    }
}
