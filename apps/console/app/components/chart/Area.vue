<script setup lang="ts">
import { computed } from 'vue'
import { areaPaths } from '../../utils/charts'

const props = defineProps<{ seed: string; width: number; height: number; color: string }>()
const paths = computed(() => areaPaths(props.seed, props.width, props.height))
</script>

<template>
  <svg
    width="100%"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    aria-hidden="true"
    style="display: block"
  >
    <path v-for="g in paths.grid" :key="g" :d="g" stroke="var(--b1)" stroke-dasharray="2 4" />
    <path :d="paths.fill" :style="`fill: ${color}; opacity:.10`" />
    <path
      :d="paths.line"
      fill="none"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      :style="`stroke: ${color}`"
    />
  </svg>
</template>
