(function () {
  'use strict';

  const T = Tagiron;
  const AI = TagironAI;
  const app = document.getElementById('app');

  const LEVELS = { easy: 'やさしい', normal: 'ふつう', strong: 'つよい' };
  const MARK = { R: '▲', B: '■', G: '●' };

  const S = {
    screen: 'setup', // setup | pass | turn | answer | notice | thinking | end
    cfg: { mode: 'cpu', level: 'normal', first: 'random' },
    game: null,
    viewer: 0,
    sel: null,
    modal: null, // null | 'declare' | 'cards'
    draft: ['', '', '', '', ''],
    err: '',
    notice: null, // { title, body, next }
    memo: [null, null],
    memoOpen: true,
  };

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const names = () => (S.cfg.mode === 'cpu' ? ['あなた', 'CPU'] : ['プレイヤー1', 'プレイヤー2']);
  const isCpu = (p) => S.cfg.mode === 'cpu' && p === 1;

  // ---- parts ---------------------------------------------------------------

  function tileHTML(t, small) {
    if (!t) return `<div class="tile back${small ? ' small' : ''}"></div>`;
    return `<div class="tile c-${t.c}${small ? ' small' : ''}" aria-label="${T.COLOR_NAME[t.c]}${t.n}">
      <span class="num">${t.n}</span><span class="col">${MARK[t.c]}${T.COLOR_NAME[t.c]}</span></div>`;
  }
  const handHTML = (hand, small) =>
    `<div class="tiles">${(hand || [null, null, null, null, null]).map((t) => tileHTML(t, small)).join('')}</div>`;

  function entryTitle(e) {
    const card = T.cardById(e.cardId);
    return card.title + (e.choice != null ? `［${e.choice}］` : '');
  }

  function logHTML(g, reveal) {
    const n = names();
    const items = g.log
      .filter((e) => reveal || !e.hidden)
      .map((e) =>
        e.type === 'ask'
          ? `<li><b>${n[e.by]}</b>の質問：${esc(entryTitle(e))} → <span class="ans">${esc(e.text)}</span></li>`
          : `<li><b>${n[e.by]}</b>が宣言 → ${
              e.correct ? '<span class="ans">正解！</span>' : '<span class="wrong">違います</span>'
            }</li>`
      )
      .reverse();
    return `<ul class="log">${items.join('') || '<li class="sub">まだ質問はありません</li>'}</ul>`;
  }

  const TILE_TYPES = (() => {
    const out = [];
    for (let n = 0; n <= 9; n++) out.push(...(n === 5 ? ['G5'] : ['R' + n, 'B' + n]));
    return out;
  })();
  const typeLabel = (k) => `${T.COLOR_NAME[k[0]]}${k[1]}`;

  // ---- memo ----------------------------------------------------------------

  const memoKeyRow = (c) => Array.from({ length: 10 }, (_, n) => (n === 5 ? (c === 'B' ? 'G5a' : 'G5b') : c + n));

  function initMemo(p, hand) {
    const cells = {};
    let g = 0;
    for (const t of hand) {
      if (t.c === 'G') cells[g++ === 0 ? 'G5a' : 'G5b'] = 1;
      else cells[t.c + t.n] = 1;
    }
    S.memo[p] = { cells, slots: ['', '', '', '', ''] };
  }

  function memoHTML(p) {
    const m = S.memo[p];
    const cell = (k) => {
      const v = m.cells[k] || 0;
      const c = k[0];
      const label = c === 'G' ? 5 : k.slice(1);
      return `<button class="memo-cell c-${c} m${v}" data-act="cell" data-key="${k}">${v === 2 ? '○' : ''}${label}</button>`;
    };
    return `<details ${S.memoOpen ? 'open' : ''}><summary>推理メモ（自分だけに表示）</summary>
      <div class="sub" style="margin:6px 0 0">タップで ✕(相手にない) → ○(相手にある) → 空欄 と切り替わります。自分のタイルは最初から✕です。</div>
      <div class="memo-grid">${memoKeyRow('B').map(cell).join('')}</div>
      <div class="memo-grid">${memoKeyRow('R').map(cell).join('')}</div>
      <div class="memo-slots">${m.slots
        .map((v, i) => `<input data-act="slot" data-i="${i}" value="${esc(v)}" placeholder="${i + 1}枚目" maxlength="12">`)
        .join('')}</div></details>`;
  }

  // ---- screens -------------------------------------------------------------

  function setupHTML() {
    const c = S.cfg;
    const btn = (group, val, label) =>
      `<button class="${c[group] === val ? 'on' : ''}" data-act="cfg" data-group="${group}" data-val="${val}">${label}</button>`;
    return `<h1>タギロン</h1>
      <p class="sub">隠された5枚のタイルを、質問カードの答えだけで論理的に推理する対戦ゲーム。運の要素はありません。</p>
      <div class="panel"><h2>対戦相手</h2>
        <div class="choices">${btn('mode', 'cpu', 'コンピュータと対戦')}${btn('mode', 'human', '人間と対戦（1台を交代で使う）')}</div>
        ${
          c.mode === 'cpu'
            ? `<h3>コンピュータの強さ</h3><div class="choices">${Object.keys(LEVELS)
                .map((k) => btn('level', k, LEVELS[k]))
                .join('')}</div>`
            : '<p class="sub" style="margin-top:10px">手番が変わるたびに「画面を渡す」確認画面が出ます。相手のタイルが見えないようにしてからタップしてください。</p>'
        }
        <h3>先攻</h3>
        <div class="choices">${btn('first', 'random', 'ランダム')}${btn('first', 'p0', c.mode === 'cpu' ? 'あなた' : 'プレイヤー1')}${btn(
      'first',
      'p1',
      c.mode === 'cpu' ? 'CPU' : 'プレイヤー2'
    )}</div>
      </div>
      <div class="row"><button class="primary grow" data-act="start">ゲーム開始</button><button data-act="rules">質問カード一覧</button></div>
      <div class="panel" style="margin-top:12px"><h2>遊び方</h2>
        <p class="sub" style="margin:0">
          各自5枚のタイルを小さい順に並べて隠します。手番では場の質問カードを1枚選んで相手に質問するか、相手のタイル5枚を「宣言」します。
          相手の色と数字と並びを完全に当てた方が勝ちです。先攻が正解した場合のみ、後攻にも1回だけ宣言のチャンスがあり、後攻も正解なら引き分けです。
          外れた宣言はやり直せますが、その手番は質問できません。</p></div>`;
  }

  function passHTML() {
    return `<div class="center-screen"><h1>タギロン</h1>
      <div class="big">${esc(names()[S.viewer])}の番です</div>
      <p class="sub">相手に画面が見えないようにしてから、下のボタンを押してください。</p>
      <button class="primary" data-act="ready">自分のタイルを見る</button></div>`;
  }

  function turnHTML() {
    const g = S.game;
    const n = names();
    const p = S.viewer;
    const restricted = g.phase !== 'play';
    const remaining = g.shown.length + g.deck.length;
    const sel = S.sel && g.shown.includes(S.sel) ? T.cardById(S.sel) : null;

    let banner = '';
    if (g.phase === 'lastChance')
      banner = `<div class="banner">相手が先攻で完全に当てました。あなたにも<b>1回だけ</b>宣言のチャンスがあります。質問はできません。</div>`;
    if (g.phase === 'final')
      banner = `<div class="banner">質問カードを使い切りました。最後に1回だけ宣言します（結果は双方の宣言後に発表）。</div>`;

    const cards = g.shown
      .map((id) => {
        const c = T.cardById(id);
        return `<button class="qcard${S.sel === id ? ' sel' : ''}" data-act="sel" data-id="${id}" ${restricted ? 'disabled' : ''}>${esc(c.title)}${
          c.choices ? `<small>${c.choices.join(' か ')} から選ぶ</small>` : ''
        }</button>`;
      })
      .join('');

    let selPanel = '';
    if (sel) {
      selPanel = `<div class="panel"><b>${esc(sel.title)}</b><div class="row" style="margin-top:8px">${
        sel.choices
          ? sel.choices.map((c) => `<button class="primary" data-act="ask" data-id="${sel.id}" data-choice="${c}">${c}について質問する</button>`).join('')
          : `<button class="primary" data-act="ask" data-id="${sel.id}">この質問をする</button>`
      }</div></div>`;
    }

    return `<div class="turnbar"><div><b>${esc(n[p])}</b>の番 <span class="badge ${g.first === p ? 'accent' : ''}">${
      g.first === p ? '先攻' : '後攻'
    }</span></div><div class="row"><span class="badge">残りカード ${remaining}枚</span><button class="small" data-act="rules">カード一覧</button></div></div>
      ${banner}
      <h3>${esc(n[1 - p])}のタイル</h3>${handHTML(null, false)}
      <h3>質問カード（場に${g.shown.length}枚）</h3>
      <div class="qcards">${cards}</div>
      ${selPanel}
      <h3>あなたのタイル</h3>${handHTML(g.hands[p], false)}
      <div class="row center" style="margin:8px 0 16px"><button class="danger" data-act="declare">宣言する</button></div>
      ${memoHTML(p)}
      <div class="panel"><h2>質問の記録</h2>${logHTML(g, false)}</div>
      <div class="row"><button class="small" data-act="quit">タイトルへ戻る</button></div>`;
  }

  function answerHTML() {
    const e = S.notice;
    return `<div class="center-screen"><div class="sub">${esc(e.title)}</div><div class="big">${esc(e.question)}</div>
      <div class="answer">${esc(e.body)}</div><button class="primary" data-act="next">手番を終える</button></div>`;
  }

  function noticeHTML() {
    const e = S.notice;
    return `<div class="center-screen"><div class="big">${esc(e.title)}</div><p class="sub">${esc(e.body)}</p>
      <button class="primary" data-act="next">続ける</button></div>`;
  }

  function endHTML() {
    const g = S.game;
    const n = names();
    const title = g.winner === 'draw' ? '引き分け' : `${n[g.winner]}の勝ち！`;
    return `<div class="center-screen"><h1>タギロン</h1><div class="big">${title}</div>
      <div class="sub">${g.turns}手で決着</div></div>
      <div class="panel"><h2>${esc(n[0])}のタイル</h2>${handHTML(g.hands[0], true)}<h2>${esc(n[1])}のタイル</h2>${handHTML(g.hands[1], true)}</div>
      <div class="panel"><h2>全ての記録</h2>${logHTML(g, true)}</div>
      <div class="row center"><button class="primary" data-act="start">同じ設定でもう一度</button><button data-act="quit">タイトルへ</button></div>`;
  }

  function declareModalHTML() {
    const opts = TILE_TYPES.map((k) => `<option value="${k}">${typeLabel(k)}</option>`).join('');
    const slots = S.draft
      .map(
        (v, i) =>
          `<select data-act="draft" data-i="${i}"><option value="">${i + 1}枚目</option>${opts.replace(
            `value="${v}"`,
            `value="${v}" selected`
          )}</select>`
      )
      .join('');
    return `<div class="overlay"><div class="modal"><h2>宣言する</h2>
      <p class="sub">相手のタイル5枚を、左から小さい順（同じ数は赤が左）に選んでください。${
        S.game.phase === 'play' ? '外れた場合、この手番は質問できず相手に交代します。' : ''
      }</p>
      <div class="slots">${slots}</div><div class="err">${esc(S.err)}</div>
      <div class="row"><button class="danger grow" data-act="declare-ok">この内容で宣言する</button><button data-act="modal-close">やめる</button></div></div></div>`;
  }

  function cardsModalHTML() {
    return `<div class="overlay"><div class="modal"><h2>質問カード一覧（全${T.CARDS.length}枚）</h2>
      <p class="sub">「説明書」は付属のルール説明書にある質問、「補完」は説明書に全文がないため補った質問です。</p>
      <ul class="cardlist">${T.CARDS.map(
        (c) =>
          `<li><span>${esc(c.title)}${c.choices ? `（${c.choices.join('か')}を選ぶ）` : ''}</span><span class="badge ${
            c.kind === 'official' ? 'accent' : ''
          }">${c.kind === 'official' ? '説明書' : '補完'}</span></li>`
      ).join('')}</ul>
      <div class="row" style="margin-top:12px"><button class="grow" data-act="modal-close">閉じる</button></div></div></div>`;
  }

  function render() {
    const body = {
      setup: setupHTML,
      pass: passHTML,
      turn: turnHTML,
      answer: answerHTML,
      notice: noticeHTML,
      end: endHTML,
      thinking: () => `<div class="center-screen"><div class="big">CPUが考え中…</div></div>`,
    }[S.screen]();
    const modal = S.modal === 'declare' ? declareModalHTML() : S.modal === 'cards' ? cardsModalHTML() : '';
    app.innerHTML = body + modal;
  }

  // ---- flow ----------------------------------------------------------------

  function startGame() {
    const first = S.cfg.first === 'random' ? Math.floor(Math.random() * 2) : S.cfg.first === 'p0' ? 0 : 1;
    S.game = T.newGame({ first });
    S.memo = [null, null];
    initMemo(0, S.game.hands[1]);
    initMemo(1, S.game.hands[0]);
    S.modal = null;
    proceed();
  }

  function proceed() {
    const g = S.game;
    S.sel = null;
    S.modal = null;
    if (g.over) S.screen = 'end';
    else {
      const p = T.actor(g);
      if (isCpu(p)) {
        S.screen = 'thinking';
        render();
        setTimeout(cpuAct, 700);
        return;
      }
      S.viewer = p;
      S.screen = S.cfg.mode === 'human' ? 'pass' : 'turn';
    }
    render();
  }

  function setNotice(n) {
    S.notice = Object.assign({ next: proceed }, n);
    S.screen = n.question ? 'answer' : 'notice';
    render();
  }

  function describeDeclare(by, res) {
    const n = names();
    const who = isCpu(by) ? 'CPU' : n[by];
    if (res.over) return null;
    if (res.hidden) return { title: `${who}の宣言を受け付けました`, body: '結果は双方が宣言した後に発表されます。' };
    if (!res.correct)
      return { title: `${who}の宣言は「違います！」`, body: `${who}は質問も宣言も続けられます。この手番は終わりです。` };
    return {
      title: `${who}の宣言は「正解！」`,
      body: `${who}は先攻なので、${n[1 - by]}にも1回だけ宣言のチャンスがあります。後攻も正解なら引き分けです。`,
    };
  }

  function cpuAct() {
    const g = S.game;
    if (!g || g.over || !isCpu(T.actor(g))) return;
    const a = AI.chooseAction(g, 1, S.cfg.level, Math.random);
    if (a.type === 'ask') {
      const e = T.ask(g, 1, a.cardId, a.choice);
      setNotice({ title: 'CPUの質問', question: entryTitle(e), body: `あなたのタイル → ${e.text}` });
    } else {
      const res = T.declare(g, 1, a.guess);
      const d = describeDeclare(1, res);
      if (d) setNotice(d);
      else proceed();
    }
  }

  function doAsk(id, choice) {
    const g = S.game;
    const p = S.viewer;
    const e = T.ask(g, p, id, choice);
    setNotice({ title: `${names()[p]}の質問`, question: entryTitle(e), body: `${names()[1 - p]}のタイル → ${e.text}` });
  }

  function doDeclare() {
    const draft = S.draft;
    if (draft.some((v) => !v)) return fail('5枚とも選んでください');
    const guess = draft.map((k) => ({ c: k[0], n: Number(k[1]) }));
    if (!T.isValidHand(guess)) return fail('小さい数から順に並べてください（同じ数は赤が左、同じタイルは重複できません）');
    const p = S.viewer;
    const res = T.declare(S.game, p, guess);
    S.draft = ['', '', '', '', ''];
    S.err = '';
    S.modal = null;
    const d = describeDeclare(p, res);
    if (d) setNotice(d);
    else proceed();
  }

  function fail(msg) {
    S.err = msg;
    render();
  }

  // ---- events --------------------------------------------------------------

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    const d = el.dataset;
    switch (d.act) {
      case 'cfg':
        S.cfg[d.group] = d.val;
        return render();
      case 'start':
        return startGame();
      case 'rules':
        S.modal = 'cards';
        return render();
      case 'modal-close':
        S.modal = null;
        S.err = '';
        return render();
      case 'ready':
        S.screen = 'turn';
        return render();
      case 'sel':
        S.sel = d.id;
        return render();
      case 'ask':
        return doAsk(d.id, d.choice === undefined ? null : Number(d.choice));
      case 'declare':
        S.modal = 'declare';
        S.err = '';
        return render();
      case 'declare-ok':
        return doDeclare();
      case 'next':
        return S.notice.next();
      case 'cell': {
        const m = S.memo[S.viewer];
        m.cells[d.key] = ((m.cells[d.key] || 0) + 1) % 3;
        return render();
      }
      case 'quit':
        if (S.screen === 'end' || confirm('ゲームを終了してタイトルへ戻りますか？')) {
          S.screen = 'setup';
          S.game = null;
          render();
        }
    }
  });

  app.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'draft') {
      S.draft[Number(el.dataset.i)] = el.value;
      S.err = '';
      render();
    }
  });

  app.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'slot') S.memo[S.viewer].slots[Number(el.dataset.i)] = el.value;
  });

  app.addEventListener(
    'toggle',
    (ev) => {
      if (ev.target.tagName === 'DETAILS') S.memoOpen = ev.target.open;
    },
    true
  );

  render();
})();
