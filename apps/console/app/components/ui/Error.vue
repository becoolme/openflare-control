<script setup lang="ts">
defineProps<{ message: string }>()
</script>

<template>
  <div class="bn err" role="alert">
    <UiIcon name="x" :size="15" />
    <span>{{ message }}</span>
  </div>
</template>
