/**
 * Instant conversions for peering.
 *
 * Instants are integer microseconds since the Unix epoch. Database `DATETIME` values are wall-clock
 * strings without zone; like mysql2 with `timezone: 'local'`, they are interpreted in the Node.js
 * process's local time zone, which must equal the MariaDB session time zone
 * (`spec/peering-system.spec.md` Section 10).
 */

export type Micros = number;

/** `DATE_FORMAT` pattern producing the wall-clock form parsed by {@link parseDbTime}. */
export const DB_TIME_FORMAT = '%Y-%m-%d %H:%i:%s.%f';

const DB_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{6})$/;
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

export const MICROS_PER_SECOND = 1_000_000;

function pad(value: number, width: number): string {
    return String(value).padStart(width, '0');
}

/** Returns the instant of a database wall-clock string, or null when it is not a valid one. */
export function parseDbTime(value: string): Micros | null {
    const match = DB_TIME_PATTERN.exec(value);
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const micros = Number(match[7]);
    const date = new Date(year, month - 1, day, hour, minute, second, Math.floor(micros / 1000));
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
    ) {
        return null;
    }
    return date.getTime() * 1000 + (micros % 1000);
}

/** Formats an instant as a database wall-clock string with six fractional digits. */
export function formatDbTime(instant: Micros): string {
    const date = new Date(Math.floor(instant / 1000));
    const micros = ((instant % MICROS_PER_SECOND) + MICROS_PER_SECOND) % MICROS_PER_SECOND;
    return (
        `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ` +
        `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.` +
        pad(micros, 6)
    );
}

/** Parses a protocol `Instant` (`YYYY-MM-DDTHH:mm:ss.sssZ`); null when malformed or invalid. */
export function parseInstant(value: unknown): Micros | null {
    if (typeof value !== 'string') return null;
    const match = INSTANT_PATTERN.exec(value);
    if (!match) return null;
    const millis = Date.parse(value);
    if (Number.isNaN(millis) || new Date(millis).toISOString() !== value) return null;
    return millis * 1000;
}

/** Formats an instant as a protocol `Instant`, truncating to milliseconds. */
export function formatInstant(instant: Micros): string {
    return new Date(Math.floor(instant / 1000)).toISOString();
}

/** Formats a database wall-clock string as a protocol `Instant`. */
export function dbTimeToInstant(value: string): string {
    const instant = parseDbTime(value);
    if (instant === null) throw new Error(`Invalid database time ${JSON.stringify(value)}`);
    return formatInstant(instant);
}

/** Unix seconds of an instant, rounded toward negative infinity (`unixSeconds` of the spec). */
export function toUnixSeconds(instant: Micros): number {
    return Math.floor(instant / MICROS_PER_SECOND);
}

export type FeedCursorKey = string | number;

/** Encodes a feed cursor: base64url of `JSON.stringify([dbTime, key])`. */
export function encodeFeedCursor(dbTime: string, key: FeedCursorKey): string {
    return Buffer.from(JSON.stringify([dbTime, key]), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor issued by {@link encodeFeedCursor}. `keyKind` selects the key type of the
 * stream. Returns null for any value this server could not have issued.
 */
export function decodeFeedCursor(
    cursor: string,
    keyKind: 'string' | 'integer'
): { time: string; key: FeedCursorKey } | null {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
    let decoded: unknown;
    try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [time, key] = decoded;
    if (typeof time !== 'string' || parseDbTime(time) === null) return null;
    if (keyKind === 'string') {
        if (typeof key !== 'string' || key.length < 1 || key.length > 8) return null;
    } else if (!Number.isSafeInteger(key) || key < 1) {
        return null;
    }
    return { time, key };
}
