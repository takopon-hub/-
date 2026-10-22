'use strict';
const assert = require('assert');
const T = require('../src/logic.js');
const AI = require('../src/ai.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

// "R0,R3,B6,B7,R9" -> 手札
const H = (s) => s.split(',').map((x) => ({ c: x[0], n: Number(x[1]) }));
const card = (id) => T.cardById(id);

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('タイルは20枚(0-9が各2枚、5だけ緑)', () => {
  const tiles = T.makeTiles();
  assert.strictEqual(tiles.length, 20);
  for (let n = 0; n <= 9; n++) assert.strictEqual(tiles.filter((t) => t.n === n).length, 2);
  assert.deepStrictEqual(tiles.filter((t) => t.c === 'G').map((t) => t.n), [5, 5]);
});

test('起こりうる手札は12444通りで、全て妥当な並び', () => {
  const all = T.allHands();
  assert.strictEqual(all.length, 12444);
  assert(all.every(T.isValidHand));
});

test('同じ数字は赤が左に並ぶ', () => {
  const h = T.sortHand(H('B8,R8,R2,B3,R9'));
  assert.strictEqual(T.handKey(h), 'R2,B3,R8,B8,R9');
  assert(T.isValidHand(h));
  assert(!T.isValidHand(H('R2,B3,B8,R8,R9')));
});

test('相手の候補は自分の手札のタイルを含まない(緑5は1枚ずつ)', () => {
  const own = T.sortHand(H('R0,R1,B2,G5,R9'));
  const c = T.candidatesFor(own);
  assert(c.every((h) => !h.some((t) => t.c === 'R' && t.n === 0)));
  assert(c.some((h) => h.some((t) => t.c === 'G')));
  const own2 = T.sortHand(H('R0,R1,G5,G5,R9'));
  assert(T.candidatesFor(own2).every((h) => !h.some((t) => t.c === 'G')));
});

test('説明書の例: 連続で隣り合っている色', () => {
  const a = card('adjacent-colors').answer(H('R0,R3,B6,B7,R9')).text;
  assert.strictEqual(a, '左から1番目から2番目と左から3番目から4番目');
  assert.strictEqual(card('adjacent-colors').answer(H('R0,B3,R6,B7,R9')).text, 'なし');
});

test('説明書の例: 連番になっているタイル', () => {
  assert.strictEqual(
    card('consecutive').answer(H('R1,R2,B4,R8,B9')).text,
    '左から1番目から2番目と左から4番目から5番目'
  );
  // 青7 赤8 青8 赤9 は「青7赤8」と「青8赤9」に分かれる
  assert.strictEqual(
    card('consecutive').answer(H('R0,B7,R8,B8,R9')).text,
    '左から2番目から3番目と左から4番目から5番目'
  );
  // 4・5・6と3枚並ぶ場合は全て示す
  assert.strictEqual(card('consecutive').answer(H('R0,B4,G5,R6,B9')).text, '左から2番目から4番目');
});

test('説明書の例: 5はどこ / 1または2はどこ', () => {
  assert.strictEqual(card('five').answer(H('R0,R1,B2,G5,R9')).text, '左から4番目');
  assert.strictEqual(card('five').answer(H('R0,R1,G5,G5,R9')).text, '左から3番目と左から4番目');
  assert.strictEqual(card('five').answer(H('R0,R1,B2,R3,R9')).text, 'なし');
  assert.strictEqual(card('one-two').answer(H('R1,B1,B2,R3,R9'), 1).text, '左から1番目と左から2番目');
  assert.strictEqual(card('one-two').answer(H('R1,B1,B2,R3,R9'), 2).text, '左から3番目');
});

test('補った質問カードの答え', () => {
  const h = H('R0,B3,G5,R6,B9');
  assert.strictEqual(card('sum-all').answer(h).text, '23');
  assert.strictEqual(card('sum-low3').answer(h).text, '8');
  assert.strictEqual(card('sum-high3').answer(h).text, '20');
  assert.strictEqual(card('sum-mid3').answer(h).text, '14');
  assert.strictEqual(card('red-count').answer(h).text, '2');
  assert.strictEqual(card('blue-count').answer(h).text, '2');
  assert.strictEqual(card('odd-count').answer(h).text, '3');
  assert.strictEqual(card('even-count').answer(h).text, '2');
  assert.strictEqual(card('mid-high').answer(h).text, '5以上');
  assert.strictEqual(card('range').answer(h).text, '9');
  assert.strictEqual(card('low-count').answer(h).text, '2');
  assert.strictEqual(card('red-where').answer(h).text, '左から1番目と左から4番目');
  assert.strictEqual(card('blue-where').answer(h).text, '左から2番目と左から5番目');
  assert.strictEqual(card('red-where').answer(H('B1,B2,G5,B6,B9')).text, 'なし');
  assert.strictEqual(card('same-number').answer(H('R2,B2,R3,B7,R7')).text, '左から1番目から2番目と左から4番目から5番目');
});

test('質問カードは21枚で、全ての手札を判別できる', () => {
  assert.strictEqual(T.CARDS.length, 21);
  assert.strictEqual(new Set(T.CARDS.map((c) => c.id)).size, 21);
  const seen = new Map();
  for (const h of T.allHands()) {
    const sig = [];
    for (const c of T.CARDS) for (const o of T.cardOptions(c)) sig.push(c.answer(h, o).key);
    const k = sig.join('|');
    assert(!seen.has(k), `判別できない手札: ${h.key} と ${seen.get(k)}`);
    seen.set(k, h.key);
  }
});

test('新しいゲームの初期状態', () => {
  const g = T.newGame({ first: 1, rng: mulberry32(1) });
  assert.strictEqual(g.shown.length, 6);
  assert.strictEqual(g.deck.length, 15);
  assert.strictEqual(g.turn, 1);
  assert(g.hands.every(T.isValidHand));
  const ks = [...g.hands[0], ...g.hands[1]].map(T.tileKey);
  assert.strictEqual(ks.filter((k) => k !== 'G5').length, new Set(ks.filter((k) => k !== 'G5')).size);
});

test('質問すると手番が移り、カードが補充される', () => {
  const g = T.newGame({ first: 0, rng: mulberry32(2) });
  const id = g.shown[0];
  const e = T.ask(g, 0, id, T.cardOptions(T.cardById(id))[0]);
  assert.strictEqual(e.by, 0);
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.shown.length, 6);
  assert(!g.shown.includes(id));
  assert.strictEqual(g.deck.length, 14);
  assert.throws(() => T.ask(g, 0, g.shown[0], null));
});

