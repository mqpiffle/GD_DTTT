// What every save in the folder reads as, side by side.
//
// A measurement harness, not part of the app. It exists because this project has settled
// three rules on one character and had to retract all three -- the strength metric twice,
// the difficulty penalty table once, and the movement-speed claim that survived in code
// comments for days because n=1 never contradicted it.
//
// Reads every *.gdc next to the repository and prints, per character: the attribute
// allocation, the gear tally, the skill tally, the combined ranking, and the tags the
// proposal would place. Nothing is asserted -- the point is to look at four characters at
// once before deciding anything.
//
// Usage: node scripts/probe-saves.mjs [folder]

import fs from 'node:fs';
import path from 'node:path';
import { readCharacter, readEquipment, equippedRecords } from '../src/lib/gdc.mjs';
import { tallyGear, tallySkills, mergeTallies, strengths, chipMapper, attributeFocus,
  resistancesFrom, SELF_TARGET, SKILL_TARGET } from '../src/lib/strengths.mjs';
import { proposeTags } from '../src/lib/propose.mjs';

const dir = import.meta.dirname;
const SAVES = process.argv[2] ?? path.join(dir, '../..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, '..', f), 'utf8'));

const items = load('items-index.json');
const keywords = load('keywords.json');
const chipOf = chipMapper(keywords);
const skillIdx = fs.existsSync(path.join(dir, '../skills-index.json'))
  ? load('skills-index.json') : null;
const chips = new Map(load('ui-index.json').chips.map(c => [c.id, c.label]));
const label = id => chips.get(id) ?? id;

const files = fs.readdirSync(SAVES).filter(f => f.toLowerCase().endsWith('.gdc')).sort();
if (!files.length) {
  console.error(`no .gdc files in ${SAVES}`);
  console.error('drop your saves there with distinct names -- sparkles.gdc, farker.gdc');
  process.exit(1);
}

for (const file of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(SAVES, file)));
  let ch;
  try { ch = readCharacter(bytes); } catch (e) {
    console.log(`\n=== ${file}\n  unreadable: ${e.message}`);
    continue;
  }

  const gear = tallyGear(equippedRecords(readEquipment(bytes)), items);
  // Strengths see skill-scoped bonuses too; resistances do not. See tallySkills.
  const skl = skillIdx
    ? tallySkills(ch.skills, skillIdx, { targets: [SELF_TARGET, SKILL_TARGET] }) : null;
  const selfOnly = skillIdx ? tallySkills(ch.skills, skillIdx) : null;
  const both = skl ? mergeTallies(gear, skl) : gear;
  const attr = attributeFocus(ch.bio);

  console.log(`\n=== ${ch.name}  (${file})`);
  console.log(`  level ${ch.level}   ${ch.difficulty?.tier ?? '?'}   `
    + `${ch.bio.totalDevotion} devotion earned, ${ch.bio.devotionPoints} unspent`);
  console.log(`  attributes: ${attr
    ? `${attr.label} ${attr.points} pts (${Math.round(attr.share * 100)}%)`
    : 'spread -- no commitment'}`);
  if (skl) console.log(`  skills: ${ch.skills.filter(s => s.level > 0).length} invested, `
    + `${skl.missing.length} not in the index`);

  const line = (name, t) => {
    const s = strengths(t.totals, chipOf, { sources: t.sources });
    console.log(`  ${name.padEnd(9)}${s.length ? s.map(x =>
      `${label(x.chip)} ${Math.round(x.value)}${x.items ? `/${x.items}` : ''}`).join('  ·  ')
      : '(none)'}`);
  };
  line('gear', gear);
  if (skl) line('skills', skl);
  line('combined', both);

  const res = resistancesFrom(
    selfOnly ? mergeTallies(gear, selfOnly).totals : gear.totals);
  console.log(`  resists   ${Object.entries(res)
    .map(([k, v]) => `${k} ${v}`).join('  ')}`);

  const p = proposeTags({
    strengths: strengths(both.totals, chipOf, { sources: both.sources }),
    attribute: attr,
    resists: res,
    level: ch.level,
    difficulty: ch.difficulty?.tier ?? 'normal',
  });
  console.log(`  TAGS      ${p.tooEarly ? `(declined: level ${ch.level})`
    : p.tags.map(t => label(t.tag)).join(', ') || '(none)'}`);
  for (const [tag, why] of p.reasons) console.log(`     ${label(tag).padEnd(24)}${why}`);
}
