<script setup lang="ts">
import { computed } from 'vue'
import { CONTENT_ICONS, type ContentIconName } from '../../utils/icons'

const props = withDefaults(defineProps<{ name: ContentIconName; size?: number | string }>(), {
  size: 14,
})
const paths = computed(() => (props.name === 'spin' ? '' : CONTENT_ICONS[props.name]))
</script>

<template>
  <svg
    v-if="name === 'spin'"
    class="spin"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke-opacity=".25" />
    <path d="M21 12a9 9 0 0 0-9-9" /></svg
  ><svg
    v-else
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="paths"
  ></svg>
</template>
