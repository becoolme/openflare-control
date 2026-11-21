<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  variant?: 'primary' | 'secondary'
  size?: 'sm'
  to?: RouteLocationRaw
  href?: string
}>()
const classes = computed(() => [
  'btn',
  props.variant === 'primary' ? 'btn-p' : props.variant === 'secondary' ? 'btn-s' : null,
  props.size === 'sm' ? 'btn-sm' : null,
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes"><slot /></NuxtLink
  ><a v-else-if="href" :href="href" :class="classes"><slot /></a
  ><button v-else type="button" :class="classes"><slot /></button>
</template>
