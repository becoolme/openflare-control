<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const crumbs = computed(() => route.meta.crumbs?.(route) ?? [])
</script>

<template>
  <div class="app">
    <ShellTopBar :crumbs="crumbs" />
    <div class="shell">
      <ShellSideNav :active="route.meta.nav" />
      <main class="main">
        <slot />
      </main>
    </div>
  </div>
</template>
