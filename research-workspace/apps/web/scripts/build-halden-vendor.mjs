// Bundles Redux Toolkit (pinned in package.json) into one browser file for the Halden page.
// Output: public/vendor/redux-toolkit.min.js, which sets window.RTK. Run: npm run build:halden-vendor
import { build } from 'esbuild';

await build({
  stdin: {
    contents: "import * as RTK from '@reduxjs/toolkit'; import { createApi } from '@reduxjs/toolkit/query'; globalThis.RTK = { ...RTK, createApi };",
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'public/vendor/redux-toolkit.min.js',
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('wrote public/vendor/redux-toolkit.min.js');
