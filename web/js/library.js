// 서재(공동묘지·명예의 전당·도감·크레딧)와 내 정보 화면
import * as E from "./engine.js";
import { h, clear } from "./dom.js";
import { cardEl, attachCardTip } from "./components.js";
import { ctx, mount, modal, confirmModal, gadgetChip, toast } from "./ui.js";
import { store } from "./storage.js";

const fmt_date = (s) => s ?? "";

function frame(title, sub, body, onBack) {
  return h("div", { class: "screen" },
    h("div", { class: "lib" },
      h("button", { class: "btn btn-ghost btn-sm", onclick: onBack }, "← 돌아가기"),
      h("h1", { style: { marginTop: "10px" } }, title),
      sub ? h("p", { class: "muted", style: { margin: 0 } }, sub) : null,
      body));
}

function tabs(items, current, onPick) {
  return h("div", { class: "tabs", role: "tablist" }, items.map(([id, label]) =>
    h("button", { class: "tab", role: "tab", "aria-selected": String(id === current), onclick: () => onPick(id) }, label)));
}

// ==================================================
// 서재
// ==================================================
export function openLibrary(initial = "graves") {
  return new Promise((resolve) => {
    let tab = initial, sub = "cards";
    const draw = () => {
      const body = h("div", {});
      body.append(tabs([["graves", "공동묘지"], ["clears", "명예의 전당"], ["book", "도감"], ["credits", "크레딧"]], tab, (t) => { tab = t; draw(); }));
      if (tab === "graves") body.append(graves_view());
      else if (tab === "clears") body.append(clears_view());
      else if (tab === "book") body.append(book_view(sub, (s) => { sub = s; draw(); }));
      else body.append(credits_view());
      mount(frame("서재", "", body, () => resolve()), "library");
    };
    draw();
  });
}

// ---------- 기록 (묘비 / 클리어) ----------
function record_detail(rec, kind) {
  const deck = Object.entries(rec.deck ?? {});
  const gadgets = Object.entries(rec.gadgets ?? {});
  const passives = (rec.passives ?? []).map((id) => E.load_passive_data(id)?.name ?? id);
  const m = modal(h("div", {},
    h("h2", {}, kind === "grave" ? `${rec.name}의 묘비` : `${rec.name} (LV.${rec.level ?? 1})`),
    h("p", { class: "sub" }, `${kind === "grave" ? "사망 일시" : "클리어 일시"}: ${fmt_date(rec.date)}${rec.story ? ` · ${rec.story}` : ""}`),
    kind === "grave" ? h("p", { class: "will" }, rec.will ? `“${rec.will}”` : "남긴 말이 없습니다.") : null,
    h("dl", { class: "kv" },
      h("dt", {}, "최종 체력"), h("dd", {}, `${rec.hp} / ${rec.max_hp}`),
      h("dt", {}, "최종 정신력"), h("dd", {}, `${rec.sanity} / ${rec.max_sanity}`),
      h("dt", {}, "흐트러짐 저항"), h("dd", {}, String(rec.stagger_resist ?? 20)),
      h("dt", {}, "빛 / 슬롯"), h("dd", {}, `${rec.max_cost ?? 3} / ${rec.card_slot ?? 1}`),
      h("dt", {}, "패시브"), h("dd", {}, passives.length ? passives.join(", ") : "없음")),
    h("table", { class: "table" },
      h("tr", {}, h("th", {}, "속성"), h("th", {}, "피해"), h("th", {}, "흐트러짐")),
      ...["slash", "pierce", "blunt"].map((k) => h("tr", {}, h("td", {}, E.DICE_TYPE_MAP[k]),
        h("td", {}, `${rec.endurance?.[k] ?? 1}x`), h("td", {}, `${rec.stagger_endurance?.[k] ?? 1}x`)))),
    h("h3", {}, "가젯"),
    gadgets.length ? h("div", { class: "hud-gadgets" }, gadgets.map(([id, n]) => gadgetChip(id, n))) : h("p", { class: "muted" }, "없음"),
    h("h3", {}, "덱"),
    h("div", { class: "card-grid" }, deck.map(([id, n]) => {
      const c = cardEl(E.load_card(id));
      attachCardTip(c, () => E.load_card(id));
      return h("div", { class: "pick-row" }, c, h("span", { class: "muted" }, `x${n}`));
    })),
    h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))), { wide: true });
}

