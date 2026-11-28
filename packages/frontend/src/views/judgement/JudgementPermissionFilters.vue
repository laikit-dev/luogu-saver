<script setup lang="ts">
import { NButton, NCheckbox, NCheckboxGroup } from 'naive-ui';

export interface PermissionOption {
    value: number;
    label: string;
}

defineProps<{
    permissionList: PermissionOption[];
    revPerm: number[];
    addPerm: number[];
    noPerm: boolean;
    permissionFilterCount: number;
}>();

const emit = defineEmits<{
    'update:revPerm': [value: number[]];
    'update:addPerm': [value: number[]];
    'update:noPerm': [value: boolean];
    clear: [];
    apply: [];
}>();
</script>

<template>
    <div class="permission-panel-body">
        <div class="permission-popover-grid">
            <n-checkbox-group
                :value="revPerm"
                class="permission-filter-column"
                @update:value="value => emit('update:revPerm', value as number[])"
            >
                <strong class="permission-removed">移除</strong>
                <n-checkbox
                    v-for="permission in permissionList"
                    :key="`rev-${permission.value}`"
                    :value="permission.value"
                    :label="permission.label"
                />
            </n-checkbox-group>
            <n-checkbox-group
                :value="addPerm"
                class="permission-filter-column"
                @update:value="value => emit('update:addPerm', value as number[])"
            >
                <strong class="permission-added">添加</strong>
                <n-checkbox
                    v-for="permission in permissionList"
                    :key="`add-${permission.value}`"
                    :value="permission.value"
                    :label="permission.label"
                />
            </n-checkbox-group>
            <div class="permission-filter-column permission-special-row">
                <strong>特殊</strong>
                <n-checkbox
                    :checked="noPerm"
                    label="无权限变更（学术不端棕名）"
                    @update:checked="value => emit('update:noPerm', value)"
                />
            </div>
        </div>
        <div class="popover-footer">
            <n-button
                text
                size="small"
                :disabled="permissionFilterCount === 0"
                @click="emit('clear')"
            >
                清空
            </n-button>
            <n-button type="primary" size="small" @click="emit('apply')">应用筛选</n-button>
        </div>
    </div>
</template>

<style scoped>
.permission-popover-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px var(--ui-space-6);
}
.popover-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--ui-space-3);
    margin-top: var(--ui-space-3);
    padding-top: var(--ui-space-3);
    border-top: 1px solid var(--ui-border-color);
}
:deep(.permission-popover-grid .permission-filter-column) {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-content: start;
    gap: 5px var(--ui-space-3);
}
:deep(.permission-filter-column > strong) {
    grid-column: 1 / -1;
}
:deep(.permission-popover-grid > .permission-special-row) {
    grid-column: 1 / -1;
    grid-template-columns: max-content 1fr;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid var(--ui-border-color);
}
:deep(.permission-popover-grid > .permission-special-row > strong) {
    grid-column: auto;
}
.permission-added {
    color: var(--ui-success-color);
}
.permission-removed {
    color: var(--ui-error-color);
}
@media (max-width: 768px) {
    .permission-popover-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    :deep(.permission-popover-grid .permission-filter-column) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :deep(.permission-popover-grid > .permission-special-row) {
        grid-column: auto;
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
