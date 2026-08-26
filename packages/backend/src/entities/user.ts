import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import { BaseEntity } from './base';

import { UserColor, UserPrize } from '@/shared/user';
import { Cacheable } from '@/decorators/cacheable';

@Entity({ name: 'user' })
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
    slogan: string | null;

    @Column({ type: 'mediumtext', nullable: true })
    introduction: string | null;

    @Column({ type: 'json', nullable: true })
    prizes: UserPrize[] | null;

    @Column({ name: 'profile_fetched_at', type: 'datetime', nullable: true })
    profileFetchedAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: number;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: number;

    @Cacheable(3600 * 24 * 3, id => `user:${id}`, User)
    static async findById(id: number) {
        return await User.findOne({ where: { id } });
    }
}
