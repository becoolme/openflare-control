<script setup lang="ts">
import type { ContentIconName } from '../../utils/icons'
import UiIcon from './Icon.vue'

withDefaults(
  defineProps<{
    tone: 'warn' | 'err' | 'info' | 'org'
    icon: ContentIconName
    iconSize?: number
  }>(),
  { iconSize: 15 }
)
</script>

<template>
  <div class="bn" :class="tone"><UiIcon :name="icon" :size="iconSize" /><slot /></div>
</template>
