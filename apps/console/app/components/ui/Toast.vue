<script setup lang="ts">
defineProps<{ inline?: boolean }>()
</script>

<template>
  <div class="toast" :class="{ inl: inline }"><slot /></div>
</template>
