// 開発・動作確認用: Supabase(PostgREST)の /rest/v1/rpc/<関数名> と同じ形で、ローカルPostgreSQLの
// public スキーマの関数を呼び出す。本番では使わない。
//   DATABASE_URL=postgres://... PORT=54321 node dev/api-shim.mjs
import http from 'node:http';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const port = Number(process.env.PORT ?? 54321);

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url ?? '');
  if (req.method !== 'POST' || !m) return send(res, 404, { message: 'not found' });
  let raw = '';
  for await (const c of req) raw += c;
  let args;
  try { args = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { message: 'bad json' }); }
  const keys = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k));
  const params = keys.map((k) => (args[k] === null ? null : Array.isArray(args[k]) ? args[k] : typeof args[k] === 'object' ? JSON.stringify(args[k]) : String(args[k])));
  const sql = `select public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    const r = await pool.query(sql, params);
    send(res, 200, r.rows[0].r);
  } catch (e) {
    const status = e.code === 'P0001' ? 400 : e.code === '42883' ? 404 : 500;
    send(res, status, { message: e.message });
  }
}).listen(port, () => console.log(`api-shim listening on :${port}`));
