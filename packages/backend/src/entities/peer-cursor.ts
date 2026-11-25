import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from './base';

/** Last applied `next` cursor of one stream of one peer feed; an absent row means `""`. */
@Entity({ name: 'peer_cursor' })
export class PeerCursor extends BaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 255 })
    peer: string;

    @PrimaryColumn({ type: 'varchar', length: 32 })
    stream: string;

    @Column({ name: 'cursor_value', type: 'text' })
    cursorValue: string;

    // `after` of a page rolled back once because it referenced users absent locally.
    @Column({ name: 'deferred_cursor', type: 'text', nullable: true })
    deferredCursor: string | null;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
