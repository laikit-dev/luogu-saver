<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, Trash2, ShieldUser } from 'lucide-vue-next';

import Card from '@/components/Card.vue';
import CardTitle from '@/components/CardTitle.vue';
import { LEGAL_DOCUMENTS, type LegalKey } from '@/views/legal/legal-content.ts';

const props = defineProps<{
    docKey: LegalKey;
}>();

const doc = computed(() => LEGAL_DOCUMENTS[props.docKey]);

const ICON_MAP = {
    privacy: ShieldUser,
    disclaimer: CircleAlert,
    deletion: Trash2
} as const;

const iconComponent = computed(() => ICON_MAP[doc.value.icon]);
</script>

<template>
    <div class="legal-view">
        <CardTitle :title="doc.title" :icon="iconComponent">
            最后更新于：{{ doc.updatedAt }}
        </CardTitle>

        <Card class="legal-card">
            <section v-for="section in doc.sections" :key="section.heading" class="legal-section">
                <h3 class="legal-heading">{{ section.heading }}</h3>
                <template v-for="(seg, idx) in section.segments" :key="idx">
                    <!-- Content is a hard-coded static constant (legal-content.ts),
                         not user input; v-html is safe here. -->
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <p
                        v-if="seg.kind === 'paragraph'"
                        class="legal-paragraph"
                        v-html="seg.html"
                    ></p>
                    <ul v-else class="legal-list">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <li v-for="(item, i) in seg.items" :key="i" v-html="item"></li>
                    </ul>
                </template>
            </section>
        </Card>
    </div>
</template>

<style scoped>
.legal-view {
    max-width: 1220px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--ui-section-gap);
}

.legal-section {
    margin-bottom: var(--ui-section-gap);
}
.legal-section:last-child {
    margin-bottom: 0;
}
.legal-heading {
    margin: 0 0 var(--ui-space-3);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
}
.legal-paragraph {
    margin: 0;
    line-height: 1.8;
    font-size: 14px;
    color: var(--ui-text-color);
}
.legal-list {
    margin: 0;
    padding-left: var(--ui-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--ui-inline-gap);
}
.legal-list li {
    line-height: 1.8;
    font-size: 14px;
    color: var(--ui-text-color);
}
.legal-paragraph + .legal-list {
    margin-top: var(--ui-space-3);
}
</style>
