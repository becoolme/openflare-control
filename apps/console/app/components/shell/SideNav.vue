<script setup lang="ts">
import { resolveComponent } from 'vue'
import { NAV_FOOTER, NAV_GROUPS, type NavItem, type NavKey } from '../../utils/nav'
import UiNavIcon from '../ui/NavIcon.vue'
import ShellCliCard from './CliCard.vue'

const NuxtLink = resolveComponent('NuxtLink')

defineProps<{ active?: NavKey }>()
const groups = NAV_GROUPS
const footer: readonly NavItem[] = NAV_FOOTER
</script>

<template>
  <nav class="side" aria-label="Sections">
    <template v-for="(group, gi) in groups" :key="gi">
      <div v-if="group.heading" class="side-h">{{ group.heading }}</div>
      <component
        :is="item.to ? NuxtLink : 'a'"
        v-for="item in group.items"
        :key="item.key"
        :to="item.to"
        :href="item.to ? undefined : '#'"
        class="nv"
        :class="{ on: item.key === active }"
        :aria-current="item.key === active ? 'page' : undefined"
        :data-k="item.key"
        ><UiNavIcon :name="item.key" /><span>{{ item.label }}</span
        ><span v-if="item.count !== undefined" class="cnt">{{ item.count }}</span></component
      >
    </template>
    <div style="flex: 1; min-height: 16px"></div>
    <ShellCliCard />
    <component
      :is="item.to ? NuxtLink : 'a'"
      v-for="item in footer"
      :key="item.key"
      :to="item.to"
      :href="item.to ? undefined : '#'"
      class="nv"
      :class="{ on: item.key === active }"
      :aria-current="item.key === active ? 'page' : undefined"
      :data-k="item.key"
      ><UiNavIcon :name="item.key" /><span>{{ item.label }}</span></component
    >
  </nav>
</template>
