// 공용 화면 부품: 카드, 게이지, 상태이상 칩, 툴팁
import * as E from "./engine.js";
import { h, svg, clear } from "./dom.js";
import { describe_card } from "./cardinfo.js";

// ---------- 주사위 아이콘 ----------
const ICONS = {
  slash: () => svg("path", { d: "M5 19 L19 5 M5 13 L13 5 M11 19 L19 11", "stroke-width": 2.4, "stroke-linecap": "round", fill: "none" }),
  pierce: () => svg("path", { d: "M12 21 V4 M6 10 L12 4 L18 10", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }),
  blunt: () => svg("rect", { x: 5, y: 5, width: 14, height: 14, rx: 3.5, "stroke-width": 0, fill: "currentColor" }),
  block: () => svg("path", { d: "M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z", "stroke-width": 0, fill: "currentColor" }),
  evade: () => svg("path", { d: "M3 8 H14 M3 16 H10 M13 6 L20 12 L13 18", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }),
};
export function diceIcon(damage_type) {
  const base = String(damage_type).replace("counter_", "");
  const mk = ICONS[base] ?? ICONS.blunt;
  return svg("svg", { viewBox: "0 0 24 24", class: "die-ic", "aria-hidden": "true", stroke: "currentColor" }, mk());
}

// ---------- 카드 ----------
export function cardEl(card, { mini = false, extra = "" } = {}) {
  const d = describe_card(card);
  const el = h("div", {
    class: `card g-${card.grade.replace(/\W/g, "")} ct-${card.type} ${mini ? "mini" : ""} ${extra}`,
    dataset: { cardId: card.id },
    tabindex: "0",
    role: "button",
    "aria-label": `${d.name}, 비용 ${d.cost}, ${d.type_label}`,
  },
    h("div", { class: "card-cost", title: "비용(빛)" }, String(d.cost)),
    h("div", { class: "card-name" }, d.name),
    h("div", { class: "card-meta" }, `${d.type_label} · ${d.grade_label}`),
    h("ul", { class: "card-dice" }, d.dice.map((x) =>
      h("li", { class: `die dt-${x.damage_type.replace("counter_", "")} dk-${x.kind}` },
        diceIcon(x.damage_type),
        h("span", { class: "die-range" }, x.min === x.max ? `${x.min}` : `${x.min}~${x.max}`),
        x.has_gun ? h("span", { class: "die-gun", title: "탄환 소모" }, "탄") : null,
        h("span", { class: "sr" }, `${x.kind_label} ${x.type_label}`),
      ))),
    d.uses.length ? h("div", { class: "card-uses" }, d.uses[0] + (d.uses.length > 1 ? " …" : "")) : null,
  );
  return el;
}

// ---------- 툴팁 (카드 상세) ----------
let tipEl = null;
function ensureTip() {
  if (!tipEl) {
    tipEl = h("div", { class: "tip", role: "tooltip", hidden: true });
    document.body.append(tipEl);
  }
  return tipEl;
}
export function statusSheet(s, state = null) {
  const meta = state ? `위력 ${state.amount} · 횟수 ${state.count}` : "상태이상";
  return h("div", { class: `sheet status-sheet st-${s.id}` },
    h("div", { class: "sheet-head" },
      h("div", { class: "sheet-name" }, s.name),
      h("div", { class: "sheet-sub" }, meta),
    ),
    h("p", { class: "sheet-desc" }, s.desc || s.effects?.[0]?.desc || "설명이 없습니다."),
  );
}

