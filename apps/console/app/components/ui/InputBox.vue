<script setup lang="ts">
defineProps<{ focused?: boolean; invalid?: boolean }>()
</script>

<template>
  <div class="inp" :class="{ on: focused, bad: invalid }"><slot /></div>
</template>
