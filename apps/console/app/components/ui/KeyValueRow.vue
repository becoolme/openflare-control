<script setup lang="ts">
defineProps<{
  label: string
  keyClass?: string
  keyStyle?: string
  valueClass?: string
  valueStyle?: string
}>()
</script>

<template>
  <div class="kvr"
    ><span class="k" :class="keyClass" :style="keyStyle">{{ label }}</span
    ><span class="v" :class="valueClass" :style="valueStyle"><slot /></span
  ></div>
</template>
