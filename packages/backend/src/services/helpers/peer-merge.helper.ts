/**
 * Pure merge rules of Peering Protocol v1 (`spec/peering-system.spec.md` Sections 6 and 7).
 *
 * Nothing in this module performs I/O. Instants are microseconds since the Unix epoch, already
 * truncated to the precision of the column that stores them.
 */
import type { UserPrize } from '@/entities/user';
import type { Micros } from '@/services/helpers/peer-time.helper';

// ---------------------------------------------------------------------------------------------
// Section 7: version merge
// ---------------------------------------------------------------------------------------------

/**
 * One observation of a text. `text` is the comparison key: two observations have equal texts iff
 * their keys are equal strings. `source` tells the caller where the text can be copied from.
 */
export interface Observation<S> {
    time: Micros;
    text: string;
    source: S;
}

export interface VersionMergeInput<S> {
    /** Locally stored versions in ascending version order. */
    stored: readonly Observation<S>[];
    /** Local current text at the local `checkedAt` / `profile.fetchedAt`, when it exists. */
    localCurrent: Observation<S> | null;
    incoming: readonly Observation<S>[];
    /** Incoming current text at its `checkedAt` / `profile.fetchedAt`, when the item has one. */
    incomingCurrent: Observation<S> | null;
}

/**
 * Section 7: concatenates the four observation groups in order, sorts them stably by time, and
 * removes every observation whose text equals the text of the observation kept before it. The
 * result, numbered from 1, is the new version list; its last element holds the current text.
 */
export function mergeVersions<S>(input: VersionMergeInput<S>): Observation<S>[] {
    const sequence = [
        ...input.stored,
        ...(input.localCurrent ? [input.localCurrent] : []),
        ...input.incoming,
        ...(input.incomingCurrent ? [input.incomingCurrent] : [])
    ];
    // Array.prototype.sort is stable, so equal times keep the group order above.
    sequence.sort((left, right) => left.time - right.time);

    const kept: Observation<S>[] = [];
    for (const observation of sequence) {
        if (kept.length === 0 || kept[kept.length - 1].text !== observation.text) {
            kept.push(observation);
        }
    }
    return kept;
}

/** Version list plus current text of one article or profile, as the fold below sees it. */
export interface VersionState<S> {
    versions: Observation<S>[];
    /** Current text and its source; null when the record does not exist locally. */
    current: { text: string; source: S } | null;
    /** Local `checkedAt` / `profile.fetchedAt`; null when there is no current text. */
    currentTime: Micros | null;
}

/**
 * Applies one item to a version state: one Section 7 merge with the item's versions and current
 * text. When `adoptLastAsCurrent` holds (articles), the current text becomes the last version's,
 * and `asCurrentSource` converts that version's source into the source of a current text.
 *
 * Items of one page are folded one after another rather than merged together because the merge is
 * not associative: a text removed as a duplicate in one step no longer separates later insertions.
 */
export function applyVersionItem<S>(
    state: VersionState<S>,
    incoming: readonly Observation<S>[],
    incomingCurrent: Observation<S> | null,
    adoptLastAsCurrent: boolean,
    asCurrentSource: (source: S) => S
): VersionState<S> {
    const localCurrent =
        state.current && state.currentTime !== null
            ? { time: state.currentTime, text: state.current.text, source: state.current.source }
            : null;
    const versions = mergeVersions({
        stored: state.versions,
        localCurrent,
        incoming,
        incomingCurrent
    });
    const last = versions[versions.length - 1];
    if (!adoptLastAsCurrent || !last) return { ...state, versions };
    return {
        versions,
        current: { text: last.text, source: asCurrentSource(last.source) },
        currentTime: state.currentTime
    };
}

export interface StoredVersionRow {
    rowId: number;
    version: number;
    /** Text key of the stored row; required only when rows may be reused. */
    text?: string;
}

export interface VersionListPlan<S> {
    /** Stored rows that stay; `newVersion` differs from `oldVersion` when renumbered. */
    retained: { rowId: number; oldVersion: number; newVersion: number }[];
    /**
     * Stored rows that leave the list but carry the text of a new entry: the row takes the new
     * entry's version number and creation time instead of being deleted and copied.
     */
    relocated: { rowId: number; version: number; observation: Observation<S> }[];
    /** List entries that need a new row, with their version number. */
    inserted: { version: number; observation: Observation<S> }[];
    /** Stored rows that left the list. */
    removed: number[];
    unchanged: boolean;
}

/**
 * Diffs a merged version list against the stored rows. `storedRowId` returns the row ID when an
 * observation is a stored row at its own creation time, and null when it needs a new row. With
 * `reuseRows`, a new entry whose text equals that of a stored row leaving the list relocates that
 * row; the resulting list is the same, but no text is copied.
 */
export function planVersionList<S>(
    stored: readonly StoredVersionRow[],
    merged: readonly Observation<S>[],
    storedRowId: (source: S) => number | null,
    reuseRows = false
): VersionListPlan<S> {
    const oldVersions = new Map(stored.map(row => [row.rowId, row.version]));
    const retained: VersionListPlan<S>['retained'] = [];
    const pending: VersionListPlan<S>['inserted'] = [];
    merged.forEach((observation, index) => {
        const rowId = storedRowId(observation.source);
        const oldVersion = rowId === null ? undefined : oldVersions.get(rowId);
        if (rowId !== null && oldVersion !== undefined) {
            retained.push({ rowId, oldVersion, newVersion: index + 1 });
        } else {
            pending.push({ version: index + 1, observation });
        }
    });
    const retainedIds = new Set(retained.map(row => row.rowId));
    const leaving = stored.filter(row => !retainedIds.has(row.rowId));

    const relocated: VersionListPlan<S>['relocated'] = [];
    const inserted: VersionListPlan<S>['inserted'] = [];
    for (const entry of pending) {
        const index = reuseRows
            ? leaving.findIndex(row => row.text === entry.observation.text)
            : -1;
        if (index < 0) {
            inserted.push(entry);
        } else {
            relocated.push({ rowId: leaving[index].rowId, ...entry });
            leaving.splice(index, 1);
        }
    }
    return {
        retained,
        relocated,
        inserted,
        removed: leaving.map(row => row.rowId),
        unchanged:
            relocated.length === 0 &&
            inserted.length === 0 &&
            leaving.length === 0 &&
            retained.every(row => row.oldVersion === row.newVersion)
    };
}