export function cardSheet(card) {
  const d = describe_card(card);
  const main = h("div", { class: `sheet g-${card.grade.replace(/\W/g, "")}` },
    h("div", { class: "sheet-head" },
      h("span", { class: "card-cost" }, String(d.cost)),
      h("div", {}, h("div", { class: "sheet-name" }, d.name), h("div", { class: "sheet-sub" }, `${d.type_label} · ${d.grade_label}`)),
    ),
    d.uses.length ? h("ul", { class: "sheet-uses" }, d.uses.map((u) => h("li", {}, u))) : null,
    h("ol", { class: "sheet-dice" }, d.dice.map((x) =>
      h("li", { class: `dt-${x.damage_type.replace("counter_", "")}` },
        h("div", { class: "sheet-die-row" },
          diceIcon(x.damage_type),
          h("b", {}, `${x.kind_label}(${x.type_label})`),
          h("span", { class: "die-range" }, `${x.min}~${x.max}`)),
        x.notes.length ? h("ul", { class: "sheet-notes" }, x.notes.map((n) => h("li", {}, n))) : null,
      ))),
    d.dialogue ? h("p", { class: "sheet-quote" }, d.dialogue) : null,
  );

  const statuses = d.statuses ?? [];
  if (!statuses.length) return main;

  return h("div", { class: "sheet-wrap" },
    main,
    h("div", { class: "sheet-side" },
      statuses.map((s) => statusSheet(s)),
    ),
  );
}
export function showTip(content, anchor) {
  const tip = ensureTip();
  clear(tip).append(content);
  tip.hidden = false;
  const a = anchor.getBoundingClientRect();
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  let x = a.right + 12;
  if (x + w > window.innerWidth - 8) x = a.left - w - 12;
  if (x < 8) x = Math.max(8, Math.min(window.innerWidth - w - 8, a.left + a.width / 2 - w / 2));
  let y = a.top + a.height / 2 - hgt / 2;
  if (x > a.right || x + w < a.left) { /* 옆에 배치됨 */ } else {
    y = a.top - hgt - 10;
    if (y < 8) y = a.bottom + 10;
  }
  y = Math.max(8, Math.min(window.innerHeight - hgt - 8, y));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

export function attachTip(el, contentFn) {
  const show = () => showTip(contentFn(), el);
  el.addEventListener("mouseenter", show);
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", show);
  el.addEventListener("blur", hideTip);
}
export function attachCardTip(el, getCard) { attachTip(el, () => cardSheet(getCard())); }

// ---------- 게이지 ----------
export function bar(kind, value, max, label) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h("div", { class: `bar bar-${kind}`, role: "meter", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": label },
    h("div", { class: "bar-fill", style: { width: `${pct}%` } }),
    h("span", { class: "bar-text" }, `${label} ${value}/${max}`));
}
export function setBar(el, value, max, label) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  el.querySelector(".bar-fill").style.width = `${pct}%`;
  el.querySelector(".bar-text").textContent = `${label} ${value}/${max}`;
  el.setAttribute("aria-valuenow", value);
}

// ---------- 상태이상 ----------
export function statusChips(statuses) {
  const entries = Object.entries(statuses ?? {});
  return entries.map(([id, st]) => {
    const data = E.load_status_data(id) ?? { id, name: id, desc: "" };
    const el = h("span", {
      class: `chip st-${id}`,
      tabindex: "0",
      role: "button",
      "aria-label": `상태이상 ${data.name}: 위력 ${st.amount}, 횟수 ${st.count}. ${data.desc ?? ""}`,
    }, `${data.name} ${st.amount}(${st.count})`);
    attachTip(el, () => statusSheet(data, st));
    return el;
  });
}

// ---------- 패시브 / 패닉 ----------
// 효과가 하나도 없는 자리표시용 패시브(예: "없음")는 화면에 보여 주지 않는다.
export const isRealPassive = (p) => !!p && (p.effects?.length ?? 0) > 0;
export function realPassives(ids) {
  return (ids ?? []).map((id) => ({ id, data: E.load_passive_data(id) })).filter((x) => isRealPassive(x.data));
}
export function passiveSheet(p) {
  return h("div", { class: "sheet" },
    h("div", { class: "sheet-name" }, p.name),
    h("div", { class: "sheet-sub" }, "패시브"),
    h("p", { class: "sheet-desc" }, p.desc ?? "설명이 없습니다."));
}
// 전투 화면의 유닛 패널에 붙는 칩. 마우스를 올리거나 탭(포커스)하면 설명이 뜬다.
export function passiveChips(ids) {
  return realPassives(ids).map(({ data }) => {
    const el = h("span", { class: "chip passive", tabindex: "0", role: "button", "aria-label": `패시브 ${data.name}: ${data.desc ?? ""}` }, data.name);
    attachTip(el, () => passiveSheet(data));
    return el;
  });
}
export function passiveList(ids) {
  const list = realPassives(ids);
  if (!list.length) return h("p", { class: "muted" }, "없음");
  return h("ul", { class: "info-list" }, list.map(({ data }) => h("li", {}, h("strong", {}, data.name), data.desc ? ` — ${data.desc}` : "")));
}
export function panicInfo(type) {
  if (!type) return h("p", { class: "muted" }, "없음");
  const data = E.load_panic_data(type);
  if (!data) return h("p", { class: "muted" }, "정보 없음");
  const rows = [
    ...(data.low_morale_effects ?? []).map((e) => ["사기저하 (정신력 절반 이하)", e.desc]),
    ...(data.panic_effects ?? []).map((e) => ["패닉 (정신력 0)", e.desc]),
  ];
  return h("div", {}, h("strong", {}, data.name),
    rows.length ? h("ul", { class: "info-list" }, rows.map(([k, d]) => h("li", {}, `${k}: ${d ?? "설명 없음"}`))) : null);
}
