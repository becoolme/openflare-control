<script setup lang="ts">
defineProps<{ checked?: boolean }>()
</script>

<template><span class="sw" :class="{ on: checked }"></span></template>
