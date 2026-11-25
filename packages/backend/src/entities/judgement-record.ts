import { createHash } from 'node:crypto';
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
import { JudgementFetchLog } from './judgement-fetch-log';

export function createJudgementDedupKey(record: {
    uid: number;
    time: number;
    reason?: string | null;
    revokedPermission: number;
    addedPermission: number;
}): string {
    return createHash('sha256')
        .update(
            JSON.stringify([
                record.uid,
                record.time,
                record.reason ?? '',
                record.revokedPermission,
                record.addedPermission
            ])
        )
        .digest('hex');
}

@Entity({ name: 'judgement_record' })
@Index('idx_judgement_record_time_id', ['time', 'id'])
@Index('idx_judgement_record_uid_time_id', ['uid', 'time', 'id'])
@Index('idx_judgement_record_fetch_log_id', ['fetchLogId'])
@Index('idx_judgement_record_created_at_id', ['createdAt', 'id'])
export class JudgementRecord extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
    id: number;

    @Index('uq_judgement_record_dedup_key', { unique: true })
    @Column({ name: 'dedup_key', type: 'char', length: 64 })
    dedupKey: string;

    @Column({ type: 'int', unsigned: true })
    uid: number;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @Column({ name: 'revoked_permission', type: 'int', unsigned: true, default: 0 })
    revokedPermission: number;

    @Column({ name: 'added_permission', type: 'int', unsigned: true, default: 0 })
    addedPermission: number;

    @Column({ type: 'int', unsigned: true })
    time: number;

    @Column({ name: 'user_snapshot', type: 'json' })
    userSnapshot: Record<string, unknown>;

    @Column({ name: 'full_record', type: 'json' })
    fullRecord: Record<string, unknown>;

    @Column({ name: 'fetch_log_id', type: 'int', unsigned: true })
    fetchLogId: number;

    @ManyToOne(() => JudgementFetchLog, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'fetch_log_id' })
    fetchLog: JudgementFetchLog;

    @CreateDateColumn({ name: 'created_at', type: 'datetime' })
    createdAt: Date;
}
