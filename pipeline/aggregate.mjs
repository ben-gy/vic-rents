// Post-build validation. collect.mjs already writes the frontend JSON and runs
// the reconciliation gates on the source; this step re-loads the committed output
// and asserts it is structurally sound (no NaN, aligned arrays, non-empty), so a
// broken write can never ship. Runs after collect.mjs in the data-pipeline
// workflow. Depends only on Node built-ins.
//
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'data');
const read = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));

const meta = read('meta.json');
const places = read('places.json');

const errs = [];
const N = meta.quarters.length;
if (N < 80) errs.push(`too few quarters: ${N}`);
if (!meta.victoria?.all?.median?.length) errs.push('missing Victoria all-properties series');
if ((places.suburbs?.length || 0) < 100) errs.push(`too few suburbs: ${places.suburbs?.length}`);
if ((places.lgas?.length || 0) < 70) errs.push(`too few LGAs: ${places.lgas?.length}`);

const checkSeries = (label, s) => {
  if (!s) return;
  for (const k of ['median', 'count']) {
    const a = s[k];
    if (!Array.isArray(a)) { errs.push(`${label}.${k} not an array`); continue; }
    if (a.length !== N) errs.push(`${label}.${k} length ${a.length} ≠ ${N}`);
    for (const v of a) if (v != null && !Number.isFinite(v)) { errs.push(`${label}.${k} has non-finite value`); break; }
  }
};
for (const t of meta.propTypes) checkSeries(`victoria.${t.key}`, meta.victoria[t.key]);
for (const p of [...places.suburbs, ...places.lgas]) {
  for (const t of Object.keys(p.types)) checkSeries(`${p.slug}.${t}`, p.types[t]);
}

const h = meta.headline;
if (!(h.medianNow > 0) || !(h.medianStart > 0)) errs.push('headline medians invalid');

if (errs.length) {
  console.error('[aggregate] VALIDATION FAILED:\n  - ' + errs.join('\n  - '));
  process.exit(1);
}
console.log(`[aggregate] OK — ${N} quarters, ${places.suburbs.length} suburbs, ${places.lgas.length} LGAs; Victoria median $${h.medianStart}→$${h.medianNow}/wk (+${h.pctChange}%)`);
