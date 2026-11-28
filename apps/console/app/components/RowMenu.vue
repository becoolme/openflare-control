<script setup lang="ts">
/**
 * Row action menu: opens from the row's "more" button AND from right-click
 * anywhere on the row (`@contextmenu` on the trigger slot's parent wires
 * here through the `anchor` event). Exactly one menu open at a time per
 * page is enforced by the parent through v-model:open.
 */
export interface RowMenuAction {
  key: string
  label: string
  icon?: string
  danger?: boolean
}
defineProps<{ actions: RowMenuAction[]; x: number; y: number }>()
const emit = defineEmits<{ pick: [key: string]; close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="rm-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')" />
    <div class="rmenu menu" :style="{ left: `${x}px`, top: `${y}px` }" role="menu">
      <a
        v-for="a in actions"
        :key="a.key"
        href="#"
        role="menuitem"
        :class="{ danger: a.danger }"
        @click.prevent="emit('pick', a.key)"
      >
        <UiIcon v-if="a.icon" :name="a.icon as never" :size="14" />{{ a.label }}
      </a>
    </div>
  </Teleport>
</template>

<style scoped>
.rm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 250;
}
.rmenu {
  position: fixed;
  z-index: 260;
  min-width: 180px;
}
.rmenu a.danger {
  color: var(--err, #f85149);
}
</style>
