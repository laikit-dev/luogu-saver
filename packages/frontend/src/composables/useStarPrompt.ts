import { readonly } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { GITHUB_STAR_PROMPT_STORAGE_KEY } from '@/utils/constants.ts';

export type StarPromptState = 'idle' | 'eligible' | 'opened' | 'dismissed';

const VALID_STATES: Record<StarPromptState, true> = {
    idle: true,
    eligible: true,
    opened: true,
    dismissed: true
};
const promptState = useLocalStorage<StarPromptState>(GITHUB_STAR_PROMPT_STORAGE_KEY, 'idle');

function parseStoredState(value: string | null): StarPromptState {
    if (value === null) return 'idle';
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'string' && parsed in VALID_STATES
            ? (parsed as StarPromptState)
            : 'idle';
    } catch {
        return 'idle';
    }
}

export function markStarPromptEligible() {
    if (promptState.value === 'idle') {
        promptState.value = 'eligible';
    }
}

export function useStarPrompt() {
    const markOpened = () => {
        promptState.value = 'opened';
    };

    const dismiss = () => {
        promptState.value = 'dismissed';
    };

    const syncStoredState = (value: string | null) => {
        promptState.value = parseStoredState(value);
    };

    return {
        state: readonly(promptState),
        markOpened,
        dismiss,
        syncStoredState
    };
}
