<script setup lang="ts">
import UiIcon from './Icon.vue'

withDefaults(defineProps<{ checked?: boolean; mark?: boolean }>(), { mark: true })
</script>

<template>
  <span class="cb" :class="{ on: checked }"
    ><UiIcon v-if="checked && mark" name="check" :size="11"
  /></span>
</template>
