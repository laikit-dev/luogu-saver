import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';
import { BaseEntity } from './base';

@Entity({ name: 'article_history' })
@Index('idx_article_id_version', ['articleId', 'version'])
@Index('idx_article_history_article_created_at_id', ['articleId', 'createdAt', 'id'])
export class ArticleHistory extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 8 })
    articleId: string;

    @Column({ type: 'int' })
    version: number;

    @Column({ type: 'varchar' })
    title: string;

    @Column({ type: 'mediumtext' })
    content: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
