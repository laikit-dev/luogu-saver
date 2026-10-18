import { computed } from 'vue';
import { useLocalStorage } from '@/composables/useLocalStorage.ts';
import { CONSENT_TRACKING_STORAGE_KEY } from '@/utils/constants.ts';

export type TrackingConsent = 'unset' | 'allowed' | 'denied';

/** Single source of truth for the tracking consent; `unset` means the user has not chosen yet. */
export const trackingConsent = useLocalStorage<TrackingConsent>(
    CONSENT_TRACKING_STORAGE_KEY,
    'unset'
);

export const trackingAllowed = computed(() => trackingConsent.value === 'allowed');