test('宣言: 後攻が正解なら即勝ち', () => {
  const g = T.newGame({ first: 0, rng: mulberry32(3) });
  T.ask(g, 0, g.shown[0], T.cardOptions(T.cardById(g.shown[0]))[0]);
  const r = T.declare(g, 1, g.hands[0]);
  assert(r.correct && r.over);
  assert.strictEqual(g.winner, 1);
});

test('宣言: 外れても続行でき、手番が移る', () => {
  const g = T.newGame({ first: 0, rng: mulberry32(4) });
  const wrong = T.candidatesFor(g.hands[1]).find((h) => h.key !== T.handKey(g.hands[1]));
  const r = T.declare(g, 0, wrong);
  assert(!r.correct && !r.over);
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.phase, 'play');
});

test('宣言: 先攻が正解すると、後攻に1回だけチャンス(同時正解は引き分け)', () => {
  let g = T.newGame({ first: 0, rng: mulberry32(5) });
  let r = T.declare(g, 0, g.hands[1]);
  assert(r.correct && !r.over);
  assert.strictEqual(g.phase, 'lastChance');
  assert.strictEqual(T.actor(g), 1);
  T.declare(g, 1, g.hands[0]);
  assert.strictEqual(g.winner, 'draw');

  g = T.newGame({ first: 0, rng: mulberry32(5) });
  T.declare(g, 0, g.hands[1]);
  const wrong = T.candidatesFor(g.hands[0]).find((h) => h.key !== T.handKey(g.hands[0]));
  T.declare(g, 1, wrong);
  assert.strictEqual(g.winner, 0);
  assert(g.over);
});

test('カードを使い切ると最終宣言になり、結果は両者の宣言後に判定される', () => {
  const g = T.newGame({ first: 0, rng: mulberry32(6) });
  while (g.phase === 'play') {
    const id = g.shown[0];
    T.ask(g, g.turn, id, T.cardOptions(T.cardById(id))[0]);
  }
  assert.strictEqual(g.log.filter((e) => e.type === 'ask').length, 21);
  assert.strictEqual(g.phase, 'final');
  const first = T.actor(g);
  const r = T.declare(g, first, g.hands[1 - first]);
  assert(r.hidden && !r.over);
  T.declare(g, 1 - first, T.candidatesFor(g.hands[1 - first]).find((h) => h.key !== T.handKey(g.hands[first])));
  assert(g.over);
  assert.strictEqual(g.winner, first);
});

test('AIの候補絞り込みは、常に本当の手札を含む', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 20; i++) {
    const g = T.newGame({ first: 0, rng });
    for (let k = 0; k < 5; k++) {
      const a = AI.chooseAction(g, g.turn, 'easy', rng);
      if (a.type === 'ask') T.ask(g, g.turn, a.cardId, a.choice);
      else T.declare(g, g.turn, a.guess);
      if (g.over) break;
      for (const p of [0, 1]) assert(AI.candidates(g, p).some((h) => h.key === T.handKey(g.hands[1 - p])));
    }
  }
});

test('AI同士の対戦が必ず決着し、強いAIは少ない手番で当てる', () => {
  const rng = mulberry32(8);
  const play = (levels) => {
    const g = T.newGame({ first: Math.floor(rng() * 2), rng });
    let guard = 0;
    while (!g.over) {
      assert(guard++ < 80, 'ゲームが終わらない');
      const p = T.actor(g);
      const a = AI.chooseAction(g, p, levels[p], rng);
      if (a.type === 'ask') T.ask(g, p, a.cardId, a.choice);
      else T.declare(g, p, a.guess);
    }
    return g;
  };
  let strongWins = 0;
  let easyWins = 0;
  let turns = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const strongIsP0 = i % 2 === 0;
    const g = play(strongIsP0 ? ['strong', 'easy'] : ['easy', 'strong']);
    turns += g.turns;
    if (g.winner === (strongIsP0 ? 0 : 1)) strongWins++;
    else if (g.winner !== 'draw') easyWins++;
  }
  console.log(`   つよい ${strongWins} 勝 / やさしい ${easyWins} 勝 / 平均 ${(turns / N).toFixed(1)} 手`);
  assert(strongWins > easyWins);
});

console.log(`\n${passed} tests passed`);
