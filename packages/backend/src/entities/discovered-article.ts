import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index
} from 'typeorm';
import { BaseEntity } from './base';

export enum DiscoveredArticleStatus {
    DISCOVERED = 'discovered',
    WORKFLOW_CREATED = 'workflow_created',
    SKIPPED = 'skipped',
    FAILED = 'failed'
}

export enum DiscoveredArticleSource {
    USER_ARTICLES = 'user_articles'
}

@Entity({ name: 'discovered_article' })
@Index('idx_discovered_article_run_article', ['runId', 'articleId'], { unique: true })
@Index('idx_discovered_article_run_status', ['runId', 'status'])
export class DiscoveredArticle extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'run_id' })
    runId: string;

    @Column({ name: 'article_id', type: 'varchar', length: 8 })
    articleId: string;

    @Column()
    source: DiscoveredArticleSource;

    @Column({ default: DiscoveredArticleStatus.DISCOVERED })
    status: DiscoveredArticleStatus;

    @Column({ name: 'workflow_id', type: 'varchar', length: 36, nullable: true })
    workflowId: string | null;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @Column({ name: 'last_seen_at', type: 'datetime' })
    lastSeenAt: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
