#!/usr/bin/env node
// Reports UI strings whose call-site key is missing from a locale, so they would fall back
// to English mid-sentence. check-locales.mjs compares locales with each other and cannot see
// this: it never reads the source, so a key renamed in a call site but not in the catalogues
// passes it silently.
//
//   node scripts/i18n/check-keys.mjs [lang]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = path.join(ROOT, 'frontend/src')
const lang = process.argv[2] || 'zh'

// 收集源码里 t('...') / t("...") 的键（跳过生成目录与测试）
const keys = new Set()
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (/^(locales|instr|exercise-names|exercise-desc)$/.test(e.name)) continue
      walk(p)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8')
      for (const m of text.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.add(m[2])
    }
  }
}
walk(SRC)

const mod = await import(pathToFileURL(path.join(SRC, 'locales', lang + '.js')).href)
const dict = mod.default
// 源码里 t('…device\'s…') 抓到的键保留了反斜杠，而字典的键是解析后的真实字符串
// （device's）。两边都归一化掉转义反斜杠后再比对，否则会误报缺失。
const unescape = s => s.replace(/\\(['"\\])/g, '$1')
const dictKeys = new Set(Object.keys(dict).map(unescape))
const missing = [...keys].filter(k => !dictKeys.has(unescape(k)))
console.log(`源码 t() 键: ${keys.size}`)
console.log(`${lang} 字典条目: ${Object.keys(dict).length}`)
console.log(`缺失(会退回英文): ${missing.length}`)
if (missing.length) {
  console.log('\n缺失清单:')
  for (const m of missing.slice(0, 40)) console.log('  · ' + m.slice(0, 110))
  if (missing.length > 40) console.log(`  … 另有 ${missing.length - 40} 条`)
}
