import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base';
import { RegisteredUser } from './registered-user';

@Entity({ name: 'archive_digest_preference' })
@Index('idx_archive_digest_due', ['enabled', 'nextDigestAt', 'ownerId'])
export class ArchiveDigestPreference extends BaseEntity {
    @PrimaryColumn({ name: 'owner_id', type: 'int', unsigned: true })
    ownerId: number;

    @Column({ type: 'boolean', default: false })
    enabled: boolean;

    @Column({ name: 'last_digest_at', type: 'datetime', precision: 3, nullable: true })
    lastDigestAt: Date | null;

    @Column({ name: 'next_digest_at', type: 'datetime', precision: 3, nullable: true })
    nextDigestAt: Date | null;

    @ManyToOne(() => RegisteredUser, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'owner_id' })
    owner?: RegisteredUser;
}
