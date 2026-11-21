<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

withDefaults(defineProps<{ to?: RouteLocationRaw; active?: boolean }>(), { to: undefined })
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="{ on: active }"><slot /></NuxtLink
  ><a v-else href="#" :class="{ on: active }"><slot /></a>
</template>
