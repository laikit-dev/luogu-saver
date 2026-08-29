import { apiFetch } from '@/utils/request.ts';
import type { ApiResponse } from '@/types/common';
import type { Announcement } from '@/api/announcement.ts';
import type { NotificationChannel } from '@/api/notification.ts';

export interface AdminUser {
    id: number;
    luoguUid: number;
    name: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
    role: number | null;
}

export interface DiscoveryRun {
    id: string;
    seedUrl: string;
    status: string;
    maxPages: number;
    forceUpdate: boolean;
    visitedPages: number;
    failedPages: number;
    pendingPages: number;
    discoveredArticles: number;
    createdWorkflows: number;
    lastError: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AdminSiteNotification {
    id?: number;
    channel: NotificationChannel;
    title: string;
    content: string;
    enabled: boolean;
    loginOnly: boolean;
    sortOrder: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface AdminAdvertisement {
    id?: number;
    imageUrl: string;
    altText: string;
    targetUrl: string | null;
    enabled: boolean;
    sortOrder: number;
    createdAt?: string;
    updatedAt?: string;
}

interface CreateWorkflowTemplateResponse {
    workflowId: string;
    taskIds: Record<string, string>;
    reportTaskIds: Record<string, string>;
    trackTaskIds: Record<string, string>;
}

export async function getAdminUsers() {
    return (await apiFetch('/admin/users')) as ApiResponse<AdminUser[]>;
}

export async function updateAdminUserRole(uid: number, role: number) {
    return (await apiFetch(`/admin/users/${uid}/role`, {
        method: 'PATCH',
        data: { role }
    })) as ApiResponse<{ uid: number; role: number }>;
}

export async function reindexSearch(batchSize: number = 100) {
    return (await apiFetch('/admin/search/reindex', {
        method: 'POST',
        data: { batchSize }
    })) as ApiResponse<CreateWorkflowTemplateResponse>;
}

export async function rebuildArticleSummaries(batchSize: number = 20, concurrency: number = 5) {
    return (await apiFetch('/admin/articles/summary/rebuild', {
        method: 'POST',
        data: { batchSize, concurrency }
    })) as ApiResponse<CreateWorkflowTemplateResponse>;
}

export async function rebuildArticleEmbeddings(batchSize: number = 20, concurrency: number = 5) {
    return (await apiFetch('/admin/articles/embedding/rebuild', {
        method: 'POST',
        data: { batchSize, concurrency }
    })) as ApiResponse<CreateWorkflowTemplateResponse>;
}

export async function restoreArticle(id: string) {
    return (await apiFetch(`/admin/articles/${id}/restore`, {
        method: 'POST'
    })) as ApiResponse<{ id: string; restored: boolean }>;
}

export async function restorePaste(id: string) {
    return (await apiFetch(`/admin/pastes/${id}/restore`, {
        method: 'POST'
    })) as ApiResponse<{ id: string; restored: boolean }>;
}

export async function getAdminAnnouncement() {
    return (await apiFetch('/admin/announcement')) as ApiResponse<Announcement>;
}

export async function updateAdminAnnouncement(data: {
    title: string;
    content: string;
    enabled: boolean;
}) {
    return (await apiFetch('/admin/announcement', {
        method: 'PUT',
        data
    })) as ApiResponse<Announcement>;
}

export async function getAdminNotifications() {
    return (await apiFetch('/admin/notifications')) as ApiResponse<{
        notifications: AdminSiteNotification[];
    }>;
}

export async function updateAdminNotifications(notifications: AdminSiteNotification[]) {
    return (await apiFetch('/admin/notifications', {
        method: 'PUT',
        data: { notifications }
    })) as ApiResponse<{ notifications: AdminSiteNotification[] }>;
}

export async function getAdminAdvertisements() {
    return (await apiFetch('/admin/advertisements')) as ApiResponse<{
        advertisements: AdminAdvertisement[];
    }>;
}

export async function updateAdminAdvertisements(advertisements: AdminAdvertisement[]) {
    return (await apiFetch('/admin/advertisements', {
        method: 'PUT',
        data: { advertisements }
    })) as ApiResponse<{ advertisements: AdminAdvertisement[] }>;
}

export async function getDiscoveryRuns(limit: number = 20) {
    return (await apiFetch('/discover/runs', {
        params: { limit }
    })) as ApiResponse<DiscoveryRun[]>;
}

export async function stopDiscoveryRun(runId: string) {
    return (await apiFetch(`/discover/runs/${runId}/stop`, {
        method: 'POST'
    })) as ApiResponse<{ runId: string }>;
}
