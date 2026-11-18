import { useStore } from '../lib/store';
import { waitLabel } from '../lib/queue';
import { newId, pad3 } from '../lib/format';
import { Sheet, Badge, CategoryTag } from './common';
import { useAsk } from './Confirm';

interface Props {
  visitorId: string;
  onClose: () => void;
  /** 指定すると「付け替え」モード: 待機中のこの待ち札を、選んだ相談先の最後尾へ移す */
  moveTicketId?: string;
  fromDeskId?: number;
  /** 行き先が決まったとき(相談先名 / 帰宅)に呼ばれる */
  onChosen?: (text: string) => void;
}

/**
 * 「次の行き先」を決める(相談しながら決まっていくので、希望先は目安として上に出すだけで、どこにでも並べる)。
 * moveTicketId を渡すと、待ちの途中で別の相談先へ付け替える画面になる。
 */
export function NextSheet({ visitorId, onClose, moveTicketId, fromDeskId, onChosen }: Props) {
  const { views, deskStates, act } = useStore();
  const ask = useAsk();
  const view = views.find((v) => v.visitor.id === visitorId);
  if (!view) return null;
  const { visitor } = view;
  const moving = Boolean(moveTicketId);
  const label = `${pad3(visitor.no)} ${visitor.surname}`;

  async function choose(deskId: number) {
    const target = deskStates.find((d) => d.desk.id === deskId);
    const name = target?.desk.name ?? '';
    const from = fromDeskId !== undefined ? deskStates.find((d) => d.desk.id === fromDeskId)?.desk.name ?? '' : '';
    const ok = await ask(moveTicketId
      ? { title: '付け替えの確認', okLabel: '付け替える',
          lines: [['相談者', `${label}さん`], ['移動', `${from} → ${name}`], ['順番', `${name} の待ち行列の最後尾(待ち${target?.waiting.length ?? 0}人)`]] }
      : { title: '次の行き先の確認', okLabel: '待ち行列に並ばせる',
          lines: [['相談者', `${label}さん`], ['行き先', name], ['順番', `待ち行列の最後尾(いま待ち${target?.waiting.length ?? 0}人 / ${waitLabel(target?.newArrivalWait ?? 0)})`]] });
    if (!ok) return;
    onChosen?.(`${name}へ`);
    onClose();
    if (moveTicketId) {
      await act('move_ticket', { p_ticket_id: moveTicketId, p_new_ticket_id: newId(), p_desk_id: deskId }, `${label} を付け替え`);
    } else {
      await act('enqueue', { p_ticket_id: newId(), p_visitor_id: visitorId, p_desk_id: deskId }, `${label} を並ばせる`);
    }
  }
  async function leave() {
    const ok = await ask({ title: '帰宅の確認', okLabel: '帰宅として登録する',
      lines: [['相談者', `${label}さん`], ['登録', '帰宅(待ち行列に並んでいれば取り消されます)']] });
    if (!ok) return;
    onChosen?.('帰宅');
    onClose();
    await act('leave_visitor', { p_visitor_id: visitorId }, `${label} 帰宅`);
  }

  const open = deskStates.filter((s) => s.desk.active && s.desk.id !== fromDeskId);
  const wished = open.filter((s) => view.wishesLeft.includes(s.desk.id));
  const others = open.filter((s) => !view.wishesLeft.includes(s.desk.id));

  const row = (s: (typeof open)[number], isWish: boolean) => {
    const consulted = view.consultedDeskIds.includes(s.desk.id);
    return (
      <li key={s.desk.id}>
        <button className={`row-btn cat-bar cat-${s.desk.category}`} onClick={() => choose(s.desk.id)}>
          <span className="grow">
            <strong>{s.desk.name}</strong> <CategoryTag category={s.desk.category} />
            {isWish && <> <Badge kind="wait">希望</Badge></>}
            {consulted && <> <Badge kind="done">相談済み</Badge></>}
          </span>
          <span>待ち{s.waiting.length}人 / {waitLabel(s.newArrivalWait)}</span>
        </button>
      </li>
    );
  };

  return (
    <Sheet title={moving ? `${label}さん 相談先の付け替え` : `${label}さん 次の行き先`} onClose={onClose}>
      <p className="hint">
        {moving
          ? '選んだ相談先の待ち行列の最後尾に移します。'
          : '行き先を選ぶと、その相談先の待ち行列の最後尾に並びます。相談しながら決まった行き先は、希望になくても選べます。'}
      </p>
      {wished.length > 0 && (
        <>
          <h3 className="section">受付時に希望していた相談先(まだ相談していない先)</h3>
          <ul className="list">{wished.map((s) => row(s, true))}</ul>
        </>
      )}
      <h3 className="section">{wished.length > 0 ? 'ほかの相談先' : '相談先'}</h3>
      <ul className="list">{others.map((s) => row(s, false))}</ul>
      <div className="actions">
        {!moving && <button className="btn" onClick={leave}>帰宅</button>}
        <button className="btn ghost" onClick={onClose}>{moving ? 'やめる' : 'あとで決める'}</button>
      </div>
    </Sheet>
  );
}
