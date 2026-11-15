import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn
} from 'typeorm';
import { BaseEntity } from './base';
import { User, type UserPrize } from './user';
import type { UserColor } from '@/shared/user';

export interface ProfileSnapshotData {
    id: number;
    name: string;
    color: UserColor;
    ccfLevel: number;
    xcpcLevel: number;
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[];
}

@Entity({ name: 'user_profile_history' })
@Index('idx_user_profile_history_user_version', ['userId', 'version'], { unique: true })
@Index('idx_user_profile_history_user_created_id', ['userId', 'createdAt', 'id'])
export class UserProfileHistory extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
    id: number;

    @Column({ name: 'user_id', type: 'int', unsigned: true })
    userId: number;

    @Column({ type: 'int', unsigned: true })
    version: number;

    @Column({ type: 'json' })
    snapshot: ProfileSnapshotData;

    @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user?: User;

    @CreateDateColumn({ name: 'created_at', type: 'datetime' })
    createdAt: Date;
}
