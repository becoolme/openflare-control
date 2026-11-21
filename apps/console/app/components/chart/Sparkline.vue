<script setup lang="ts">
import { computed } from 'vue'
import { sparklinePath } from '../../utils/charts'

const props = defineProps<{ seed: string; width: number; height: number; color: string }>()
const d = computed(() => sparklinePath(props.seed, props.width, props.height))
</script>

<template>
  <svg
    class="spark"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <path :d="d" fill="none" stroke-width="1.4" :style="`stroke: ${color}`" />
  </svg>
</template>
