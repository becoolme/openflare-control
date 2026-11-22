<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { WORKER_NAMES, WORKER_TABS } from '~/fixtures/workers'

definePageMeta({
  validate: (route) => WORKER_NAMES.includes(String((route.params as { name?: string }).name)),
})

const route = useRoute()
const name = computed(() => String((route.params as { name?: string }).name))
const tabs = computed(() =>
  WORKER_TABS.map((tab) => ({
    ...tab,
    to: tab.path === undefined ? undefined : `/workers/${name.value}${tab.path}`,
  }))
)
const activeTab = computed(() => route.name)
const slug = computed(() => WORKER_TABS.find((tab) => tab.name === route.name)?.slug)
</script>

<template><div class="wrap" :class="slug ? `pg-${slug}` : undefined" style="display: flex; flex-direction: column; gap: 18px">
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
      <div style="display: flex; gap: 14px; align-items: center; min-width: 0">
        <span class="pico" style="width: 44px; height: 44px; border-radius: 11px; color: var(--accent)"><UiIcon name="zap" :size="20" /></span>
        <div style="min-width: 0">
          <div style="display: flex; align-items: center; gap: 10px"><h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.03em">checkumi-edge</h1><UiBadge tone="ok" dot>LIVE</UiBadge><span class="kind">project · checkumi</span></div>
          <div style="font-family: 'Geist Mono', monospace; font-size: 12.5px; color: var(--t3); margin-top: 6px; display: flex; gap: 8px; align-items: center; white-space: nowrap"><span style="color: var(--t2)">w-checkumi-edge.example.dev</span><UiIconButton icon="copy" :size="12" label="Copy URL" style="width: 22px; height: 22px" /><span class="dim">·</span>v42 90% / v43 10%<span class="dim">·</span>deployed 2m ago by alex</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex: none">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt tail</UiButton>
        <UiButton variant="secondary"><UiIcon name="ext" :size="13" />Visit</UiButton>
        <UiButton variant="primary"><UiIcon name="upload" :size="13" />Deploy</UiButton>
        <UiIconButton icon="more" :size="15" label="More" style="width: 34px; height: 34px; border-color: var(--b2)" />
      </div>
    </div>
    <UiTabs><UiTab v-for="tab in tabs" :key="tab.label" :to="tab.to" :active="tab.name === activeTab" :aria-current="tab.name === activeTab ? 'page' : undefined">{{ tab.label }}</UiTab></UiTabs>

<NuxtPage /></div></template>
