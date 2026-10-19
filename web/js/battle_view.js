// 전투 화면
//  - 카드 위에 마우스를 올리면(키보드 포커스/터치 길게 누름 포함) 상세 정보가 뜬다.
//  - 카드를 끌어 내 슬롯에 놓으면 장착, 적 슬롯을 지정하면 대상이 정해진다.
//  - 끌기가 어려운 환경을 위해 "카드 클릭 → 슬롯 클릭"으로도 같은 일을 할 수 있다.
import * as E from "./engine.js";
import { h, svg, clear, sleep, prefersReducedMotion } from "./dom.js";
import { bar, setBar, cardEl, cardSheet, showTip, hideTip, attachCardTip, diceIcon, statusChips, passiveChips, passiveList, panicInfo } from "./components.js";
import { describe_card } from "./cardinfo.js";
import { ctx, mount, modal, toast, openSettings } from "./ui.js";
import { store } from "./storage.js";

const ANSI = /\u001b\[\d+m/g;

export function play_battle(battle) {
  return new Promise((resolve) => new BattleView(battle, resolve).start());
}

class BattleView {
  constructor(battle, resolve) {
    this.battle = battle;
    this.resolve = resolve;
    this.all_enemies = battle.enemies.slice();
    this.allies = battle.allies;
    this.active = battle.player;
    this.selected = null;       // 클릭으로 고른 손패 카드
    this.targeting = null;      // { unit, card, slot, from_equipped }
    this.busy = false;
    this.skip = false;
    this.els = new Map();       // uid -> 유닛 요소 묶음
    this.drag = null;
    this.cleanup = [];
  }

  // ---------- 시작 ----------
  async start() {
    this.build();
    const on_key = (e) => {
      if (e.key === "Escape" && this.targeting) { this.cancel_targeting(); }
      if (e.key === "Escape" && this.selected) { this.selected = null; this.refresh(); }
    };
    document.addEventListener("keydown", on_key);
    this.cleanup.push(() => document.removeEventListener("keydown", on_key));
    const on_resize = () => this.draw_links();
    window.addEventListener("resize", on_resize);
    this.cleanup.push(() => window.removeEventListener("resize", on_resize));

    this.add_log(`── 전투 시작 ──`, "turn");
    this.msgEl.textContent = this.battle.msg;
    await this.begin_turn();
  }

  async begin_turn() {
    this.battle.start_turn();
    this.add_log(`── ${this.battle.turn}턴 ──`, "turn");
    if (this.battle.turn > 1) this.msgEl.textContent = this.battle.msg;
    this.turnEl.textContent = `${this.battle.turn}턴`;
    await this.play(E.drain_events(), { quick: true });
    this.selected = null;
    this.targeting = null;
    if (!this.is_controllable(this.active) || this.active.hp <= 0) this.active = this.battle.player;
    this.busy = false;
    this.refresh();
  }

  is_controllable(u) { return u === this.battle.player || u.ai_type === "controllable"; }

  // ---------- 화면 구성 ----------
  build() {
    this.msgEl = h("div", { class: "battle-msg", "aria-live": "polite" });
    this.turnEl = h("span", { class: "turn-tag" });
    this.speedBtns = [["느리게", 1.7], ["보통", 1], ["빠르게", 0.4]].map(([label, v]) =>
      h("button", { class: "btn btn-sm", "aria-pressed": String(ctx.settings.battle_speed === v), onclick: () => this.set_speed(v) }, label));
    this.logBody = h("div", { class: "log-body", "aria-live": "off" });
    this.logEl = h("aside", { class: "log", "aria-label": "전투 기록" },
      h("div", { class: "log-head" }, h("strong", {}, "전투 기록"), h("div", { class: "speed-ctl" }, ...this.speedBtns)),
      this.logBody);
    this.enemySide = h("div", { class: "side enemy" });
    this.allySide = h("div", { class: "side ally" });
    this.linksSvg = svg("svg", { class: "links", "aria-hidden": "true" },
      svg("defs", {},
        svg("marker", { id: "arrow-e", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0 L10 5 L0 10 z", fill: "var(--scarlet-2)" })),
        svg("marker", { id: "arrow-a", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0 L10 5 L0 10 z", fill: "var(--brass)" }))),
      svg("g", { class: "link-layer" }));
    this.field = h("div", { class: "field", onclick: (e) => { if (e.target === this.field) this.cancel_targeting(); } },
      this.linksSvg, this.enemySide, this.allySide);
    this.fieldHint = h("div", { class: "targeting-hint", hidden: true });
    this.field.append(this.fieldHint);

    this.orbs = h("div", { class: "light", title: "빛(비용)" });
    this.lightText = h("span", { class: "light-text" });
    this.hint = h("div", { class: "dock-hint" });
    this.commandBtn = h("button", { class: "btn btn-sm btn-ghost", hidden: true, onclick: () => this.open_command_modal() }, "명령");
    this.playBtn = h("button", { class: "btn btn-sm", hidden: true, onclick: () => this.use_selected_on_play() }, "즉시 발동");
    this.endBtn = h("button", { class: "btn btn-primary", onclick: () => this.end_turn() }, "턴 종료");
    this.logToggle = h("button", { class: "btn btn-sm btn-ghost log-toggle", onclick: () => this.logEl.classList.toggle("open") }, "기록");
    this.playzone = h("div", { class: "playzone" }, "여기에 놓아 즉시 발동");
    this.hand = h("div", { class: "hand", role: "list", "aria-label": "손패" });
    this.dock = h("div", { class: "dock" },
      h("div", { class: "dock-bar" }, this.orbs, this.lightText, this.hint, this.playzone, this.commandBtn, this.playBtn, this.logToggle,
        h("button", { class: "btn btn-sm btn-ghost", onclick: openSettings }, "설정"), this.endBtn),
      this.hand);

    for (const e of this.all_enemies) this.enemySide.append(this.make_unit(e, "enemy"));
    for (const a of this.allies) this.allySide.append(this.make_unit(a, "ally"));

    this.root = h("div", { class: "screen battle" },
      h("div", { class: "battle-top" }, this.turnEl, this.msgEl, h("button", { class: "btn btn-sm btn-ghost", onclick: () => this.skip = true, title: "연출을 건너뜁니다" }, "건너뛰기")),
      this.field, this.dock, this.logEl);
    mount(this.root, "battle");
    new ResizeObserver(() => this.draw_links()).observe(this.field);
    this.field.addEventListener("scroll", () => this.draw_links());
  }

  set_speed(v) {
    ctx.settings.battle_speed = v;
    store.saveSettings(ctx.settings);
    this.speedBtns.forEach((b, i) => b.setAttribute("aria-pressed", String([1.7, 1, 0.4][i] === v)));
  }

  make_unit(u, side) {
    const tags = h("span", { class: "unit-tags" });
    const name = h("button", { class: "unit-name", title: "상세 정보", onclick: (e) => { e.stopPropagation(); this.unit_modal(u); } }, u.name);
    const hp = bar("hp", u.hp, u.max_hp, "HP");
    const san = bar("san", u.sanity, u.max_sanity, "SAN");
    const stg = bar("stg", u.current_stagger, u.stagger_resist, "흐트러짐");
    stg.title = "흐트러짐 저항";
    const status = h("div", { class: "unit-status" });
    const chips = passiveChips(u.passives);
    const passives = chips.length ? h("div", { class: "unit-passives", "aria-label": "패시브" }, ...chips) : null;
    const slots = h("div", { class: "slots" });
    const root = h("section", { class: `unit ${side}`, "aria-label": u.name, onclick: () => this.pick_active(u) },
      h("div", { class: "unit-head" }, name, tags), h("div", { class: "unit-bars" }, hp, san, stg), passives, status, slots);
    const slotEls = [];
    for (let i = 0; i < u.card_slot; i++) {
      const slot = h("div", { class: `slot ${side === "ally" ? "mine" : "enemy"}`, dataset: { uid: u.uid, slot: i }, tabindex: "0", role: "button" });
      slot.addEventListener("click", (e) => { e.stopPropagation(); this.slot_click(u, i); });
      slot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); this.slot_click(u, i); } });
      slot.addEventListener("mouseenter", () => { const c = u.equipped[i]; if (c) showTip(cardSheet(c), slot); });
      slot.addEventListener("mouseleave", hideTip);
      slotEls.push(slot);
      slots.append(slot);
    }
    const els = { root, name, tags, hp, san, stg, status, slotEls, unit: u, side };
    this.els.set(u.uid, els);
    return root;
  }

  pick_active(u) {
    if (this.busy || u === this.active) return;
    if (this.targeting) return;
    if (!this.allies.includes(u)) return;
    if (!this.is_controllable(u)) { toast(`${u.name}은(는) 직접 조종할 수 없습니다.`); return; }
    if (u.hp <= 0 || u.is_staggered || E.unit_cannot_equip(u)) { toast(`${u.name}은(는) 지금 명령을 내릴 수 없는 상태입니다.`); return; }
    this.active = u;
    this.selected = null;
    this.refresh();
  }

  // ---------- 그리기 ----------
  view_of(u) {
    return {
      uid: u.uid, hp: u.hp, max_hp: u.max_hp, sanity: u.sanity, max_sanity: u.max_sanity,
      stagger: u.current_stagger, stagger_resist: u.stagger_resist, staggered: u.is_staggered,
      panic: u.is_panicked, low: u.is_low_morale, cost: u.current_cost, statuses: u.statuses,
    };
  }

  update_unit(els, v) {
    const u = els.unit;
    setBar(els.hp, v.hp, v.max_hp, "HP");
    setBar(els.san, v.sanity, v.max_sanity, "SAN");
    setBar(els.stg, v.staggered ? 0 : v.stagger, v.stagger_resist, "흐트러짐");
    els.root.classList.toggle("dead", v.hp <= 0);
    els.root.classList.toggle("active", u === this.active && els.side === "ally");
    clear(els.tags);
    if (v.hp <= 0) els.tags.append(h("span", { class: "tag warn" }, "전투 불능"));
    else {
      if (v.staggered) els.tags.append(h("span", { class: "tag stag" }, "흐트러짐!"));
      if (v.panic) els.tags.append(h("span", { class: "tag warn" }, "패닉"));
      else if (v.low) els.tags.append(h("span", { class: "tag warn" }, "사기저하"));
    }
    clear(els.status).append(...statusChips(v.statuses));
  }

  render_slots(els) {
    const u = els.unit;
    els.slotEls.forEach((slot, i) => {
      const card = u.equipped[i];
      const speed = u.slot_speeds[i] ?? 0;
      clear(slot);
      slot.classList.toggle("filled", !!card);
      slot.classList.remove("hot", "targetable");
      slot.append(h("span", { class: "speed", title: "속도" }, String(speed)));
      if (card) {
        const d = describe_card(card);
        slot.append(
          h("div", { class: "slot-name" }, card.name),
          h("div", { class: "slot-dice" }, d.dice.map((x) => h("span", { class: `die dt-${x.damage_type.replace("counter_", "")}` }, diceIcon(x.damage_type), x.min === x.max ? `${x.min}` : `${x.min}~${x.max}`))));
        if (els.side === "ally" && this.battle.phase === "plan" && u === this.active) {
          slot.append(h("button", { class: "slot-x", title: "장착 해제", "aria-label": "장착 해제", onclick: (e) => { e.stopPropagation(); this.unequip(u, i); } }, "✕"));
        }
      } else if (els.side === "ally") {
        const cannot = E.unit_cannot_equip(u);
        slot.append(h("div", { class: "slot-empty" }, cannot ? "장착 불가" : (u === this.active ? "카드를 놓으세요" : "비어 있음")));
      } else {
        slot.append(h("div", { class: "slot-empty" }, u.hp > 0 ? "대기" : ""));
      }
      slot.setAttribute("aria-label", `${u.name} 슬롯 ${i + 1}, 속도 ${speed}${card ? `, ${card.name}` : ", 비어 있음"}`);
    });
  }

  render_hand() {
    const u = this.active;
    clear(this.hand);
    const can = this.battle.can_act(u) && !this.busy;
    if (!u.hand.length) this.hand.append(h("div", { class: "empty" }, "손패가 없습니다."));
    for (const card of u.hand) {
      const el = cardEl(card, { extra: [this.selected === card ? "sel" : "", card.cost > u.current_cost && !this.equipped_cost_ok(u, card) ? "nolight" : "", can ? "" : "dim"].join(" ") });
      el.setAttribute("role", "listitem");
      attachCardTip(el, () => card);
      el.addEventListener("pointerdown", (e) => this.card_pointerdown(e, el, card));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggle_select(card); } });
      this.hand.append(el);
    }
  }

  equipped_cost_ok(u, card) { return u.equipped.some((c) => c && card.cost <= u.current_cost + c.cost); }

  render_dock() {
    const u = this.active;
    clear(this.orbs);
    for (let i = 0; i < u.max_cost; i++) this.orbs.append(h("span", { class: `orb ${i < u.current_cost ? "on" : ""}` }));
    this.lightText.textContent = `빛 ${u.current_cost}/${u.max_cost}`;
    const sel = this.selected;
    this.playBtn.hidden = !(sel && sel.type === "on_play");
    this.endBtn.disabled = this.busy;

    const commandableAllies = this.allies.filter((al) => al !== this.battle.player && this.is_controllable(al));
    const canCommand = commandableAllies.length > 0 && this.battle.phase === "plan" && !this.busy;
    this.commandBtn.hidden = !canCommand;
    if (canCommand) {
      if (this.active !== this.battle.player) {
        this.commandBtn.classList.add("btn-primary");
        this.commandBtn.classList.remove("btn-ghost");
        this.commandBtn.textContent = `명령 (${this.active.name})`;
        this.commandBtn.title = "현재 조작 중인 아군입니다. 클릭하여 다른 아군 또는 나에게 조작권을 넘깁니다.";
      } else {
        this.commandBtn.classList.remove("btn-primary");
        this.commandBtn.classList.add("btn-ghost");
        this.commandBtn.textContent = "명령";
        this.commandBtn.title = "명령이 가능한 아군에게 조작 주도권을 넘깁니다.";
      }
    }

    let text = "카드를 끌어 슬롯에 놓거나, 카드를 클릭한 뒤 슬롯을 클릭하세요.";
    if (u.hp <= 0) text = "전투 불능 상태입니다.";
    else if (u.is_staggered) text = "흐트러진 상태라 이번 턴에는 행동할 수 없습니다.";
    else if (this.targeting) text = "공격할 적의 슬롯을 클릭하세요. (Esc: 취소)";
    else if (sel) text = sel.type === "on_play" ? "즉시 발동 카드입니다. 버튼이나 발동 영역을 사용하세요." : `[${sel.name}]을(를) 놓을 슬롯을 클릭하세요.`;
    this.hint.textContent = this.busy ? "" : text;
  }

  open_command_modal() {
    if (this.busy || this.battle.phase !== "plan") return;
    const controllables = this.allies.filter((al) => this.is_controllable(al));
    if (controllables.length <= 1) return;

    if (controllables.length === 2) {
      const nextUnit = controllables.find((al) => al !== this.active) || controllables[0];
      this.pick_active(nextUnit);
      toast(`[조작 전환] ${nextUnit.name}에게 명령합니다.`);
      return;
    }

    const m = modal(h("div", {},
      h("h2", {}, "명령 — 조작 주도권 선택"),
      h("p", { class: "muted" }, "조작 주도권을 넘길 아군을 선택하세요:"),
      h("div", { class: "btn-col", style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
        controllables.map((al) => {
          const isCur = al === this.active;
          const disabled = al.hp <= 0 || al.is_staggered || E.unit_cannot_equip(al);
          let stateText = "";
          if (al.hp <= 0) stateText = " (전투 불능)";
          else if (al.is_staggered) stateText = " (흐트러짐)";
          else if (E.unit_cannot_equip(al)) stateText = " (패닉)";

          return h("button", {
            class: `btn ${isCur ? "btn-primary" : ""}`,
            disabled,
            onclick: () => {
              m.close();
              this.pick_active(al);
            },
          }, `${al.name}${stateText}${isCur ? " [현재 조작 중]" : ""}`);
        })
      ),
      h("div", { class: "modal-actions", style: { marginTop: "16px" } },
        h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "취소")
      )
    ));
  }

  refresh() {
    for (const els of this.els.values()) {
      this.update_unit(els, this.view_of(els.unit));
      this.render_slots(els);
    }
    this.render_hand();
    this.render_dock();
    this.mark_targets();
    requestAnimationFrame(() => this.draw_links());
  }

  mark_targets() {
    const on = !!this.targeting;
    this.field.classList.toggle("targeting", on);
    this.fieldHint.hidden = !on;
    if (on) this.fieldHint.textContent = "공격할 적의 슬롯을 선택하세요 (Esc: 취소)";
    for (const e of this.all_enemies) {
      const els = this.els.get(e.uid);
      els.slotEls.forEach((s) => s.classList.toggle("targetable", on && e.hp > 0));
    }
  }

  // ---------- 연결선 ----------
  draw_links() {
    if (!this.field?.isConnected) return;
    const layer = this.linksSvg.querySelector(".link-layer");
    clear(layer);
    const fr = this.field.getBoundingClientRect();
    this.linksSvg.setAttribute("width", this.field.scrollWidth);
    this.linksSvg.setAttribute("height", this.field.scrollHeight);
    const center = (u, i) => {
      const slot = this.els.get(u.uid)?.slotEls[i];
      if (!slot) return null;
      const r = slot.getBoundingClientRect();
      return { x: r.left - fr.left + this.field.scrollLeft + r.width / 2, y: r.top - fr.top + this.field.scrollTop + r.height / 2, up: r.top };
    };
    const drawn = new Set();
    const units = [...this.allies, ...this.all_enemies];
    for (const u of units) {
      u.targets.forEach((t, i) => {
        if (!t || !u.equipped[i] || u.hp <= 0) return;
        const [tu, ts] = t;
        const a = center(u, i), b = center(tu, ts);
        if (!a || !b) return;
        const mutual = tu.targets[ts] && tu.targets[ts][0] === u && tu.targets[ts][1] === i && tu.equipped[ts];
        const key = mutual ? [`${u.uid}:${i}`, `${tu.uid}:${ts}`].sort().join("|") : `${u.uid}:${i}>${tu.uid}:${ts}`;
        if (drawn.has(key)) return;
        drawn.add(key);
        const kind = mutual ? "clash" : (this.allies.includes(u) ? "a" : "e");
        const dx = Math.abs(b.x - a.x) * 0.25, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = `M ${a.x} ${a.y} Q ${mid.x + (a.y < b.y ? dx : -dx)} ${mid.y} ${b.x} ${b.y}`;
        const path = svg("path", { d, class: `link ${kind}` });
        if (kind !== "clash") path.setAttribute("marker-end", `url(#arrow-${kind})`);
        layer.append(path);
        if (mutual) layer.append(svg("text", { x: mid.x, y: mid.y, class: "link-label", "text-anchor": "middle", "dominant-baseline": "middle" }, "합"));
      });
    }
  }

  // ---------- 장착 흐름 ----------
  toggle_select(card) {
    if (!this.guard_can_act()) return;
    this.selected = this.selected === card ? null : card;
    this.refresh();
  }

  guard_can_act() {
    if (this.busy) return false;
    if (!this.battle.can_act(this.active)) {
      toast(this.active.is_staggered ? "이 유닛은 흐트러진 상태입니다." : "전투 불능 상태입니다.");
      return false;
    }
    return true;
  }

  alive_enemy_slots() {
    const out = [];
    for (const e of this.battle.enemies) if (e.hp > 0) for (let i = 0; i < e.card_slot; i++) out.push([e, i]);
    return out;
  }

  place(unit, card, slot) {
    if (!this.guard_can_act()) return;
    if (card.type === "on_play") { toast("즉시 발동 카드는 슬롯에 놓을 수 없습니다. 발동 버튼을 사용하세요."); return; }
    const cands = this.alive_enemy_slots();
    if (cands.length === 1) { this.do_equip(unit, card, slot, cands[0][0], cands[0][1]); return; }
    if (!cands.length) return;
    this.targeting = { unit, card, slot, from_equipped: false };
    this.selected = null;
    this.refresh();
  }

  slot_click(u, i) {
    if (this.busy) return;
    const els = this.els.get(u.uid);
    if (els.side === "enemy") {
      if (this.targeting) {
        if (u.hp <= 0) return;
        const t = this.targeting;
        this.targeting = null;
        if (t.from_equipped) this.battle.unequip(t.unit, t.slot);
        this.do_equip(t.unit, t.card, t.slot, u, i);
        return;
      }
      if (this.selected) {
        // 카드 선택 → 적 슬롯 클릭: 첫 빈 슬롯에 장착
        const me = this.active;
        const free = me.equipped.findIndex((c) => !c);
        if (free < 0) { toast("빈 슬롯이 없습니다. 놓을 내 슬롯을 먼저 선택하세요."); return; }
        const card = this.selected;
        this.selected = null;
        this.do_equip(me, card, free, u, i);
      }
      return;
    }
    // 내 슬롯
    if (u !== this.active) { this.pick_active(u); return; }
    if (this.targeting) { this.cancel_targeting(); return; }
    if (this.selected) { const card = this.selected; this.selected = null; this.place(u, card, i); return; }
    if (u.equipped[i]) {
      // 장착된 카드 대상 다시 지정
      if (!this.guard_can_act()) return;
      this.targeting = { unit: u, card: u.equipped[i], slot: i, from_equipped: true };
      this.refresh();
    }
  }

  cancel_targeting() {
    if (!this.targeting) return;
    this.targeting = null;
    this.refresh();
  }

  do_equip(unit, card, slot, target_unit, target_slot) {
    const idx = unit.hand.indexOf(card);
    const res = this.battle.equip(unit, idx, slot, target_unit, target_slot);
    this.flush_events();
    if (!res.ok) { toast(res.error ?? "장착할 수 없습니다."); }
    else (res.notes ?? []).forEach((n) => toast(n));
    ctx.audio.sfx("draw_atk.wav");
    this.refresh();
  }

  unequip(unit, slot) {
    if (!this.guard_can_act()) return;
    this.battle.unequip(unit, slot);
    this.refresh();
  }

  use_selected_on_play() {
    const card = this.selected;
    if (card) this.use_on_play(card);
  }

  use_on_play(card) {
    if (!this.guard_can_act()) return;
    const idx = this.active.hand.indexOf(card);
    const res = this.battle.play_on_play(this.active, idx);
    this.selected = null;
    if (!res.ok) toast(res.error ?? "사용할 수 없습니다.");
    this.flush_events();
    this.refresh();
  }

  // 계획 단계에서 엔진이 쌓은 로그를 즉시 기록에 반영
  flush_events() {
    for (const ev of E.drain_events()) {
      if (ev.type === "log") this.add_log(ev.text, ev.cls);
      else if (ev.type === "sfx") ctx.audio.sfx(ev.name, ev.delay);
      else if (ev.type === "pause") this.apply_snap(ev.snap);
      else if (ev.type === "unit_summoned") {
        const u = ev.unit;
        if (!this.els.has(u.uid)) {
          if (ev.side === "ally") {
            if (!this.allies.includes(u)) this.allies.push(u);
            this.allySide.append(this.make_unit(u, "ally"));
          } else {
            if (!this.all_enemies.includes(u)) this.all_enemies.push(u);
            this.enemySide.append(this.make_unit(u, "enemy"));
          }
        }
      }
    }
  }

  // ---------- 끌어서 놓기 ----------
  card_pointerdown(e, el, card) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (this.busy) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, ghost = null, hot = null;
    const kind_play = card.type === "on_play";

    const find_hot = (x, y) => {
      for (const t of document.elementsFromPoint(x, y)) {
        if (t.classList?.contains("playzone") && kind_play) return t;
        if (t.classList?.contains("slot")) return t;
      }
      return null;
    };
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) > 7) {
        if (!this.guard_can_act()) { end(); return; }
        dragging = true;
        hideTip();
        ghost = el.cloneNode(true);
        ghost.classList.add("drag-ghost");
        ghost.classList.remove("sel");
        document.body.append(ghost);
        el.classList.add("dim");
        if (kind_play) this.root.classList.add("dragging-play");
        this.selected = null;
      }
      if (dragging) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        const h2 = find_hot(ev.clientX, ev.clientY);
        if (h2 !== hot) { hot?.classList.remove("hot"); hot = h2; hot?.classList.add("hot"); }
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      ghost?.remove();
      el.classList.remove("dim");
      this.root.classList.remove("dragging-play");
      hot?.classList.remove("hot");
    };
    const up = (ev) => {
      const target = dragging ? find_hot(ev.clientX, ev.clientY) : null;
      const was_dragging = dragging;
      end();
      if (!was_dragging) { this.toggle_select(card); return; }
      if (!target) { this.refresh(); return; }
      if (target.classList.contains("playzone")) { this.use_on_play(card); return; }
      const u = this.els.get(Number(target.dataset.uid))?.unit;
      const slot = Number(target.dataset.slot);
      if (!u) return;
      if (this.allies.includes(u)) {
        if (u !== this.active) { toast("조종 중인 유닛의 슬롯에 놓아 주세요."); this.refresh(); return; }
        this.place(u, card, slot);
      } else {
        // 적 슬롯에 바로 놓기: 첫 빈 슬롯에 장착
        const free = this.active.equipped.findIndex((c) => !c);
        if (free < 0) { toast("빈 슬롯이 없습니다. 내 슬롯에 직접 놓아 주세요."); this.refresh(); return; }
        if (u.hp > 0) this.do_equip(this.active, card, free, u, slot);
      }
    };
    const cancel = () => { end(); this.refresh(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  // ---------- 턴 진행 / 재생 ----------
  async end_turn() {
    if (this.busy) return;
    this.busy = true;
    this.skip = false;
    this.targeting = null;
    this.selected = null;
    this.refresh();
    const outcome = this.battle.resolve();
    await this.play(E.drain_events());
    for (const els of this.els.values()) this.update_unit(els, this.view_of(els.unit));
    this.draw_links();
    if (outcome === "continue") { await this.begin_turn(); return; }
    await this.show_banner(outcome);
  }

  speed() { return this.skip ? 0 : ctx.settings.battle_speed; }

  async play(events, { quick = false } = {}) {
    let first = true;
    for (const ev of events) {
      const k = quick ? 0.25 : this.speed();
      if (ev.type === "log") {
        this.add_log(ev.text, ev.cls);
        if (k > 0 && !quick) await sleep(55 * k);
      } else if (ev.type === "fx") {
        const els = this.els.get(ev.uid);
        if (els && !prefersReducedMotion()) { els.root.classList.remove("hit"); void els.root.offsetWidth; els.root.classList.add("hit"); setTimeout(() => els.root.classList.remove("hit"), 400); }
      } else if (ev.type === "sfx") {
        ctx.audio.sfx(ev.name, ev.delay);
      } else if (ev.type === "pause") {
        this.apply_snap(ev.snap);
        if (k > 0 && !quick) await sleep(620 * k);
      } else if (ev.type === "unit_summoned") {
        const u = ev.unit;
        if (!this.els.has(u.uid)) {
          if (ev.side === "ally") {
            if (!this.allies.includes(u)) this.allies.push(u);
            this.allySide.append(this.make_unit(u, "ally"));
          } else {
            if (!this.all_enemies.includes(u)) this.all_enemies.push(u);
            this.enemySide.append(this.make_unit(u, "enemy"));
          }
          this.refresh();
        }
      }
      first = false;
    }
  }

  apply_snap(snap) {
    for (const v of snap) {
      const els = this.els.get(v.uid);
      if (els) this.update_unit(els, v);
    }
    const mine = snap.find((v) => v.uid === this.active.uid);
    if (mine) {
      clear(this.orbs);
      for (let i = 0; i < this.active.max_cost; i++) this.orbs.append(h("span", { class: `orb ${i < mine.cost ? "on" : ""}` }));
      this.lightText.textContent = `빛 ${mine.cost}/${this.active.max_cost}`;
    }
  }

  add_log(text, cls = "") {
    let c = cls;
    let t = String(text);
    if (t.includes("\u001b[91m")) c = `${c} shout`;
    t = t.replace(ANSI, "");
    const near_bottom = this.logBody.scrollHeight - this.logBody.scrollTop - this.logBody.clientHeight < 60;
    this.logBody.append(h("p", { class: `log-line ${c}` }, t));
    if (near_bottom) this.logBody.scrollTop = this.logBody.scrollHeight;
  }

  show_banner(outcome) {
    return new Promise((res) => {
      const win = outcome === "win";
      const btn = h("button", { class: "btn btn-primary", onclick: () => { this.teardown(); res(); this.resolve(outcome); } }, "계속");
      const banner = h("div", { class: `banner ${win ? "win" : "lose"}`, role: "alertdialog", "aria-label": win ? "전투 승리" : "전투 패배" },
        h("div", {}, h("h2", {}, win ? "전투 승리" : "사망"), h("p", { class: "muted" }, win ? "" : "플레이어 진영이 궤멸되었습니다…"), btn));
      this.root.append(banner);
      btn.focus();
    });
  }

  teardown() { for (const f of this.cleanup) f(); this.cleanup = []; hideTip(); }

  // ---------- 유닛 상세 ----------
  unit_modal(u) {
    const cards = [...u.hand.map((c) => [c, "패"]), ...u.equipped.filter(Boolean).map((c) => [c, "장착"])];
    const m = modal(h("div", {},
      h("h2", {}, `${u.name}${u.is_panicked ? " (패닉)" : u.is_low_morale ? " (사기저하)" : ""}`),
      h("dl", { class: "kv" },
        h("dt", {}, "HP"), h("dd", {}, `${u.hp}/${u.max_hp}`),
        h("dt", {}, "정신력"), h("dd", {}, `${u.sanity}/${u.max_sanity}`),
        h("dt", {}, "흐트러짐"), h("dd", {}, u.is_staggered ? "흐트러짐!" : `${u.current_stagger}/${u.stagger_resist}`),
        h("dt", {}, "속도"), h("dd", {}, `${u.speed.min}~${u.speed.max}`),
        h("dt", {}, "상태이상"), h("dd", {}, Object.keys(u.statuses).length ? statusChips(u.statuses) : "없음")),
      h("table", { class: "table" },
        h("tr", {}, h("th", {}, "속성"), h("th", {}, "피해"), h("th", {}, "흐트러짐")),
        ...["slash", "pierce", "blunt"].map((k) => h("tr", {}, h("td", {}, E.DICE_TYPE_MAP[k]), h("td", {}, `${u.endurance[k]}x`), h("td", {}, `${u.stagger_endurance[k]}x`)))),
      h("h3", {}, "패시브"),
      passiveList(u.passives),
      h("h3", {}, "패닉 유형"),
      panicInfo(u.panic_type),
      h("h3", {}, "패 / 장착 카드"),
      cards.length ? h("div", { class: "card-grid" }, cards.map(([c, tag]) => { const el = cardEl(c); attachCardTip(el, () => c); return h("div", { class: "pick-row" }, el, h("span", { class: "muted" }, tag)); })) : h("p", { class: "muted" }, "확인 가능한 카드가 없습니다."),
      h("div", { class: "modal-actions" }, h("button", { class: "btn btn-primary", onclick: () => m.close() }, "닫기"))), { wide: true });
  }
}
