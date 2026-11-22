<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ContentIconName } from '../../utils/icons'
import UiIcon from './Icon.vue'

withDefaults(
  defineProps<{ icon: ContentIconName; size?: number; label?: string; to?: RouteLocationRaw }>(),
  { size: 14, label: undefined, to: undefined }
)
</script>

<template>
  <NuxtLink v-if="to" :to="to" class="ib" :aria-label="label"
    ><UiIcon :name="icon" :size="size" /></NuxtLink
  ><button v-else type="button" class="ib" :aria-label="label"
    ><UiIcon :name="icon" :size="size"
  /></button>
</template>
