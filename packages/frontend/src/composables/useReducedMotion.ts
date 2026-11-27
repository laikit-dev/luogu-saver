import { useMotionPreference } from '@/composables/useMotionPreference.ts';

export function useReducedMotion() {
    return useMotionPreference().reducedMotion;
}
