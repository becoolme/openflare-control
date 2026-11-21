<script setup lang="ts">
import { onMounted } from 'vue'
import { CONSOLE_FIXTURE } from '../../fixtures/console'
import type { Crumb } from '../../utils/nav'
import ShellLogo from './Logo.vue'

defineProps<{ crumbs: Crumb[] }>()
const { team, user, unreadNotifications } = CONSOLE_FIXTURE
const { cells, cellId, refresh } = useCellSelection()
onMounted(refresh)
</script>

<template>
  <header class="top">
    <slot name="logo"><ShellLogo /></slot>
    <span class="sep" aria-hidden="true">/</span>
    <button type="button" class="crumb"
      ><span class="av" style="background: #e8e8ec">{{ team.initial }}</span
      >{{ team.name }}<span class="chip">{{ team.plan }}</span>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8A8A93"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m7 9 5-5 5 5M7 15l5 5 5-5" /></svg
    ></button>
    <span class="sep" aria-hidden="true">/</span>
    <label class="crumb" title="Cell">
      <span class="st ok" style="font-size: 13.5px"><i></i></span>
      <select
        v-model="cellId"
        aria-label="Cell"
        style="border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer"
      >
        <option v-if="cells.length === 0" :value="null">no cell</option>
        <option v-for="cell in cells" :key="cell.cellId" :value="cell.cellId">
          {{ cell.cellId }}
        </option>
      </select>
    </label>
    <template v-for="(crumb, index) in crumbs" :key="index">
      <span class="sep" aria-hidden="true">/</span>
      <span v-if="index === crumbs.length - 1" class="crumb" style="color: var(--t1)">{{
        crumb.label
      }}</span>
      <NuxtLink v-else-if="crumb.to" :to="crumb.to" class="crumb">{{ crumb.label }}</NuxtLink>
      <span v-else class="crumb">{{ crumb.label }}</span>
    </template>
    <div style="flex: 1; min-width: 12px"></div>
    <button type="button" class="search">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span style="flex: 1">Search or run a command…</span><kbd>⌘K</kbd>
    </button>
    <a href="#" class="btn btn-sm" style="color: var(--t3)">Docs</a>
    <button type="button" class="ibtn" :aria-label="`Notifications, ${unreadNotifications} unread`">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      <span
        v-if="unreadNotifications > 0"
        style="
          position: absolute;
          top: 6px;
          right: 7px;
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--err);
        "
      ></span>
    </button>
    <button type="button" class="ibtn" aria-label="Account" style="border: 0; padding: 0"
      ><span
        class="av"
        style="
          width: 28px;
          height: 28px;
          font-size: 11px;
          background: linear-gradient(135deg, var(--accent), #5eb0ff);
        "
        >{{ user.initials }}</span
      ></button
    >
  </header>
</template>
