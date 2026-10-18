import type { HTMLAttributes } from 'vue';

export const archiveTabProps: HTMLAttributes = {
    class: 'archive-accessible-tab',
    role: 'button',
    tabindex: 0,
    'aria-pressed': false,
    onKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.click();
    }
};

export const selectedArchiveTabProps: HTMLAttributes = {
    ...archiveTabProps,
    'aria-pressed': true
};