function record_list(list, kind, empty) {
  if (!list.length) return h("p", { class: "empty-note" }, empty);
  return h("div", { class: "list" }, list.map((rec) =>
    h("button", { class: "record", onclick: () => record_detail(rec, kind) },
      h("span", {}, h("strong", {}, rec.name), kind === "clear" ? ` · LV.${rec.level ?? 1}` : (rec.will ? ` · “${rec.will.slice(0, 40)}”` : "")),
      h("span", { class: "muted" }, fmt_date(rec.date)))));
}
const graves_view = () => record_list(store.graves(), "grave", "아직 묘비가 없습니다. 죽으면 이곳에 기록이 남습니다.");
const clears_view = () => record_list(store.clears(), "clear", "아직 클리어 기록이 없습니다.");

// ---------- 도감 ----------
function book_view(sub, setSub) {
  const wrap = h("div", {});
  wrap.append(h("div", { class: "tabs", role: "tablist", style: { marginTop: 0 } },
    [["cards", "카드"], ["enemies", "적 정보"], ["gadgets", "가젯"]].map(([id, label]) =>
      h("button", { class: "tab", role: "tab", "aria-selected": String(id === sub), onclick: () => setSub(id) }, label))));
  const p = E.game.profile;
  if (sub === "cards") {
    const ids = (p.unlocked_cards ?? []).filter((id) => E.game.data.cards[id]);
    wrap.append(ids.length ? h("div", { class: "card-grid" }, ids.map((id) => {
      const c = cardEl(E.load_card(id));
      attachCardTip(c, () => E.load_card(id));
      return c;
    })) : h("p", { class: "empty-note" }, "기록된 카드가 없습니다. 카드를 얻거나 적과 싸우면 채워집니다."));
  } else if (sub === "enemies") {
    const ids = (p.unlocked_enemies ?? []).filter((id) => E.game.data.enemies[id]);
    wrap.append(ids.length ? h("div", { class: "list" }, ids.map((id) => {
      const d = E.game.data.enemies[id].status ?? {};
      return h("button", { class: "record", onclick: () => enemy_detail(id) },
        h("strong", {}, d.name ?? id), h("span", { class: "muted" }, `처치 ${p.enemy_kills?.[id] ?? 0}회`));
    })) : h("p", { class: "empty-note" }, "처치 기록이 있는 적이 없습니다."));
  } else {
    const ids = (p.unlocked_gadgets ?? []).filter((id) => E.game.data.gadgets[id]);
    const cats = {};
    for (const id of ids) for (const c of (E.game.data.gadgets[id].category ?? ["기타"])) (cats[c] ??= []).push(id);
    const names = Object.keys(cats).sort();
    wrap.append(names.length ? names.map((cat) => h("section", { style: { marginBottom: "18px" } },
      h("h3", { style: { margin: "0 0 8px" } }, `${cat} (${cats[cat].length}종)`),
      h("div", { class: "list" }, cats[cat].map((id) => {
        const g = E.game.data.gadgets[id];
        return h("button", { class: "record", onclick: () => gadget_detail(id) }, h("strong", {}, g.name ?? id), h("span", { class: "muted" }, (g.desc ?? "").slice(0, 38)));
      })))) : h("p", { class: "empty-note" }, "획득한 기록이 있는 가젯이 없습니다."));
  }
  return wrap;
}

