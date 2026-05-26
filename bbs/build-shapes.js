#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   build-shapes.js  —  regenerate the embedded shape library
   ---------------------------------------------------------------------------
   The shape drawer reads shapes from bbs/shapes.json at runtime. When the app
   is opened directly from disk (file://), browsers block fetch() of that JSON,
   so we keep an embedded JS copy (bbs/shape-library.js) that always loads.

   After you edit bbs/shapes.json, run this once to refresh the embedded copy:

       node bbs/build-shapes.js

   (Only needed if you open index.html from disk. If you serve over http,
   shapes.json is fetched directly and overrides the embedded copy.)
--------------------------------------------------------------------------- */
const fs   = require('fs');
const path = require('path');

const dir      = __dirname;
const jsonPath = path.join(dir, 'shapes.json');
const outPath  = path.join(dir, 'shape-library.js');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const shapes = data.shapes || [];

const header =
`/* =====================================================================
   shape-library.js  —  EMBEDDED default bar-shape library (AUTO-GENERATED)
   ---------------------------------------------------------------------
   Generated from bbs/shapes.json by bbs/build-shapes.js — do not hand-edit
   unless you only ever open the app from disk. Edit shapes.json instead and
   re-run:  node bbs/build-shapes.js
   ===================================================================== */
window.SHAPE_LIB_DEFAULT = `;

fs.writeFileSync(outPath, header + JSON.stringify(shapes, null, 2) + ';\n');
console.log(`shape-library.js regenerated — ${shapes.length} shapes embedded.`);
