<script setup lang="ts">
withDefaults(defineProps<{ as?: 'h3' | 'div' }>(), { as: 'h3' })
</script>

<template>
  <component :is="as" class="dlg-t"><slot /></component>
</template>
