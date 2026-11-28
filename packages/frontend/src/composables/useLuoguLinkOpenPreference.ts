import { computed, ref } from 'vue';
import type { Router } from 'vue-router';
import { useLocalStorage } from '@/composables/useLocalStorage';
import { LUOGU_LINK_OPEN_MODE_STORAGE_KEY } from '@/utils/constants';

export type LuoguLinkOpenMode = 'ask' | 'saver' | 'luogu';

export interface LuoguLinkPromptRequest {
    kind: 'article' | 'paste';
    id: string;
    inSitePath: string;
    externalHref: string;
    title?: string;
}

export const LUOGU_LINK_OPEN_MODE_OPTIONS: { label: string; value: LuoguLinkOpenMode }[] = [
    { label: '每次询问', value: 'ask' },
    { label: '始终在保存站查看', value: 'saver' },
    { label: '始终打开洛谷原站', value: 'luogu' }
];

const VALID_MODES = new Set<LuoguLinkOpenMode>(['ask', 'saver', 'luogu']);

const storedMode = useLocalStorage<LuoguLinkOpenMode>(LUOGU_LINK_OPEN_MODE_STORAGE_KEY, 'ask');
if (storedMode.value && !VALID_MODES.has(storedMode.value)) {
    storedMode.value = 'ask';
}

const mode = computed<LuoguLinkOpenMode>({
    get: () => {
        const val = storedMode.value;
        return val && VALID_MODES.has(val) ? val : 'ask';
    },
    set: value => {
        storedMode.value = VALID_MODES.has(value) ? value : 'ask';
    }
});

const pendingLinkPrompt = ref<LuoguLinkPromptRequest | null>(null);

function closePrompt() {
    pendingLinkPrompt.value = null;
}

export function openLuoguContentLink(request: LuoguLinkPromptRequest, router: Router): void {
    if (mode.value === 'saver') {
        void router.push(request.inSitePath);
        return;
    }
    if (mode.value === 'luogu') {
        window.open(request.externalHref, '_blank', 'noopener,noreferrer');
        return;
    }
    pendingLinkPrompt.value = request;
}

export function useLuoguLinkOpenPreference() {
    return {
        mode,
        modeOptions: LUOGU_LINK_OPEN_MODE_OPTIONS,
        pendingPrompt: pendingLinkPrompt,
        closePrompt
    };
}
