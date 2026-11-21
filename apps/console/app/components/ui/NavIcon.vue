<script setup lang="ts">
import { NAV_ICONS, type NavIconName } from '../../utils/icons'

defineProps<{ name: NavIconName }>()
</script>

<template>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="NAV_ICONS[name]"
  ></svg>
</template>
