import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from './base';

@Entity({ name: 'judgement_visibility_request' })
export class JudgementVisibilityRequest extends BaseEntity {
    @PrimaryColumn({ type: 'int', unsigned: true })
    uid: number;

    @Column({ name: 'hidden_until', type: 'int', unsigned: true })
    hiddenUntil: number;

    @CreateDateColumn({ name: 'created_at', type: 'datetime' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
    updatedAt: Date;
}
