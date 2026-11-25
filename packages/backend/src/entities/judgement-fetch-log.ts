import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from './base';

export type JudgementFetchStatus = 'success' | 'error';
export type JudgementFetchSource = 'luogu' | 'peer';

@Entity({ name: 'judgement_fetch_log' })
export class JudgementFetchLog extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
    id: number;

    @CreateDateColumn({ name: 'fetched_at', type: 'datetime' })
    fetchedAt: Date;

    @Column({ name: 'record_count', type: 'int', unsigned: true })
    recordCount: number;

    @Column({ name: 'new_record_count', type: 'int', unsigned: true, default: 0 })
    newRecordCount: number;

    @Column({ name: 'skipped_count', type: 'int', unsigned: true, default: 0 })
    skippedCount: number;

    @Column({ type: 'varchar', length: 16, default: 'success' })
    status: JudgementFetchStatus;

    @Column({ name: 'error_message', type: 'varchar', length: 255, nullable: true })
    errorMessage: string | null;

    @Column({ name: 'raw_response', type: 'longtext', nullable: true, select: false })
    rawResponse: string | null;

    @Column({ type: 'varchar', length: 16, default: 'luogu' })
    source: JudgementFetchSource;
}
