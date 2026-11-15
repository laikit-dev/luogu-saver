import { onBeforeUnmount, readonly, ref } from 'vue';

export function useReducedMotion() {
    const mediaQuery =
        typeof window === 'undefined'
            ? null
            : window.matchMedia('(prefers-reduced-motion: reduce)');
    const reducedMotion = ref(mediaQuery?.matches ?? false);
    const handleChange = (event: MediaQueryListEvent) => {
        reducedMotion.value = event.matches;
    };

    mediaQuery?.addEventListener('change', handleChange);
    onBeforeUnmount(() => mediaQuery?.removeEventListener('change', handleChange));

    return readonly(reducedMotion);
}