// ---------------------------------------------------------------------------------------------
// Section 6.1: users
// ---------------------------------------------------------------------------------------------

export interface UserDetails {
    name: string;
    color: string;
    ccfLevel: number;
    xcpcLevel: number;
    badge: string | null;
}

export interface UserProfileFields {
    slogan: string | null;
    introduction: string | null;
    prizes: UserPrize[];
    fetchedAt: Micros;
}

export interface UserRecord {
    details: UserDetails;
    changedAt: Micros;
    profile: UserProfileFields | null;
}

/** `T(x) = max(x.changedAt, x.profile.fetchedAt)`; an absent profile contributes nothing. */
export function userCursorTime(record: UserRecord): Micros {
    return record.profile ? Math.max(record.changedAt, record.profile.fetchedAt) : record.changedAt;
}

export interface UserMergeResult {
    record: UserRecord;
    /** Rule 1 replaced the details. */
    detailsApplied: boolean;
    /** Rule 2 replaced the profile. */
    profileApplied: boolean;
}

/** Section 6.1 rules 1 and 2. Rule 3 is the caller's version merge. */
export function mergeUser(local: UserRecord | null, incoming: UserRecord): UserMergeResult {
    const detailsDiffer =
        !local ||
        local.details.name !== incoming.details.name ||
        local.details.color !== incoming.details.color ||
        local.details.ccfLevel !== incoming.details.ccfLevel ||
        local.details.xcpcLevel !== incoming.details.xcpcLevel ||
        local.details.badge !== incoming.details.badge;
    const detailsApplied =
        (!local || userCursorTime(incoming) > userCursorTime(local)) && detailsDiffer;
    const profileApplied =
        incoming.profile !== null &&
        (!local?.profile || incoming.profile.fetchedAt > local.profile.fetchedAt);

    const record: UserRecord = {
        details: detailsApplied || !local ? incoming.details : local.details,
        changedAt: !local
            ? incoming.changedAt
            : detailsApplied
              ? Math.max(local.changedAt, incoming.changedAt)
              : local.changedAt,
        profile: profileApplied ? incoming.profile : (local?.profile ?? null)
    };
    return { record, detailsApplied, profileApplied };
}

// ---------------------------------------------------------------------------------------------
// Sections 6.3 and 6.6: articles and pastes
// ---------------------------------------------------------------------------------------------

export interface ArchivedRecord<M> {
    meta: M;
    archivedAt: Micros;
    checkedAt: Micros;
}

export interface ArchivedMergeResult<M> extends ArchivedRecord<M> {
    /** Rule 3 applied: `meta` and `checkedAt` are the incoming ones. */
    metaApplied: boolean;
}

/**
 * Rules 2 and 3 of Sections 6.3 and 6.6. Rule 1 (local takedown) is the caller's check; rule 4 of
 * Section 6.3 is the caller's version merge. `meta` holds the fields rule 3 replaces.
 */
export function mergeArchived<M>(
    local: ArchivedRecord<M> | null,
    incoming: ArchivedRecord<M>
): ArchivedMergeResult<M> {
    if (!local) return { ...incoming, metaApplied: true };
    const metaApplied = incoming.checkedAt > local.checkedAt;
    return {
        meta: metaApplied ? incoming.meta : local.meta,
        archivedAt: Math.min(local.archivedAt, incoming.archivedAt),
        checkedAt: metaApplied ? incoming.checkedAt : local.checkedAt,
        metaApplied
    };
}

// ---------------------------------------------------------------------------------------------
// Section 6.5: comments
// ---------------------------------------------------------------------------------------------

export interface CommentsMergeResult<C> {
    /** Incoming comments absent locally. */
    inserted: C[];
    /** Incoming comments present locally whose content replaces the local content. */
    contentUpdated: C[];
    fetchedAt: Micros;
}

/**
 * Rules 2 and 3 of Section 6.5. `localContentHashes` maps each local comment ID to a hash of its
 * content; `contentHash` hashes an incoming comment the same way. A local `fetchedAt` of null
 * (never fetched) is older than every incoming fetch.
 */
export function mergeComments<C extends { id: number }>(
    local: { fetchedAt: Micros | null; contentHashes: ReadonlyMap<number, string> },
    incoming: { fetchedAt: Micros; comments: readonly C[] },
    contentHash: (comment: C) => string
): CommentsMergeResult<C> {
    const incomingNewer = local.fetchedAt === null || incoming.fetchedAt > local.fetchedAt;
    const inserted: C[] = [];
    const contentUpdated: C[] = [];
    for (const comment of incoming.comments) {
        const localHash = local.contentHashes.get(comment.id);
        if (localHash === undefined) inserted.push(comment);
        else if (incomingNewer && localHash !== contentHash(comment)) contentUpdated.push(comment);
    }
    return {
        inserted,
        contentUpdated,
        fetchedAt:
            local.fetchedAt === null
                ? incoming.fetchedAt
                : Math.max(local.fetchedAt, incoming.fetchedAt)
    };
}
