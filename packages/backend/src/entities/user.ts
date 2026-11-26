import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

import { BaseEntity } from './base';

import { UserColor } from '@/shared/user';
import { Cacheable } from '@/decorators/cacheable';

export interface UserPrize {
    year: number;
    contest: string;
    event: string | null;
    prize: string;
    score?: number;
    rank?: number;
}

@Entity({ name: 'user' })
@Index('idx_user_updated_at_id', ['updatedAt', 'id'])
@Index('idx_user_color_ccf_level', ['color', 'ccfLevel'])
export class User extends BaseEntity {
    @PrimaryColumn({ type: 'int', unsigned: true })
    id: number;

    @Column()
    name: string;

    @Column({ type: 'varchar' })
    color: UserColor;

    @Column({ name: 'ccf_level', type: 'int', default: 0 })
    ccfLevel: number;

    @Column({ name: 'xcpc_level', type: 'int', default: 0 })
    xcpcLevel: number;

    @Column({ type: 'text', nullable: true })
    badge: string | null;

    @Column({ type: 'text', nullable: true })
    slogan: string | null;

    @Column({ type: 'mediumtext', nullable: true })
    introduction: string | null;

    @Column({ type: 'json', nullable: true })
    prizes: UserPrize[] | null;

    @Column({ name: 'profile_fetched_at', type: 'datetime', nullable: true })
    profileFetchedAt: Date | null;

    @Column({ name: 'profile_history_enabled', type: 'boolean', default: true })
    profileHistoryEnabled: boolean;

    @Column({ name: 'profile_history_version', type: 'int', unsigned: true, default: 0 })
    profileHistoryVersion: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: number;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: number;

    @Cacheable(3600 * 24 * 3, id => `user:${id}`, User)
    static async findById(id: number) {
        return await User.findOne({ where: { id } });
    }
}
