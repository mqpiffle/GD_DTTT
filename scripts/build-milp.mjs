// Emit the devotion problem as a CPLEX LP file for an external MILP solver.
//
//   node scripts/build-milp.mjs "Cold Damage" "Pierce Damage" "Casting Speed" > devotion.lp
//   glpsol --lp devotion.lp -o devotion.sol      # glpk
//   highs devotion.lp                            # HiGHS
//   cbc devotion.lp solve solu devotion.sol      # CBC
//
// Options (before the keywords):
//   --cap=55      devotion points available
//   --mode=1      0 passives only, 1 powers at rank 1, 2 powers at max rank
//   --pet         read the following keywords from the pet namespace
import fs from 'node:fs';
import path from 'node:path';
import { buildDb } from '../src/lib/select.mjs';
import { buildModel, toLP } from '../src/lib/milp.mjs';

const dir = import.meta.dirname;
const index = JSON.parse(fs.readFileSync(path.join(dir, '../ui-index.json'), 'utf8'));
const db = buildDb(index);

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const labels = argv.filter(a => !a.startsWith('--'));

if (!labels.length) {
  console.error('usage: node scripts/build-milp.mjs [--cap=55] [--mode=1] [--pet] "Keyword" ...');
  console.error('\navailable keywords:');
  for (const ns of ['character', 'pet']) {
    const list = index.chips.filter(c => c.ns === ns).map(c => c.label);
    console.error(`  ${ns}: ${list.join(', ')}`);
  }
  process.exit(1);
}

const ns = flags.pet ? 'pet' : 'character';
const wanted = labels.map(l => {
  const chip = index.chips.find(c => c.label.toLowerCase() === l.toLowerCase() && c.ns === ns);
  if (!chip) {
    console.error(`unknown ${ns} keyword: "${l}"`);
    process.exit(1);
  }
  return chip.id;
});

const model = buildModel(db, wanted, {
  cap: Number(flags.cap ?? 55),
  mode: Number(flags.mode ?? 1),
});

process.stdout.write(toLP(model) + '\n');

console.error(`\\ ${model.vars.length} variables, ${model.constraints.length} constraints`);
console.error(`\\ keywords: ${labels.join(', ')} (${ns})`);
