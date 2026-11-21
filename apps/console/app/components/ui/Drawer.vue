<script setup lang="ts">
defineProps<{ inline?: boolean }>()
</script>

<template>
  <aside class="drw" :class="{ inl: inline }"><slot /></aside>
</template>
