<script setup lang="ts">
const { toasts, dismiss } = useToasts()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" role="status">
      <span style="flex: 1">{{ t.text }}</span>
      <button class="x" aria-label="Dismiss" @click="dismiss(t.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 18px;
  right: 18px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--s2);
  border: 1px solid var(--b1);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}
.toast.ok {
  border-color: var(--ok, #3fb950);
}
.toast.err {
  border-color: var(--err, #f85149);
}
.x {
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0 2px;
}
.x:hover {
  color: var(--t1);
}
</style>
