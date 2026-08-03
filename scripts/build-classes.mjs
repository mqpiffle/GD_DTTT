// Emits classes.json -- the mastery-combination names a save file refers to by tag.
//
// A `.gdc` stores `classId` as a TAG, not a name: Sparkles reads `tagSkillClassName0607`
// where the game shows "Vindicator". The digits are the two mastery numbers, so the tag
// is derivable but the name is not -- 0607 being Shaman + Inquisitor tells you nothing
// about what that pair is called.
//
// This is a separate file rather than part of ui-index.json because only this script
// needs the game's text archive; build-ui-index.mjs works from devotions.raw.json alone
// and giving it a second data root to find would be the wrong trade for 79 short strings.
//
// Committed, like ui-index.json: these are names, not Crate's record data, and the
// deployed app has no access to a game install.
//
// Usage: node scripts/build-classes.mjs <folder containing text/text_en>

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? path.join(import.meta.dirname, '../..');
const dir = path.join(ROOT, 'text/text_en');

if (!fs.existsSync(dir)) {
  console.error(`no text/text_en under ${ROOT}`);
  console.error('usage: node scripts/build-classes.mjs <folder containing text/text_en>');
  process.exit(1);
}

/**
 * LATER FILES WIN, and the reason is not cosmetic.
 *
 * The expansions ship their own text archives and re-declare tags the base game already
 * has, frequently as an EMPTY value. `tagSkillClassName0607=` appears alongside
 * `tagSkillClassName0607=Vindicator`. Taking the first match, or taking the last
 * unconditionally, both yield blanks for real classes.
 *
 * So: read in sorted order, and only overwrite when the new value is non-empty. That
 * keeps the expansion's genuine additions while ignoring its placeholders.
 */
const PREFIX = 'tagSkillClassName';
const names = {};
let blanks = 0;

for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith('.txt')) continue;
  const text = fs.readFileSync(path.join(dir, file), 'latin1');
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(PREFIX)) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const tag = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!value) { blanks++; continue; }
    names[tag] = value;
  }
}

const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
const outPath = path.join(import.meta.dirname, '../classes.json');
fs.writeFileSync(outPath, `${JSON.stringify(sorted, null, 0)}\n`);

console.log(`classes.json: ${Object.keys(sorted).length} mastery names`);
console.log(`(${blanks} empty declarations ignored -- expansions re-declare tags as blank)`);

// A single-mastery character has one pair of digits repeated or a lone number; a dual
// has both. Reported so a future game update adding a mastery is visible here.
const single = Object.keys(sorted).filter(t => t.slice(PREFIX.length).length <= 2).length;
console.log(`${single} single-mastery, ${Object.keys(sorted).length - single} combinations`);
