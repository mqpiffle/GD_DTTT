const C = (id, name, starCount, required, granted, crossroads = false) =>
  [id, { id, name, starCount, required, granted, crossroads }];

// Synthetic tree for testing the scheduler. Three affinities keeps it readable.
export const fixture = {
  maxPoints: 55,
  constellations: Object.fromEntries([
    C('xr_chaos', 'Crossroads (chaos)', 1, {}, { chaos: 1 }, true),
    C('xr_order', 'Crossroads (order)', 1, {}, { order: 1 }, true),
    C('xr_asc', 'Crossroads (ascendant)', 1, {}, { ascendant: 1 }, true),
    C('solael', 'Solael', 4, { chaos: 1 }, { chaos: 5 }),
    C('falcon', 'Falcon', 4, { order: 1 }, { order: 4 }),
    C('eel', 'Eel', 3, { ascendant: 1 }, { ascendant: 3 }),
    C('abomination', 'Abomination', 5, { chaos: 6 }, { chaos: 4 }),
    C('widow', 'Widow', 6, { order: 5, ascendant: 3 }, { order: 2 }),
    C('ulzuin', "Ulzuin's torch", 5, { chaos: 10 }, {}),
  ]),
};
