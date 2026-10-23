// Builds the Telegram Serverless target from the existing TypeScript sources.
//   node scripts/build-platform.mjs [--env beta|prod] [--out serverless-spike/tgcloud] [--minify]
// The Cloudflare sources stay untouched: ./telegram is swapped for src/platform/telegram.ts, and the
// five platform handlers in src/platform/handlers/ are bundled (code-split into tgcloud/lib/).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const envName = opt('env', 'beta');
const outdir = path.resolve(opt('out', 'serverless-spike/tgcloud'));
const minify = args.includes('--minify');

// Per-environment constants come straight from wrangler.toml ([vars] = production, [env.beta.vars]).
function readVars(section) {
  const vars = {};
  let current = null;
  for (const raw of fs.readFileSync('wrangler.toml', 'utf8').split('\n')) {
    const line = raw.trim();
    const header = /^\[(.+?)\]$/.exec(line);
    if (header) { current = header[1]; continue; }
    if (current !== section) continue;
    const kv = /^([A-Z_]+)\s*=\s*"(.*)"\s*(#.*)?$/.exec(line);
    if (kv) vars[kv[1]] = kv[2];
  }
  return vars;
}
const section = envName === 'prod' ? 'vars' : 'env.beta.vars';
const platformEnv = readVars(section);
if (!platformEnv.BOT_USERNAME || !platformEnv.BOT_OWNER_ID) throw new Error(`wrangler.toml [${section}] missing BOT_USERNAME/BOT_OWNER_ID`);
delete platformEnv.WEBHOOK_SECRET;

const root = path.resolve('src');
const plugins = [
  {
    name: 'platform-swaps',
    setup(b) {
      // Every `import ... from './telegram'` (any depth) resolves to the platform copy.
      b.onResolve({ filter: /(^|\/)telegram$/ }, (a) => {
        if (a.importer.startsWith(path.join(root, 'platform') + path.sep)) return null;
        if (!a.path.startsWith('.')) return null;
        return { path: path.join(root, 'platform', 'telegram.ts') };
      });
      b.onResolve({ filter: /^platform-env$/ }, () => ({ path: 'platform-env', namespace: 'penv' }));
      b.onLoad({ filter: /.*/, namespace: 'penv' }, () => ({
        contents: `export default ${JSON.stringify(platformEnv)};`,
        loader: 'js',
      }));
    },
  },
];

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const handlers = ['message', 'inline_query', 'chosen_inline_result', 'callback_query', 'pre_checkout_query'];
await build({
  entryPoints: handlers.map((h) => path.join(root, 'platform', 'handlers', `${h}.ts`)),
  outdir,
  outbase: path.join(root, 'platform'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  entryNames: '[dir]/[name]',
  chunkNames: 'lib/[name]-[hash]',
  external: ['sdk', 'sdk/*'],
  minify,
  legalComments: 'none',
  sourcemap: false,
  plugins,
  logLevel: 'warning',
});

fs.copyFileSync(path.resolve('serverless-spike/static/schema.js'), path.join(outdir, 'schema.js'));

// Sanity: every emitted module must parse as an ES module.
const emitted = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else emitted.push(p);
  }
})(outdir);
let bad = 0;
for (const f of emitted) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(f) });
  if (r.status !== 0) { bad++; console.error(`SYNTAX ERROR in ${f}\n${r.stderr}`); }
}
const sizes = emitted.map((f) => `${path.relative(outdir, f).padEnd(48)} ${(fs.statSync(f).size / 1024).toFixed(1)} KB`);
console.log(`built ${envName} -> ${path.relative(process.cwd(), outdir)} (${emitted.length} modules, env ${section})\n${sizes.join('\n')}`);
if (bad) process.exit(1);
