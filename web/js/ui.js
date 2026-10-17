// 화면 공통부 + 인카운터 엔진이 요구하는 UI 어댑터(rt.ui) 구현
import * as E from "./engine.js";
import { h, clear, sleep, prefersReducedMotion } from "./dom.js";
import { bar, setBar, cardEl, attachCardTip, cardSheet, attachTip } from "./components.js";
import { store } from "./storage.js";

export const ctx = { audio: null, settings: null, bundle: null };

// ==================================================
// 기본: 화면 장착 / 모달 / 알림
// ==================================================
const screenRoot = () => document.getElementById("screen");

export function mount(node, kind = "") {
  const root = screenRoot();
  clear(root);
  node.dataset.kind = kind;
  root.append(node);
  node.scrollTop = 0;
  return node;
}
const currentKind = () => screenRoot().firstChild?.dataset.kind ?? "";

export function toast(text, ms = 3600) {
  const box = document.getElementById("toasts");
  const el = h("div", { class: "toast", role: "status" }, text);
  box.append(el);
  while (box.children.length > 6) box.firstChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 450); }, ms);
}

// 모달: { close(value) } 와 닫힐 때 resolve 되는 promise 를 돌려줍니다.
export function modal(content, { wide = false, dismissible = true, cls = "" } = {}) {
  const host = document.getElementById("overlay");
  let done;
  const promise = new Promise((r) => { done = r; });
  const backdrop = h("div", { class: "backdrop" });
  const box = h("div", { class: `modal ${wide ? "wide" : ""} ${cls}`, role: "dialog", "aria-modal": "true" }, content);
  backdrop.append(box);
  const previous = document.activeElement;
  const close = (value) => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    previous?.focus?.();
    done(value);
  };
  const onKey = (e) => { if (e.key === "Escape" && dismissible) { e.stopPropagation(); close(undefined); } };
  document.addEventListener("keydown", onKey, true);
  if (dismissible) backdrop.addEventListener("pointerdown", (e) => { if (e.target === backdrop) close(undefined); });
  host.append(backdrop);
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  return { el: box, close, promise };
}

export function confirmModal(title, text, ok = "확인") {
  const m = modal(h("div", {},
    h("h2", {}, title), h("p", { class: "sub" }, text),
    h("div", { class: "modal-actions" },
      h("button", { class: "btn", onclick: () => m.close(false) }, "취소"),
      h("button", { class: "btn btn-primary", onclick: () => m.close(true) }, ok))));
  return m.promise.then((v) => !!v);
}

// ==================================================
// 설정
// ==================================================
export function openSettings() {
  const s = ctx.settings;
  const save = () => { store.saveSettings(s); ctx.audio.apply_settings(); };
  const slider = (label, key) => h("label", { class: "kv-row" },
    h("span", {}, label),
    h("input", { type: "range", min: 0, max: 1, step: 0.05, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); save(); } }));
  const m = modal(h("div", {},
    h("h2", {}, "설정"),
    h("div", { class: "list", style: { margin: "14px 0" } },
      h("label", { class: "list-item" }, h("span", {}, "소리 끄기"),
        h("input", { type: "checkbox", checked: s.muted, onchange: (e) => { s.muted = e.target.checked; save(); } })),
      h("div", { class: "list-item" }, slider("배경음 크기", "bgm_volume")),
      h("div", { class: "list-item" }, slider("효과음 크기", "sfx_volume"))),
    h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))));
  return m.promise;
}

// ==================================================
// 상태 창 (정보)
// ==================================================
export function openStatus() {
  const p = E.game.player_char;
  if (!p) return;
  const deck = Object.entries(p.deck).sort((a, b) => a[0].localeCompare(b[0]));
  const gadgets = Object.entries(p.gadgets);
  const m = modal(h("div", {},
    h("h2", {}, `${p.name} (LV.${p.level})`),
    h("dl", { class: "kv" },
      h("dt", {}, "HP"), h("dd", {}, `${p.hp} / ${p.max_hp}`),
      h("dt", {}, "정신력"), h("dd", {}, `${p.sanity} / ${p.max_sanity}`),
      h("dt", {}, "흐트러짐 저항"), h("dd", {}, `${p.current_stagger} / ${p.stagger_resist}`),
      h("dt", {}, "빛 / 슬롯"), h("dd", {}, `${p.max_cost} / ${p.card_slot}`),
      h("dt", {}, "경험치"), h("dd", {}, `${p.exp} / 10`),
      h("dt", {}, "총 카드 수"), h("dd", {}, `${deck.reduce((s, [, n]) => s + n, 0)}장`)),
    h("table", { class: "table" },
      h("tr", {}, h("th", {}, "속성"), h("th", {}, "피해"), h("th", {}, "흐트러짐")),
      ...["slash", "pierce", "blunt"].map((k) => h("tr", {}, h("td", {}, E.DICE_TYPE_MAP[k]), h("td", {}, `${p.endurance[k]}x`), h("td", {}, `${p.stagger_endurance[k]}x`)))),
    h("h3", {}, "가젯"),
    gadgets.length ? h("div", { class: "hud-gadgets" }, gadgets.map(([id, n]) => gadgetChip(id, n))) : h("p", { class: "muted" }, "없음"),
    h("h3", {}, "덱"),
    h("div", { class: "card-grid" }, deck.map(([id, n]) => {
      const c = cardEl(E.load_card(id));
      attachCardTip(c, () => E.load_card(id));
      return h("div", { class: "pick-row" }, c, h("span", { class: "muted" }, `x${n}`));
    })),
    h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))), { wide: true });
  return m.promise;
}

