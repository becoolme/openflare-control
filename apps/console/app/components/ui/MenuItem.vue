<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ContentIconName } from '../../utils/icons'
import UiIcon from './Icon.vue'

withDefaults(
  defineProps<{
    to?: RouteLocationRaw
    icon?: ContentIconName
    hint?: string
    highlighted?: boolean
  }>(),
  { to: undefined, icon: undefined, hint: undefined }
)
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="{ hl: highlighted }"
    ><UiIcon v-if="icon" :name="icon" :size="14" /><slot /><span v-if="hint" class="r">{{
      hint
    }}</span></NuxtLink
  ><a v-else href="#" :class="{ hl: highlighted }"
    ><UiIcon v-if="icon" :name="icon" :size="14" /><slot /><span v-if="hint" class="r">{{
      hint
    }}</span></a
  >
</template>
