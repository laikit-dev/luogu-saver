import { effectScope, ref, watch, type Ref } from 'vue';

const sharedRefs = new Map<string, Ref<unknown>>();

// Persistence watchers live in a detached scope so they keep running after the component
// that first requested a key unmounts.
const persistenceScope = effectScope(true);

function readStoredValue<T>(key: string, initialValue: T): T {
    let storedValue: string | null = null;
    try {
        storedValue = localStorage.getItem(key);
    } catch (e) {
        console.error(`Error reading localStorage key "${key}":`, e);
    }

    if (!storedValue) return initialValue;

    if (typeof initialValue === 'number') {
        const parsed = Number(storedValue);
        return isNaN(parsed) ? initialValue : (parsed as T);
    }
    if (typeof initialValue === 'boolean') {
        if (storedValue === 'true') return true as T;
        if (storedValue === 'false') return false as T;
        return initialValue;
    }
    try {
        return JSON.parse(storedValue) as T;
    } catch {
        return storedValue as T;
    }
}

/**
 * Returns the reactive value persisted under `key`.
 *
 * Every caller that passes the same key receives the same ref, so a write from one module is
 * immediately visible to all others. `initialValue` is used only when the key is first requested
 * and nothing is stored yet; it also selects how the stored string is parsed. Assigning `null` or
 * `undefined` removes the key from storage.
 */
export function useLocalStorage<T>(key: string, initialValue: T): Ref<T | null> {
    const existing = sharedRefs.get(key);
    if (existing) return existing as Ref<T | null>;

    const value = ref<T | null>(readStoredValue(key, initialValue)) as Ref<T | null>;
    sharedRefs.set(key, value as Ref<unknown>);

    persistenceScope.run(() => {
        watch(
            value,
            newValue => {
                try {
                    if (newValue === undefined || newValue === null) {
                        localStorage.removeItem(key);
                    } else {
                        localStorage.setItem(key, JSON.stringify(newValue));
                    }
                } catch (e) {
                    console.error(`Error saving to localStorage key "${key}":`, e);
                }
            },
            { deep: true, flush: 'sync' }
        );
    });

    return value;
}