export function gadgetChip(id, n = 1) {
  const g = E.load_gadget_data(id);
  const sin = (g?.category ?? []).includes("죄악");
  return h("span", { class: `chip ${sin ? "sin" : ""}`, title: g?.desc ?? "" }, `${g?.name ?? id}${n > 1 ? ` ×${n}` : ""}`);
}

// ==================================================
// 선택지(노드) 화면
// ==================================================
let node_state = null;

function build_hud() {
  const p = E.game.player_char;
  const hp = bar("hp", p.hp, p.max_hp, "HP");
  const san = bar("san", p.sanity, p.max_sanity, "SAN");
  const name = h("span", { class: "hud-name" });
  const lv = h("span", { class: "hud-lv" });
  const gadgets = h("div", { class: "hud-gadgets" });
  const el = h("header", { class: "hudbar" },
    h("div", { class: "hud-id" }, name, lv),
    h("div", { class: "hud-bars" }, hp, san),
    gadgets,
    h("div", { class: "hud-actions" },
      h("button", { class: "btn btn-sm btn-ghost", onclick: openStatus }, "정보"),
      h("button", { class: "btn btn-sm btn-ghost", onclick: openSettings }, "설정")));
  return { el, hp, san, name, lv, gadgets };
}

export function update_hud() {
  const p = E.game.player_char;
  if (!node_state || !node_state.hud || !p) return;
  const { hud } = node_state;
  hud.name.textContent = p.name;
  hud.lv.textContent = `LV.${p.level}`;
  setBar(hud.hp, p.hp, p.max_hp, "HP");
  setBar(hud.san, p.sanity, p.max_sanity, "SAN");
  clear(hud.gadgets).append(...Object.entries(p.gadgets).map(([id, n]) => gadgetChip(id, n)));
}

function ensure_node_screen() {
  if (node_state && currentKind() === "node" && node_state.root.isConnected) return node_state;
  const has_player = !!E.game.player_char;
  const hud = has_player ? build_hud() : null;
  const page = h("div", { class: "page" });
  const text = h("div", { class: "page-text" });
  const choices = h("div", { class: "choices", role: "group", "aria-label": "선택지" });
  page.append(text, choices);
  const root = h("div", { class: "screen node-screen" }, hud?.el, h("div", { class: "page-wrap" }, page));
  mount(root, "node");
  node_state = { root, hud, text, choices, shown_text: null };
  update_hud();
  return node_state;
}

function render_text(st, text) {
  if (st.shown_text === text) return;
  st.shown_text = text;
  clear(st.text);
  clear(st.choices);
  const lines = String(text).split("\n").filter((l) => l.length);
  lines.forEach((line, i) => {
    const p = h("p", {}, line);
    if (!prefersReducedMotion()) { p.classList.add("rev"); p.style.animationDelay = `${i * 140}ms`; }
    st.text.append(p);
  });
  st.root.scrollTop = 0;
}

function show_text(text) {
  const st = ensure_node_screen();
  render_text(st, text);
}

function show_node({ text, choices }) {
  const st = ensure_node_screen();
  render_text(st, text);
  update_hud();
  return new Promise((resolve) => {
    clear(st.choices);
    let finished = false;
    const finish = (i) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKey);
      st.choices.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      resolve(i);
    };
    choices.forEach((c, i) => {
      const locked = !c.met;
      const b = h("button", {
        class: `choice ${locked ? "locked" : ""}`,
        "aria-disabled": locked ? "true" : null,
        onclick: () => { if (!locked) finish(i); },
      },
        h("span", { class: "choice-key" }, i < 9 ? String(i + 1) : ""),
        h("span", { class: "choice-text" }, c.text),
        c.chance != null ? h("span", { class: "choice-chance", title: "성공 확률" }, `${c.chance}%`) : h("span"),
        locked ? h("span", { class: "choice-hint" }, "조건 미충족") : null);
      st.choices.append(b);
    });
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.getElementById("overlay").children.length) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length && choices[n - 1].met) finish(n - 1);
    };
    document.addEventListener("keydown", onKey);
    st.choices.querySelector("button:not(.locked)")?.focus({ preventScroll: true });
  });
}