function enemy_detail(id) {
  const s = E.game.data.enemies[id].status ?? {};
  const kills = E.game.profile.enemy_kills?.[id] ?? 0;
  const deck = Object.entries(s.deck ?? {});
  const m = modal(h("div", {},
    h("h2", {}, s.name ?? id),
    h("p", { class: "sub" }, `총 처치 ${kills}회`),
    h("dl", { class: "kv" },
      h("dt", {}, "최대 체력"), h("dd", {}, String(s.hp ?? 0)),
      h("dt", {}, "최대 정신력"), h("dd", {}, String(s.sanity ?? 0)),
      h("dt", {}, "흐트러짐 저항"), h("dd", {}, String(s.stagger_resist ?? 20)),
      h("dt", {}, "패시브"), h("dd", {}, (s.passives ?? []).map((p) => E.load_passive_data(p)?.name ?? p).join(", ") || "없음")),
    h("table", { class: "table" },
      h("tr", {}, h("th", {}, "속성"), h("th", {}, "피해"), h("th", {}, "흐트러짐")),
      ...["slash", "pierce", "blunt"].map((k) => h("tr", {}, h("td", {}, E.DICE_TYPE_MAP[k]),
        h("td", {}, `${s.endurance?.[k] ?? 1}x`), h("td", {}, `${s.stagger_endurance?.[k] ?? 1}x`)))),
    h("h3", {}, "사용 카드"),
    h("div", { class: "card-grid" }, deck.map(([cid, n]) => {
      const c = cardEl(E.load_card(cid));
      attachCardTip(c, () => E.load_card(cid));
      return h("div", { class: "pick-row" }, c, h("span", { class: "muted" }, `x${n}`));
    })),
    h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))), { wide: true });
}

function gadget_detail(id) {
  const g = E.game.data.gadgets[id];
  const m = modal(h("div", {},
    h("h2", {}, g.name ?? id),
    h("p", { class: "sub" }, (g.category ?? []).join(", ")),
    h("p", { style: { font: "400 16px/1.8 var(--serif)" } }, g.desc ?? "설명이 없습니다."),
    h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))));
}

// ---------- 크레딧 ----------
function credits_view() {
  const c = ctx.bundle.credits ?? {};
  const wrap = h("div", {});
  if (c.developer) wrap.append(h("div", { class: "credit-row" }, h("strong", {}, "개발"), h("div", { class: "muted" }, c.developer)));
  wrap.append(h("h3", { style: { margin: "22px 0 4px" } }, "배경음"));
  for (const b of c.bgm ?? []) {
    wrap.append(h("div", { class: "credit-row" },
      h("div", {}, h("strong", {}, b.role), " — ", b.title),
      h("div", { class: "muted" }, [b.artist, b.original ? `원곡: ${b.original}` : null].filter(Boolean).join(" · ")),
      b.url ? h("a", { href: b.url, target: "_blank", rel: "noopener noreferrer" }, b.url) : null));
  }
  if (c.sfx) wrap.append(h("h3", { style: { margin: "22px 0 4px" } }, "효과음"),
    h("div", { class: "credit-row" }, `${c.sfx.source}${c.sfx.owner ? ` (${c.sfx.owner})` : ""}`));
  if (c.notice) wrap.append(h("p", { class: "muted", style: { marginTop: "26px" } }, c.notice));
  return wrap;
}

// ==================================================
// 내 정보
// ==================================================
export function openProfile() {
  const p = E.game.profile;
  const ach = p.achievements ?? [];
  const m = modal(h("div", {},
    h("h2", {}, "내 정보"),
    h("dl", { class: "kv" },
      h("dt", {}, "죽은 횟수"), h("dd", {}, `${p.death_count ?? 0}회`),
      h("dt", {}, "해금한 카드"), h("dd", {}, `${(p.unlocked_cards ?? []).length}종`),
      h("dt", {}, "만난 적"), h("dd", {}, `${(p.unlocked_enemies ?? []).length}종`)),
    h("h3", {}, "도전과제"),
    ach.length ? h("ul", {}, ach.map((a) => h("li", {}, a))) : h("p", { class: "muted" }, "없음"),
    h("p", { class: "muted", style: { marginTop: "16px", fontSize: "13px" } }, "기록은 이 브라우저에만 저장됩니다. 다른 기기나 브라우저와는 공유되지 않아요."),
    h("div", { class: "modal-actions" },
      h("button", { class: "btn btn-ghost", onclick: async () => {
        if (await confirmModal("기록을 모두 지울까요?", "도감, 도전과제, 묘비, 클리어 기록이 모두 사라지고 되돌릴 수 없습니다.", "모두 지우기")) {
          store.resetAll();
          E.game.profile = store.loadProfile(ctx.bundle.profile_default);
          toast("기록을 지웠습니다.");
          m.close("reset");
        }
      } }, "기록 초기화"),
      h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))));
  return m.promise;
}
