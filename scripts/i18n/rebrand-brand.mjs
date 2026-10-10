#!/usr/bin/env node
// Renames the product's display name across the UI catalogues and the call sites that use
// them, without touching functional identifiers.
//
//   node scripts/i18n/rebrand-brand.mjs <oldName> <newName> [--apply]
//
// Why not a plain string replace: the English source string IS the lookup key —
// `t(s)` is `dict[s] || s`. Renaming the brand inside a t('…') call site but not in the
// catalogues orphans the translation, which then falls back to English silently.
// check-locales.mjs cannot catch that: it compares locales with each other, never with the
// source. So the catalogues are rewritten first, the exact key renames are recorded, and the
// source is then rewritten by matching whole old keys — never the brand in isolation.
//
// What it deliberately leaves alone:
//   · repository URLs (github.com/DuarteSantos8/openGym still points at upstream)
//   · comment-only lines
//   · identifiers that merely look like the brand ('not-opengym', file names, storage keys,
//     the Android applicationId) — those are a separate, deliberate decision, because
//     renaming them loses access to existing data on disk.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const [oldName, newName] = positional
const apply = process.argv.includes('--apply')
if (!oldName || !newName) {
  console.error('用法: node scripts/i18n/rebrand-brand.mjs <旧名> <新名> [--apply]')
  process.exit(2)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LOCALES = path.join(ROOT, 'frontend/src/locales')
const SRC = path.join(ROOT, 'frontend/src')

const capitalise = s => s[0].toUpperCase() + s.slice(1)
// 首字母大写变体先替换，否则 "OpenGym" 会被 "openGym" 规则漏掉
const rename = s => s
  .replaceAll(capitalise(oldName) + 'Test', capitalise(newName) + 'Test')
  .replaceAll(oldName + 'Test', newName + 'Test')
  .replaceAll(capitalise(oldName), capitalise(newName))
  .replaceAll(oldName, newName)
const touches = s => s.includes(oldName) || s.includes(capitalise(oldName))

// 标识符片段：出现在这些词里时，品牌名不是显示文本，不能改
const IDENTIFIER_CONTEXT = [
  'gym_state_v1', 'opengym-state', 'opengym-remote', 'opengym-backup', 'opengym-stash',
  'opengym-health', 'opengym-media', 'opengym-device', 'not-opengym', 'opengym-workout',
  'opengym-w-', 'opengym-rt-', 'opengym-plan-', 'opengym-kept-', 'opengym-coach',
  'opengym-update', 'opengym-bw-', 'applicationId', 'namespace', 'appId', 'package_name',
  'custom_url_scheme',
]

// ── 1. 目录：键与值一起改，记录「旧键 → 新键」───────────────────────────────
const keyMap = new Map()
let localeFiles = 0, keysRenamed = 0, valuesRenamed = 0

for (const file of fs.readdirSync(LOCALES).filter(f => f.endsWith('.js')).sort()) {
  const p = path.join(LOCALES, file)
  const lines = fs.readFileSync(p, 'utf8').split('\n')
  let touched = false
  const out = lines.map(line => {
    const m = line.match(/^(\s*)(['"])((?:\\.|(?!\2).)*)\2(\s*:\s*)(['"])((?:\\.|(?!\5).)*)\5(,?)(\s*)$/)
    if (!m) return line
    const [, indent, q1, key, sep, q2, value, comma, tail] = m
    if (!touches(key) && !touches(value)) return line
    const nk = touches(key) ? rename(key) : key
    const nv = touches(value) ? rename(value) : value
    if (nk !== key) { keyMap.set(key, nk); keysRenamed++ }
    if (nv !== value) valuesRenamed++
    touched = true
    return `${indent}${q1}${nk}${q1}${sep}${q2}${nv}${q2}${comma}${tail}`
  })
  if (touched) { if (apply) fs.writeFileSync(p, out.join('\n')); localeFiles++ }
}
console.log(`目录: ${localeFiles} 个文件, 重命名键 ${keysRenamed} 处, 值 ${valuesRenamed} 处`)

// ── 2. 源码：整键替换（长键优先）＋ 行内边界替换兜底 ─────────────────────────
const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (/^(node_modules|locales|instr|exercise-names|exercise-desc|dist|build|android|ios)$/.test(e.name)) continue
      walk(p)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p)
  }
}
walk(SRC)

// 品牌名前后必须是非标识符字符，避免命中 not-opengym / opengym-state.json 等
const bounded = new RegExp(`(^|[^A-Za-z0-9._/-])(openGym|OpenGym)(?![A-Za-z0-9._/-])`, 'g')
const URL_OR_ID = /(https?:\/\/\S+)|(['"`][A-Za-z0-9._/-]*[oO]pen[gG]ym[A-Za-z0-9._/-]*['"`])/g

let srcFiles = 0, byKey = 0, byBoundary = 0
for (const p of files) {
  const before = fs.readFileSync(p, 'utf8')
  if (!touches(before)) continue
  let after = before
  // 先按记录下来的完整键替换
  for (const [oldKey, newKey] of [...keyMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
    if (after.includes(oldKey)) { byKey += after.split(oldKey).length - 1; after = after.split(oldKey).join(newKey) }
  }
  // 再按边界替换，逐行处理：跳过纯注释行，屏蔽 URL 与完整标识符
  after = after.split('\n').map(line => {
    const trimmed = line.trim()
    if (/^(\/\/|\/\*|\*)/.test(trimmed)) return line          // 纯注释，保持上游可追溯
    if (IDENTIFIER_CONTEXT.some(k => line.includes(k)) && !/\bt\(/.test(line)) return line
    const saved = []
    const masked = line.replace(URL_OR_ID, m => { saved.push(m); return `\u0000${saved.length - 1}\u0000` })
    const done = masked.replace(bounded, (_, pre, brand) => {
      byBoundary++
      return pre + (brand === 'OpenGym' ? capitalise(newName) : newName)
    })
    return done.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[+i])
  }).join('\n')
  if (after !== before) { if (apply) fs.writeFileSync(p, after); srcFiles++ }
}
console.log(`源码: ${srcFiles} 个文件, 整键替换 ${byKey} 处, 边界替换 ${byBoundary} 处`)
if (!apply) console.log('\n（试运行，未写入。加 --apply 生效）')
