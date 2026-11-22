<template>
  <div
    style="
      border: 1px solid var(--b1);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--s1);
      font-family: 'Geist Mono', monospace;
      font-size: 11.5px;
      line-height: 1.7;
    "
  >
    <div
      class="muted"
      style="
        font-family: Geist, sans-serif;
        font-size: 12px;
        margin-bottom: 4px;
        display: flex;
        justify-content: space-between;
      "
      >vrt CLI<span class="dim" style="font-family: 'Geist Mono', monospace"
        >wrangler.toml ✓</span
      ></div
    >
    <div style="color: var(--t2)"><span class="dim">$</span> vrt login</div>
    <div style="color: var(--t2)"><span class="dim">$</span> vrt deploy</div>
    <div class="dim">runtime workerd · OSS</div>
  </div>
</template>
