<script setup lang="ts">
import { computed } from 'vue'

export type BindingKind = 'kv' | 'd1' | 'r2' | 'q' | 'do' | 'hd' | 'wf' | 'sv' | 'as'

const DEFAULT_LABELS: Record<BindingKind, string> = {
  kv: 'KV',
  d1: 'D1',
  r2: 'R2',
  q: 'Q',
  do: 'DO',
  hd: 'HD',
  wf: 'WF',
  sv: 'SVC',
  as: 'ASSETS',
}
const props = withDefaults(defineProps<{ kind?: BindingKind; label?: string }>(), {
  kind: undefined,
  label: undefined,
})
const text = computed(() => props.label ?? (props.kind ? DEFAULT_LABELS[props.kind] : ''))
</script>

<template>
  <span class="bnd" :class="kind"
    ><b>{{ text }}</b
    ><slot
  /></span>
</template>
