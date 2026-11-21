<script setup lang="ts">
defineProps<{ pressed?: boolean }>()
</script>

<template>
  <button type="button" :aria-pressed="pressed ? 'true' : 'false'"><slot /></button>
</template>
