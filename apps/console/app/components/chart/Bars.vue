<script setup lang="ts">
import { computed } from 'vue'
import { barRects } from '../../utils/charts'

const props = defineProps<{
  seed: string
  count: number
  width: number
  height: number
  color: string
}>()
const rects = computed(() => barRects(props.seed, props.count, props.width, props.height))
</script>

<template>
  <svg
    width="100%"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    aria-hidden="true"
    :style="`display:block;fill:${color}`"
  >
    <rect
      v-for="(r, i) in rects"
      :key="i"
      :x="r.x"
      :y="r.y"
      :width="r.width"
      :height="r.height"
      rx="1.5"
    />
  </svg>
</template>
