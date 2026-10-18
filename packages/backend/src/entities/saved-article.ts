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
import { Article } from './article';

@Entity({ name: 'saved_article' })
@Index('idx_saved_article_owner_article', ['ownerId', 'articleId'], { unique: true })
@Index('idx_saved_article_owner_created_at_id', ['ownerId', 'createdAt', 'id'])
export class SavedArticle extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
    id: number;

    @Column({ name: 'owner_id', type: 'int', unsigned: true })
    ownerId: number;

    @Column({ name: 'article_id', type: 'varchar', length: 8 })
    articleId: string;

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

    @ManyToOne(() => Article, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'article_id' })
    article?: Article;
}
