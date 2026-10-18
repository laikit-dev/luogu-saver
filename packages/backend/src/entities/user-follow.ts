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
import { RegisteredUser } from './registered-user';

@Entity({ name: 'user_follow' })
@Index('idx_user_follow_owner_uid', ['ownerId', 'luoguUid'], { unique: true })
@Index('idx_user_follow_owner_created_at_id', ['ownerId', 'createdAt', 'id'])
export class UserFollow extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
    id: number;

    @Column({ name: 'owner_id', type: 'int', unsigned: true })
    ownerId: number;

    @Column({ name: 'luogu_uid', type: 'int', unsigned: true })
    luoguUid: number;

    @CreateDateColumn({
        name: 'created_at',
        type: 'datetime',
        precision: 3,
        default: () => 'CURRENT_TIMESTAMP(3)'
    })
    createdAt: Date;

    @ManyToOne(() => RegisteredUser, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'owner_id' })
    owner?: RegisteredUser;
}
