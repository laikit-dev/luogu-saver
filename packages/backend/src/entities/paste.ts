import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index
} from 'typeorm';

import { BaseEntity } from './base';

import { Type } from 'class-transformer';
import { User } from './user';

@Entity({ name: 'paste' })
@Index('idx_author_id', ['authorId'])
@Index('idx_paste_deleted', ['deleted'])
@Index('idx_paste_checked_at_id', ['checkedAt', 'id'])
@Index('idx_paste_checked_at_updated_at_id', ['checkedAt', 'updatedAt', 'id'])
export class Paste extends BaseEntity {
    @PrimaryColumn({ length: 8 })
    id: string;

    @Column({ type: 'mediumtext' })
    content: string;

    @Column({ name: 'author_id', unsigned: true })
    authorId: number;

    @Column({ type: 'tinyint', default: 0 })
    deleted: boolean;

    // Luogu's own publish time, unix seconds. Distinct from createdAt, which records when this
    // system first archived the row; for a late archive the two differ without bound. Null means
    // no non-skipped save has written it yet, and is never substituted with 0 or createdAt.
    @Column({ name: 'publish_time', type: 'int', unsigned: true, nullable: true })
    publishTime?: number | null;

    @CreateDateColumn({ name: 'created_at' })
    @Type(() => Date)
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    @Type(() => Date)
    updatedAt: Date;

    @Column({ name: 'delete_reason', default: '管理员删除' })
    deleteReason: string;

    @Column({ type: 'varchar', name: 'content_hash', nullable: true })
    contentHash?: string;

    // Latest comparison with Luogu, written by every successful save even when nothing changed.
    // NULL marks rows last saved before the column existed; readers fall back to updatedAt.
    @Column({ name: 'checked_at', type: 'datetime', precision: 3, nullable: true })
    @Type(() => Date)
    checkedAt?: Date | null;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'author_id' })
    author?: User;
}
