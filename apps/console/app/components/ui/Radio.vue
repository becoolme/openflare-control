<script setup lang="ts">
defineProps<{ checked?: boolean }>()
</script>

<template><span class="rd" :class="{ on: checked }"></span></template>
