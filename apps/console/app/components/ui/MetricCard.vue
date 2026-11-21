<script setup lang="ts">
defineProps<{ label: string; hint?: string; valueClass?: string; valueStyle?: string }>()
</script>

<template>
  <div class="card met"
    ><div class="lbl"
      ><span>{{ label }}</span
      ><span v-if="hint" class="mono dim">{{ hint }}</span></div
    ><div class="val" :class="valueClass" :style="valueStyle"><slot name="value" /></div><slot
  /></div>
</template>
