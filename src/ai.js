(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.TagironAI = factory(root.Tagiron);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  // 公開された情報(自分の手札と、自分の質問の答え、外れた宣言)だけから、相手の手札の候補を絞る。
  function candidates(state, me) {
    let c = T.candidatesFor(state.hands[me]);
    for (const e of state.log) {
      if (e.by !== me) continue;
      if (e.type === 'ask') {
        const card = T.cardById(e.cardId);
        c = c.filter((h) => card.answer(h, e.choice).key === e.key);
      } else if (e.type === 'declare' && !e.correct) {
        c = c.filter((h) => h.key !== e.guessKey);
      }
    }
    return c;
  }

  // 質問の良さ = 答えごとに分かれた候補数の二乗和(小さいほど絞れる)。
  function score(cands, card, choice) {
    const groups = new Map();
    for (const h of cands) {
      const k = card.answer(h, choice).key;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    let s = 0;
    for (const n of groups.values()) s += n * n;
    return { s, groups: groups.size };
  }

  const pickRandom = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  const BEST_RATE = { easy: 0, normal: 0.6, strong: 1 };
  const DECLARE_RATE = { easy: 0.7, normal: 1, strong: 1 };

  // returns { type:'ask', cardId, choice } | { type:'declare', guess }
  function chooseAction(state, me, level = 'normal', rng = Math.random) {
    const cands = candidates(state, me);
    const guess = () => pickRandom(cands.length ? cands : T.allHands(), rng);

    if (state.phase !== 'play') return { type: 'declare', guess: guess() };

    if (cands.length === 1 && rng() < DECLARE_RATE[level]) {
      return { type: 'declare', guess: cands[0] };
    }

    const options = [];
    for (const id of state.shown) {
      const card = T.cardById(id);
      for (const choice of T.cardOptions(card)) options.push({ cardId: id, choice, card });
    }

    let pick;
    if (rng() < BEST_RATE[level]) {
      let best = Infinity;
      let bests = [];
      for (const o of options) {
        const { s } = score(cands, o.card, o.choice);
        if (s < best) {
          best = s;
          bests = [o];
        } else if (s === best) bests.push(o);
      }
      // どの質問でも絞れないなら、これ以上は賭けるしかない。
      if (cands.length > 1 && best === cands.length * cands.length && level === 'strong') {
        return { type: 'declare', guess: guess() };
      }
      pick = pickRandom(bests, rng);
    } else {
      pick = pickRandom(options, rng);
    }
    return { type: 'ask', cardId: pick.cardId, choice: pick.choice };
  }

  return { candidates, chooseAction };
});
