#!/usr/bin/env node
/**
 * RV-R199: verify a workerd binary's ELF architecture matches the
 * target VRT_PLATFORM before docker buildx runs (the Dockerfile checks
 * again inside the image; this fails fast, offline, without docker).
 *
 * Usage: node scripts/vrt-check-elf-arch.mjs <binary> <linux/amd64|linux/arm64>
 * Exit 0 = match; 1 = mismatch / not a 64-bit LE ELF / unreadable; 2 = usage.
 */
import { openSync, readSync, closeSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MACHINE = { 'linux/amd64': 0x3e, 'linux/arm64': 0xb7 }

/** Returns { ok: true } or { ok: false, reason } from the first 20 bytes. */
export function checkElfArch(header, platform) {
  const want = MACHINE[platform]
  if (want === undefined) return { ok: false, reason: `unsupported platform ${platform}` }
  if (header.length < 20) return { ok: false, reason: 'file too short for an ELF header' }
  if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    return { ok: false, reason: 'not an ELF file' }
  }
  if (header[4] !== 2) return { ok: false, reason: 'not a 64-bit ELF' }
  if (header[5] !== 1) return { ok: false, reason: 'not little-endian' }
  if (header[6] !== 1) return { ok: false, reason: 'unsupported ELF version' }
  const type = header[16] | (header[17] << 8)
  if (type !== 2 && type !== 3)
    return { ok: false, reason: `e_type ${type} is not an executable/shared object` }
  const got = header[18] | (header[19] << 8)
  if (got !== want) {
    return {
      ok: false,
      reason: `e_machine 0x${got.toString(16)} does not match ${platform} (expected 0x${want.toString(16)})`,
    }
  }
  return { ok: true }
}

export function readHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(20)
    const n = readSync(fd, buf, 0, 20, 0)
    return buf.subarray(0, n)
  } finally {
    closeSync(fd)
  }
}

// realpath on both sides: a symlinked path (macOS /var -> /private/var)
// must not turn the CLI into a silent no-op (= fail-open exit 0).
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [bin, platform, ...rest] = process.argv.slice(2)
  if (!bin || !platform || rest.length) {
    console.error('usage: vrt-check-elf-arch.mjs <binary> <linux/amd64|linux/arm64>')
    process.exit(2)
  }
  let res
  try {
    res = checkElfArch(readHeader(bin), platform)
  } catch (e) {
    res = { ok: false, reason: `cannot read ${bin}: ${e.code ?? 'error'}` }
  }
  if (!res.ok) {
    console.error(`FATAL: workerd binary architecture check failed: ${res.reason}`)
    process.exit(1)
  }
}
