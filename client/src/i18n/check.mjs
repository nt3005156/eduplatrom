// Translation checks, run before every build (`npm run i18n:check`).
// 1. Every English key exists in Nepali and vice versa, with the same nesting.
// 2. No empty values.
// 3. Interpolation variables ({{name}}) match between the two languages.
// 4. Every literal t('key') used in src/ resolves to a key in English.
// Exits non-zero on any failure so a missing string cannot ship as a raw key.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, 'locales');
const srcDir = join(here, '..');
const LANGS = ['en', 'ne'];

const problems = [];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function loadNamespaces(lang) {
  const dir = join(localesDir, lang);
  const result = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const ns = file.replace(/\.json$/, '');
    result[ns] = flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  }
  return result;
}

const catalogues = Object.fromEntries(LANGS.map(l => [l, loadNamespaces(l)]));
const enNs = Object.keys(catalogues.en).sort();
const neNs = Object.keys(catalogues.ne).sort();
if (enNs.join() !== neNs.join()) {
  problems.push(`Namespace mismatch: en=[${enNs}] ne=[${neNs}]`);
}

for (const ns of enNs) {
  const en = catalogues.en[ns] || {};
  const ne = catalogues.ne[ns] || {};
  for (const key of Object.keys(en)) {
    if (!(key in ne)) problems.push(`[${ns}] "${key}" missing in ne`);
  }
  for (const key of Object.keys(ne)) {
    if (!(key in en)) problems.push(`[${ns}] "${key}" missing in en (extra in ne)`);
  }
  for (const lang of LANGS) {
    const values = catalogues[lang][ns] || {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`[${lang}/${ns}] "${key}" is empty or not a string`);
      }
    }
  }
  for (const key of Object.keys(en)) {
    if (!(key in ne) || typeof en[key] !== 'string' || typeof ne[key] !== 'string') continue;
    const vars = s => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map(m => m[1]).sort().join(',');
    if (vars(en[key]) !== vars(ne[key])) {
      problems.push(`[${ns}] "${key}" interpolation differs: en {${vars(en[key])}} vs ne {${vars(ne[key])}}`);
    }
  }
}

// Literal t('...') calls in source must resolve to an English key.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'locales') walk(p, out); }
    else if (['.jsx', '.js'].includes(extname(p))) out.push(p);
  }
  return out;
}

let checkedCalls = 0;
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('useTranslation') && !text.includes("i18n/index")) continue;
  // Accepts useTranslation('ns') and useTranslation(['ns', ...]); the first namespace is the default.
  const useMatch = text.match(/useTranslation\(\s*\[?\s*['"]([\w-]+)['"]/);
  const defaultNs = useMatch ? useMatch[1] : 'common';
  for (const m of text.matchAll(/\bt\(\s*['"]([\w.:-]+)['"]/g)) {
    const raw = m[1];
    const [ns, key] = raw.includes(':') ? raw.split(':') : [defaultNs, raw];
    checkedCalls++;
    const bucket = catalogues.en[ns] || {};
    // Plural keys are stored as key_one / key_other; a call to the bare key resolves to either.
    const resolved = key in bucket || `${key}_one` in bucket || `${key}_other` in bucket;
    if (!resolved) {
      problems.push(`${relative(srcDir, file)}: t('${raw}') has no English value in namespace "${ns}"`);
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const keyCount = Object.values(catalogues.en).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(`i18n check passed: ${keyCount} keys in ${enNs.length} namespaces for ${LANGS.join(' and ')}; ${checkedCalls} literal t() calls resolved.`);
