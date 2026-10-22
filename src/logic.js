(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tagiron = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLOR_RANK = { R: 0, B: 1, G: 2 };
  const COLOR_NAME = { R: '赤', B: '青', G: '緑' };
  const HAND_SIZE = 5;
  const SHOWN_COUNT = 6;

  // ---- tiles & hands -------------------------------------------------------

  // 0-9 を赤・青で1枚ずつ。ただし5だけは緑が2枚。
  function makeTiles() {
    const tiles = [];
    for (let n = 0; n <= 9; n++) {
      if (n === 5) tiles.push({ n, c: 'G' }, { n, c: 'G' });
      else tiles.push({ n, c: 'R' }, { n, c: 'B' });
    }
    return tiles;
  }

  // 小さい数が左。同じ数なら赤が左。
  function cmpTile(a, b) {
    return a.n - b.n || COLOR_RANK[a.c] - COLOR_RANK[b.c];
  }
  const sortHand = (h) => h.slice().sort(cmpTile);
  const tileKey = (t) => t.c + t.n;
  const handKey = (h) => h.map(tileKey).join(',');

  function isValidHand(h) {
    if (!Array.isArray(h) || h.length !== HAND_SIZE) return false;
    for (let i = 0; i < h.length; i++) {
      const t = h[i];
      if (!t || !(t.c in COLOR_RANK) || !(t.n >= 0 && t.n <= 9)) return false;
      if ((t.n === 5) !== (t.c === 'G')) return false;
      if (i > 0) {
        const d = cmpTile(h[i - 1], t);
        if (d > 0) return false;
        if (d === 0 && t.c !== 'G') return false;
      }
    }
    return true;
  }

  let ALL = null;
  // 起こりうる手札(並び込み)を全て列挙する。12444通り。
  function allHands() {
    if (ALL) return ALL;
    const tiles = makeTiles();
    const seen = new Map();
    const chosen = [];
    const pick = (start) => {
      if (chosen.length === HAND_SIZE) {
        const h = sortHand(chosen.map((i) => tiles[i]));
        const k = handKey(h);
        if (!seen.has(k)) {
          h.key = k;
          seen.set(k, h);
        }
        return;
      }
      for (let i = start; i < tiles.length; i++) {
        chosen.push(i);
        pick(i + 1);
        chosen.pop();
      }
    };
    pick(0);
    ALL = Array.from(seen.values());
    return ALL;
  }

  // 自分の手札を知っているとき、相手の手札としてありうるもの。
  function candidatesFor(ownHand) {
    const left = {};
    for (const t of makeTiles()) left[tileKey(t)] = (left[tileKey(t)] || 0) + 1;
    for (const t of ownHand) left[tileKey(t)]--;
    return allHands().filter((h) => {
      const used = {};
      for (const t of h) {
        const k = tileKey(t);
        used[k] = (used[k] || 0) + 1;
        if (used[k] > left[k]) return false;
      }
      return true;
    });
  }

  // ---- question cards ------------------------------------------------------

  const ans = (key, text) => ({ key: String(key), text });
  const pos = (h, pred) => h.reduce((a, t, i) => (pred(t) ? a.concat(i + 1) : a), []);
  const posText = (l) => (l.length ? l.map((i) => `左から${i}番目`).join('と') : 'なし');
  const sum = (arr) => arr.reduce((s, t) => s + t.n, 0);
  const count = (h, pred) => h.filter(pred).length;

  // linked(a, b) が真で隣り合う並びの塊(2枚以上)を [開始, 終了] (1始まり)で返す。
  function runs(h, linked) {
    const out = [];
    let start = 0;
    for (let i = 1; i <= h.length; i++) {
      if (i === h.length || !linked(h[i - 1], h[i])) {
        if (i - start >= 2) out.push([start + 1, i]);
        start = i;
      }
    }
    return out;
  }
  const runsText = (r) =>
    r.length ? r.map(([a, b]) => `左から${a}番目から${b}番目`).join('と') : 'なし';

  const numWhere = (h, n) => {
    const p = pos(h, (t) => t.n === n);
    return ans(p.join(','), posText(p));
  };
  const runsAnswer = (h, linked) => {
    const r = runs(h, linked);
    return ans(r.map((x) => x.join('-')).join(','), runsText(r));
  };
  const total = (h, t) => ans(t, String(t));

  // kind: 'official' は説明書に載っている質問、'supplement' は説明書に無いため補ったもの。
  const CARDS = [
    { id: 'five', kind: 'official', title: '5はどこ？', answer: (h) => numWhere(h, 5) },
    { id: 'one-two', kind: 'official', title: '1または2はどこ？', choices: [1, 2], answer: numWhere },
    {
      id: 'adjacent-colors',
      kind: 'official',
      title: '連続で隣り合っている色はどこ？',
      answer: (h) => runsAnswer(h, (a, b) => a.c === b.c),
    },
    {
      id: 'consecutive',
      kind: 'official',
      title: '連番になっているタイルはどこ？',
      answer: (h) => runsAnswer(h, (a, b) => b.n === a.n + 1),
    },
    { id: 'three-four', kind: 'supplement', title: '3または4はどこ？', choices: [3, 4], answer: numWhere },
    { id: 'six-seven', kind: 'supplement', title: '6または7はどこ？', choices: [6, 7], answer: numWhere },
    { id: 'eight-nine', kind: 'supplement', title: '8または9はどこ？', choices: [8, 9], answer: numWhere },
    {
      id: 'red-where',
      kind: 'supplement',
      title: '赤のタイルはどこ？',
      answer: (h) => {
        const p = pos(h, (t) => t.c === 'R');
        return ans(p.join(','), posText(p));
      },
    },
    {
      id: 'same-number',
      kind: 'supplement',
      title: '同じ数字のタイルはどこ？',
      answer: (h) => runsAnswer(h, (a, b) => a.n === b.n),
    },
    { id: 'sum-all', kind: 'supplement', title: '5枚の合計数は？', answer: (h) => total(h, sum(h)) },
    {
      id: 'sum-low3',
      kind: 'supplement',
      title: '小さい方から3枚の合計数は？',
      answer: (h) => total(h, sum(h.slice(0, 3))),
    },
    {
      id: 'sum-high3',
      kind: 'supplement',
      title: '大きい方から3枚の合計数は？',
      answer: (h) => total(h, sum(h.slice(2))),
    },
    {
      id: 'sum-mid3',
      kind: 'supplement',
      title: '中央の3枚の合計数は？',
      answer: (h) => total(h, sum(h.slice(1, 4))),
    },
    {
      id: 'red-count',
      kind: 'supplement',
      title: '赤のタイルは何枚？',
      answer: (h) => total(h, count(h, (t) => t.c === 'R')),
    },
    {
      id: 'blue-count',
      kind: 'supplement',
      title: '青のタイルは何枚？',
      answer: (h) => total(h, count(h, (t) => t.c === 'B')),
    },
    {
      id: 'odd-count',
      kind: 'supplement',
      title: '奇数のタイルは何枚？',
      answer: (h) => total(h, count(h, (t) => t.n % 2 === 1)),
    },
    {
      id: 'even-count',
      kind: 'supplement',
      title: '偶数のタイルは何枚？',
      answer: (h) => total(h, count(h, (t) => t.n % 2 === 0)),
    },
    {
      id: 'mid-high',
      kind: 'supplement',
      title: '中央のタイルは5以上？4以下？',
      answer: (h) => (h[2].n >= 5 ? ans('hi', '5以上') : ans('lo', '4以下')),
    },
    {
      id: 'range',
      kind: 'supplement',
      title: '最大の数と最小の数の差は？',
      answer: (h) => total(h, h[h.length - 1].n - h[0].n),
    },
    {
      id: 'low-count',
      kind: 'supplement',
      title: '4以下のタイルは何枚？',
      answer: (h) => total(h, count(h, (t) => t.n <= 4)),
    },
    {
      id: 'blue-where',
      kind: 'supplement',
      title: '青のタイルはどこ？',
      answer: (h) => {
        const p = pos(h, (t) => t.c === 'B');
        return ans(p.join(','), posText(p));
      },
    },
  ];

  const cardById = (id) => CARDS.find((c) => c.id === id);
  const cardOptions = (card) => (card.choices ? card.choices : [null]);

  // ---- game state ----------------------------------------------------------

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // phase: play | lastChance | final | over
  //   lastChance: 先攻が正解した後、後攻に残された1回だけの宣言
  //   final: 質問カードを使い切った後、双方が1回ずつ行う宣言(結果は両者の宣言後に判定)
  function newGame({ first = 0, rng = Math.random } = {}) {
    const tiles = shuffle(makeTiles(), rng);
    const ids = shuffle(CARDS.map((c) => c.id), rng);
    return {
      first,
      turn: first,
      hands: [sortHand(tiles.slice(0, HAND_SIZE)), sortHand(tiles.slice(HAND_SIZE, HAND_SIZE * 2))],
      shown: ids.slice(0, SHOWN_COUNT),
      deck: ids.slice(SHOWN_COUNT),
      log: [],
      phase: 'play',
      finalQueue: [],
      finalGuesses: {},
      winner: null, // 0 | 1 | 'draw'
      over: false,
      turns: 0,
    };
  }

  const actor = (s) => (s.phase === 'final' ? s.finalQueue[0] : s.turn);

  function ask(s, p, cardId, choice = null) {
    if (s.over || s.phase !== 'play') throw new Error('質問できる状態ではありません');
    if (s.turn !== p) throw new Error('手番ではありません');
    if (!s.shown.includes(cardId)) throw new Error('場にないカードです');
    const card = cardById(cardId);
    if (!cardOptions(card).includes(choice)) throw new Error('選択が不正です');
    const a = card.answer(s.hands[1 - p], choice);
    const entry = { type: 'ask', by: p, cardId, choice, key: a.key, text: a.text };
    s.log.push(entry);
    s.shown.splice(s.shown.indexOf(cardId), 1);
    if (s.deck.length) s.shown.push(s.deck.shift());
    s.turns++;
    s.turn = 1 - p;
    if (s.shown.length === 0) {
      s.phase = 'final';
      s.finalQueue = [1 - p, p];
    }
    return entry;
  }

  function finish(s, winner) {
    s.over = true;
    s.phase = 'over';
    s.winner = winner;
  }

  // guess は並び順どおりの5枚。返り値の hidden が真のとき、結果は相手にまだ知らせない。
  function declare(s, p, guess) {
    if (s.over) throw new Error('ゲームは終了しています');
    if (actor(s) !== p) throw new Error('手番ではありません');
    if (!isValidHand(guess)) throw new Error('宣言の並びが正しくありません');
    const correct = handKey(guess) === handKey(s.hands[1 - p]);
    const entry = {
      type: 'declare',
      by: p,
      guessKey: handKey(guess),
      correct,
      hidden: s.phase === 'final',
    };
    s.log.push(entry);
    s.turns++;

    if (s.phase === 'play') {
      if (!correct) {
        s.turn = 1 - p;
      } else if (p === s.first) {
        s.phase = 'lastChance';
        s.turn = 1 - p;
      } else {
        finish(s, p);
      }
    } else if (s.phase === 'lastChance') {
      finish(s, correct ? 'draw' : s.first);
    } else if (s.phase === 'final') {
      s.finalGuesses[p] = correct;
      s.finalQueue.shift();
      if (s.finalQueue.length === 0) {
        const [c0, c1] = [s.finalGuesses[0], s.finalGuesses[1]];
        finish(s, c0 && !c1 ? 0 : c1 && !c0 ? 1 : 'draw');
      }
    }
    return { correct, hidden: entry.hidden, phase: s.phase, over: s.over, winner: s.winner };
  }

  return {
    COLOR_NAME,
    HAND_SIZE,
    SHOWN_COUNT,
    CARDS,
    makeTiles,
    cmpTile,
    sortHand,
    tileKey,
    handKey,
    isValidHand,
    allHands,
    candidatesFor,
    cardById,
    cardOptions,
    runs,
    newGame,
    actor,
    ask,
    declare,
  };
});
