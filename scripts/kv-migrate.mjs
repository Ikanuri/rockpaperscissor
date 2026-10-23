// KV migration rehearsal tooling: Cloudflare KV namespace -> the platform's `kv` table.
//   node scripts/kv-migrate.mjs export --namespace <id> --out kv-export
//   node scripts/kv-migrate.mjs import --dir kv-export
//   node scripts/kv-migrate.mjs verify --dir kv-export
// export is read-only against Cloudflare. Values are never printed: logs carry only counts and bytes.
// Needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (export) and an installed, logged-in tgcloud CLI
// in serverless-spike/ (import, verify).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
const OWNER = process.env.BOT_OWNER_ID || '582589514';
const CLI_CWD = path.resolve('serverless-spike');
const STABLE_MS = 900_000;

const family = (key) => { const i = key.indexOf(':'); return i > 0 ? key.slice(0, i) : key; };
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// ── export ─────────────────────────────────────────────────────────────────────────────
async function exportKv() {
  const ns = opt('namespace');
  const out = path.resolve(opt('out', 'kv-export'));
  const maxBytes = parseInt(opt('chunk-bytes', '80000'), 10);
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!ns || !acct || !token) throw new Error('need --namespace, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN');
  const base = `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${ns}`;
  const cf = (p, init = {}) => fetch(base + p, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });

  const keys = [];
  let cursor = '';
  do {
    const r = await cf(`/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) throw new Error(`list keys failed: HTTP ${r.status}`);
    const j = await r.json();
    for (const k of j.result) keys.push({ name: k.name, exp: k.expiration ? k.expiration * 1000 : null });
    cursor = j.result_info?.cursor || '';
  } while (cursor);
  console.log(`listed ${keys.length} keys`);

  const values = new Map();
  let bulkOk = true;
  for (let i = 0; i < keys.length; i += 100) {
    const names = keys.slice(i, i + 100).map((k) => k.name);
    let got = null;
    if (bulkOk) {
      const r = await cf('/bulk/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: names, type: 'text' }) });
      if (r.ok) got = (await r.json()).result?.values ?? null;
      else { bulkOk = false; console.log(`bulk/get unavailable (HTTP ${r.status}); falling back to per-key reads`); }
    }
    if (got) { for (const n of names) values.set(n, got[n] ?? null); continue; }
    await Promise.all(names.map(async (n) => {
      const r = await cf(`/values/${encodeURIComponent(n)}`);
      values.set(n, r.ok ? await r.text() : null);
    }));
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const now = Date.now();
  const families = {};
  const total = { n: 0, bytes: 0 };
  const volatile = [];
  const oversize = [];
  const sizes = [];
  let chunk = [];
  let chunkBytes = 0;
  let chunkNo = 0;
  const flush = () => {
    if (!chunk.length) return;
    fs.writeFileSync(path.join(out, `chunk-${String(++chunkNo).padStart(4, '0')}.json`), JSON.stringify(chunk));
    chunk = []; chunkBytes = 0;
  };
  for (const k of keys) {
    const v = values.get(k.name);
    if (v === null || v === undefined) continue; // deleted/expired between list and get
    const b = bytes(v);
    sizes.push([k.name, b]);
    const isStable = k.exp === null || k.exp > now + STABLE_MS;
    if (isStable) {
      const f = (families[family(k.name)] ??= { n: 0, bytes: 0 });
      f.n++; f.bytes += b; total.n++; total.bytes += b;
    } else volatile.push(k.name);
    const entry = [k.name, v, k.exp];
    const eb = bytes(JSON.stringify(entry));
    if (eb > maxBytes) { oversize.push({ key: k.name, bytes: b }); continue; }
    if (chunkBytes + eb > maxBytes) flush();
    chunk.push(entry); chunkBytes += eb;
  }
  flush();
  sizes.sort((a, b) => b[1] - a[1]);
  const manifest = {
    namespace: ns, exportedAt: new Date(now).toISOString(), chunks: chunkNo,
    stable: { total, families }, volatileKeys: volatile.length, oversize,
    largest: sizes.slice(0, 8).map(([key, b]) => ({ family: family(key), bytes: b })),
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`exported ${total.n} stable keys (${total.bytes} bytes) + ${volatile.length} short-lived, ${chunkNo} chunks, ${oversize.length} oversize`);
  console.log('families:', Object.entries(families).map(([f, v]) => `${f}=${v.n}/${v.bytes}B`).join('  '));
  console.log('largest values:', manifest.largest.map((l) => `${l.family}:${l.bytes}B`).join('  '));
  if (oversize.length) console.log('OVERSIZE (not importable via CLI args):', oversize.map((o) => `${family(o.key)}:${o.bytes}B`).join('  '));
}

// ── tgcloud run helper ───────────────────────────────────────────────────────────────────
function runMsg(text, extra = {}) {
  const payload = JSON.stringify({ quiet: true, from: { id: Number(OWNER) }, chat: { id: Number(OWNER), type: 'private' }, text, ...extra });
  return new Promise((resolve) => {
    const p = spawn('npx', ['--no-install', 'tgcloud', 'run', 'handlers/message', payload, '--ctx', '{ update: { update_id: 1 } }'], { cwd: CLI_CWD });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function parseReturn(out) {
  const line = out.split('\n').reverse().find((l) => l.replace(/\x1b\[[0-9;]*m/g, '').startsWith('< '));
  if (!line) throw new Error('no return line in tgcloud output:\n' + out.slice(-600));
  const text = line.replace(/\x1b\[[0-9;]*m/g, '').slice(2).replace(/\s+\d+ms\s*$/, '');
  const require = createRequire(path.join(CLI_CWD, 'package.json'));
  return require('json5').parse(text);
}

// ── import ─────────────────────────────────────────────────────────────────────────────────
const PROD_NAMESPACE = 'c8e5c7ebf6264fe9b450f6794d234d8e';

async function importKv() {
  const dir = path.resolve(opt('dir', 'kv-export'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.namespace === PROD_NAMESPACE && !rest.includes('--allow-prod')) {
    console.error('REFUSED: this export is the PRODUCTION namespace; pass --allow-prod only for the real cutover.');
    process.exit(3);
  }
  const files = fs.readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f)).sort();
  let done = 0;
  let failed = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const entries = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const r = await runMsg('/sl_import', { entries });
        try {
          const ret = parseReturn(r.out);
          if (ret.imported === entries.length) ok = true;
          else console.log(`${f}: imported ${ret.imported}/${entries.length} (attempt ${attempt})`);
        } catch (e) { console.log(`${f}: attempt ${attempt} failed: ${String(e.message).split('\n')[0]}`); }
      }
      if (ok) done += entries.length; else failed++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`import finished: ${done} entries across ${files.length} chunks, ${failed} failed chunks`);
  if (failed) process.exit(1);
}

// ── verify ─────────────────────────────────────────────────────────────────────────────────
async function verifyKv() {
  const dir = path.resolve(opt('dir', 'kv-export'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const r = await runMsg('/sl_kvstats stable');
  const got = parseReturn(r.out);
  const gotFam = Object.fromEntries(got.families.map((f) => [f.fam, f]));
  const want = manifest.stable.families;
  let bad = 0;
  for (const f of new Set([...Object.keys(want), ...Object.keys(gotFam)])) {
    const w = want[f];
    const g = gotFam[f];
    const same = w && g && w.n === g.n && w.bytes === g.bytes;
    if (!same) bad++;
    console.log(`${same ? 'OK  ' : 'DIFF'} ${f.padEnd(22)} export ${w ? `${w.n} rows/${w.bytes}B` : '-'}   platform ${g ? `${g.n} rows/${g.bytes}B` : '-'}`);
  }
  const tw = manifest.stable.total;
  console.log(`total export ${tw.n} rows/${tw.bytes}B   platform ${got.total.n} rows/${got.total.bytes}B`);
  if (tw.n !== got.total.n || tw.bytes !== got.total.bytes) bad++;

  // Spot check: 25 random stable keys, full-value comparison (first 3000 chars, as /sl_kvget returns).
  const chunks = fs.readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f));
  const pool = [];
  for (const c of chunks) for (const e of JSON.parse(fs.readFileSync(path.join(dir, c), 'utf8'))) if (e[2] === null || e[2] > Date.now() + STABLE_MS) pool.push(e);
  const pick = Array.from({ length: Math.min(25, pool.length) }, () => pool[crypto.randomInt(pool.length)]);
  let spotBad = 0;
  for (const e of pick) {
    const rr = await runMsg(`/sl_kvget ${e[0]}`);
    const v = parseReturn(rr.out);
    if (!v.found || v.value !== e[1].slice(0, 3000)) spotBad++;
  }
  console.log(`spot check: ${pick.length - spotBad}/${pick.length} identical`);
  if (spotBad) bad++;
  console.log(bad ? `VERIFY FAILED (${bad} problems)` : 'VERIFY OK');
  if (bad) process.exit(1);
}

const table = { export: exportKv, import: importKv, verify: verifyKv };
if (!table[cmd]) { console.error('usage: kv-migrate.mjs export|import|verify ...'); process.exit(2); }
await table[cmd]();
