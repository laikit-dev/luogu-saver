import { User } from './user';

export interface Paste {
    id: string;
    content: string;
    authorId?: number;
    deleted: boolean;
    publishTime?: number | null;
    createdAt: string;
    updatedAt: string;
    deleteReason: string;
    author?: User;
}
