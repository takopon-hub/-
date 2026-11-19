import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Supabase は API(PostgREST)経由の「WHERE のない UPDATE / DELETE」を拒否する(pg-safeupdate)。
// ローカルのPostgreSQLでは通ってしまい本番だけで失敗するので、schema.sql に混ざっていないか文字列で検査する。
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const body = sql.replace(/--[^\n]*/g, '');   // コメントを除く

describe('schema.sql', () => {
  const statements = body.split(';').map((s) => s.trim()).filter(Boolean);

  it('WHERE のない DELETE / UPDATE を含まない(Supabase の API では拒否される)', () => {
    const bad = statements.filter((s) => /\b(delete\s+from\s+app\.|update\s+app\.)/i.test(s) && !/\bwhere\b/i.test(s));
    expect(bad).toEqual([]);
  });

  it('個人情報(氏名・電話番号・メモ)を保存する列を持たない。旧列を消す alter 以外に登場しない', () => {
    expect(body).not.toMatch(/\bphone\b/i);
    const rest = body.replace(/alter table app\.visitor drop column if exists (surname|memo)/gi, '');
    expect(rest).not.toMatch(/\b(surname|memo|p_surname|p_memo|name_kana)\b/i);
    const visitorTable = body.match(/create table if not exists app\.visitor \(([\s\S]*?)\);/i)![1];
    expect(visitorTable).not.toMatch(/\btext\b(?! *\[)[^,]*check \(length/i);
  });

  it('public の関数はすべてパスコードを先頭引数に取る(権限判定の漏れ防止)', () => {
    const funcs = [...body.matchAll(/create or replace function public\.(\w+)\(\s*(\w+)/gi)];
    expect(funcs.length).toBeGreaterThan(10);
    expect(funcs.filter((m) => m[2] !== 'p_pass').map((m) => m[1])).toEqual([]);
  });
});