async function show_roll({ chance, roll, success }) {
  const num = h("div", { class: "roll-num" }, "--");
  const result = h("div", { class: "roll-result", hidden: true }, success ? "성공" : "실패");
  result.classList.add(success ? "ok" : "fail");
  const btn = h("button", { class: "btn btn-primary", hidden: true, onclick: () => m.close() }, "계속");
  const m = modal(h("div", { class: "roll-card" },
    h("p", { class: "roll-meta" }, `성공률 ${chance}%`),
    num, result, h("div", { class: "modal-actions", style: { justifyContent: "center" } }, btn)), { dismissible: false });
  if (!prefersReducedMotion()) {
    const t0 = performance.now();
    while (performance.now() - t0 < 750) { num.textContent = String(E.randint(1, 100)); await sleep(55); }
  }
  num.textContent = String(roll);
  result.hidden = false; btn.hidden = false; btn.focus();
  E.sfx(success ? "block" : "evade");
  await m.promise;
}

// ==================================================
// 선택 창들
// ==================================================
function pick_card({ title, items }) {
  if (!items.length) { toast("보유 중인 카드가 없거나 조건에 맞는 카드가 없습니다."); return Promise.resolve(null); }
  const m = modal(h("div", {},
    h("h2", {}, title),
    h("div", { class: "pick-list", style: { marginTop: "16px" } }, items.map((it) => {
      const c = cardEl(E.load_card(it.id));
      c.addEventListener("click", () => m.close(it.id));
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); m.close(it.id); } });
      attachCardTip(c, () => E.load_card(it.id));
      return h("div", { class: "pick-row" }, c, h("span", { class: "muted" }, `x${it.count}`));
    })),
    h("div", { class: "modal-actions" }, h("button", { class: "btn", onclick: () => m.close(null) }, "취소"))), { wide: true });
  return m.promise.then((v) => v ?? null);
}

function pick_gadget({ title, items, step, total }) {
  const m = modal(h("div", {},
    h("h2", {}, title),
    h("p", { class: "sub" }, `${step}/${total}`),
    h("div", { class: "list" }, items.map((it) =>
      h("button", { class: "list-item", onclick: () => m.close(it.id) }, h("span", {}, it.name), h("span", { class: "muted" }, `소지 ${it.count}`)))),
    h("div", { class: "modal-actions" }, h("button", { class: "btn", onclick: () => m.close(null) }, "취소"))));
  return m.promise.then((v) => v ?? null);
}

function level_up(info) {
  const m = modal(h("div", { class: "levelup" },
    h("h2", {}, `레벨 업! (LV.${info.level})`),
    h("p", { class: "levelup-stats" }, `최대 체력 ${info.max_hp} (+${info.hp_inc}) · 최대 정신력 ${info.max_sanity} (+${info.san_inc}) · 모든 수치가 회복되었습니다.`),
    info.options.length ? h("p", { class: "sub" }, "새로운 기술을 터득할 기회입니다. 하나를 선택하세요.") : null,
    h("div", { class: "pick-list" }, info.options.map((o, i) => {
      const c = cardEl(E.load_card(o.id));
      c.addEventListener("click", () => m.close(i));
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); m.close(i); } });
      attachCardTip(c, () => E.load_card(o.id));
      return c;
    })),
    info.options.length ? null : h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close(0) }, "계속"))),
    { wide: true, dismissible: false });
  E.sfx("roll");
  return m.promise.then((v) => v ?? 0);
}

// ==================================================
// 엔딩
// ==================================================
const ENDING_LABEL = { death_hp: "육체적 사망", missing_main: "이야기가 끊겼습니다" };

function show_ending({ name: raw_name, dead }) {
  const name = ENDING_LABEL[raw_name] ?? raw_name;
  const p = E.game.player_char;
  if (dead) ctx.audio.bgm("death_theme.mp3", { fade_ms: 1000 });
  else ctx.audio.stop_bgm(1000);
  return new Promise((resolve) => {
    const will = h("textarea", { maxlength: 200, placeholder: "공동묘지에 남길 마지막 한 마디", "aria-label": "유언" });
    const done = h("button", { class: "btn btn-primary", onclick: () => { ctx.audio.stop_bgm(800); resolve(will.value.trim()); } }, dead ? "묘비 세우기" : "서재에 기록 보관");
    const el = h("div", { class: "screen ending" },
      h("h1", {}, dead ? "당신은 도시의 차가운 바닥에서 숨을 거두었습니다…" : (name || "게임 종료")),
      dead && name ? h("p", { class: "muted" }, `엔딩: ${name}`) : null,
      p ? h("p", { class: "muted" }, `${p.name} · LV.${p.level} · HP ${p.hp}/${p.max_hp} · 정신력 ${p.sanity}/${p.max_sanity}`) : null,
      dead ? will : null,
      h("div", { class: "modal-actions", style: { justifyContent: "center" } }, done));
    mount(el, "ending");
    (dead ? will : done).focus();
  });
}

// ==================================================
// 엔진이 사용하는 어댑터
// ==================================================
export function create_ui(battle_runner) {
  return {
    showText: show_text,
    node: show_node,
    notes(lines) {
      lines.forEach((l, i) => setTimeout(() => toast(l), i * 90));
      update_hud();
    },
    roll: show_roll,
    pickCard: pick_card,
    pickGadget: pick_gadget,
    levelUp: level_up,
    battle: (battle) => { node_state = null; return battle_runner(battle); },
    ending: (info) => { node_state = null; return show_ending(info); },
  };
}

export function reset_node_state() { node_state = null; }
