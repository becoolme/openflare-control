<script setup lang="ts">
export type BadgeTone = 'ok' | 'warn' | 'err' | 'info' | 'vio' | 'org' | 'neu'

defineProps<{ tone: BadgeTone; dot?: boolean }>()
</script>

<template>
  <span class="badge" :class="`b-${tone}`"><i v-if="dot"></i><slot /></span>
</template>
