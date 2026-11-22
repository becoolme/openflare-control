<script setup lang="ts">
defineProps<{ inline?: boolean; static?: boolean }>()
</script>

<template>
  <div class="dlg" :class="{ inl: inline, st: static }" role="dialog"><slot /></div>
</template>
