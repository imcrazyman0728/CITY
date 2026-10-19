// CITY 전투 엔진 (main.py의 전투 규칙을 화면과 무관하게 옮긴 모듈)
// - DOM/오디오를 직접 건드리지 않고, 결과를 game.events 로 쌓아둡니다.
// - 화면(ui.js)이 이 이벤트를 순서대로 재생합니다.

// ==================================================
// 난수 / 유틸
// ==================================================
const rnd = { fn: Math.random };
export function set_rng(fn) { rnd.fn = fn; }
export const randint = (a, b) => a + Math.floor(rnd.fn() * (b - a + 1));
export const rand_choice = (arr) => arr[Math.floor(rnd.fn() * arr.length)];
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd.fn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function sample(arr, k) {
  return shuffle(arr.slice()).slice(0, k);
}
export function weighted_pick_n(items, weights, n) {
  const pool = items.slice();
  const w = weights.slice();
  const picked = [];
  for (let k = 0; k < Math.min(n, pool.length); k++) {
    const total = w.reduce((a, b) => a + b, 0);
    let r = rnd.fn() * total;
    let idx = 0;
    for (; idx < w.length; idx++) {
      r -= w[idx];
      if (r < 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    picked.push(pool[idx]);
    pool.splice(idx, 1);
    w.splice(idx, 1);
  }
  return picked;
}

export const DICE_TYPE_MAP = {
  slash: "참격", pierce: "관통", blunt: "타격", block: "방어", evade: "회피",
  counter_slash: "반격-참격", counter_pierce: "반격-관통", counter_blunt: "반격-타격",
  counter_block: "반격-방어", counter_evade: "반격-회피",
};
export const CARD_TYPE_MAP = { melee: "근거리", ranged: "원거리", on_play: "즉시 발동" };
export const CARD_GRADE_MAP = { paperback: "보급", hardcover: "고급", limited: "한정", "objet_d'art": "예술" };

// ==================================================
// 게임 상태 / 데이터 접근
// ==================================================
export const game = {
  data: null,
  profile: { death_count: 0, achievements: [], flags: {} },
  common_deck: [],
  story_name: null,
  main_encounters: {},
  common_encounters: [],
  special_encounters: {},
  scheduled: [],
  ended: false,
  ending_name: null,
  player_char: null,
  field_theme: null,
  allies: [],
  enemies: [],
  basic_battle_theme: null,
  fallen_enemy_count: 0,
  events: [],
  in_battle: false,
  cur_units: [],
  hooks: {
    bgm() {}, stop_bgm() {}, sfx() {}, save_profile() {}, save_grave() {}, save_clear() {},
  },
};

export let base_data = null;

export function set_data(bundle) {
  base_data = bundle;
  rebuild_active_data();
}

export function rebuild_active_data() {
  if (!base_data) return;
  game.data = {
    ...base_data,
    cards: { ...(base_data.cards ?? {}) },
    enemies: { ...(base_data.enemies ?? {}) },
    allies: { ...(base_data.allies ?? {}) },
    passives: { ...(base_data.passives ?? {}) },
    status: { ...(base_data.status ?? {}) },
    panics: { ...(base_data.panics ?? {}) },
    gadgets: { ...(base_data.gadgets ?? {}) },
    players: { ...(base_data.players ?? {}) },
    common: [...(base_data.common ?? [])],
    special: { ...(base_data.special ?? {}) },
    stories: { ...(base_data.stories ?? {}) },
    schedule: { ...(base_data.schedule ?? {}) },
    expansion_packs: { ...(base_data.expansion_packs ?? {}) },
  };

  const enabled = game.profile?.enabled_packs ?? [];
  const packs = base_data.expansion_packs ?? {};

  for (const pack_id of enabled) {
    const pack = packs[pack_id];
    if (!pack || !pack.data) continue;
    const d = pack.data;
    if (d.cards) Object.assign(game.data.cards, d.cards);
    if (d.enemies) Object.assign(game.data.enemies, d.enemies);
    if (d.allies) Object.assign(game.data.allies, d.allies);
    if (d.passives) Object.assign(game.data.passives, d.passives);
    if (d.status) Object.assign(game.data.status, d.status);
    if (d.panics) Object.assign(game.data.panics, d.panics);
    if (d.gadgets) Object.assign(game.data.gadgets, d.gadgets);
    if (d.players) Object.assign(game.data.players, d.players);
    if (d.common && Array.isArray(d.common)) {
      for (const enc of d.common) {
        if (!game.data.common.some((c) => c.id === enc.id)) {
          game.data.common.push(enc);
        }
      }
    }
    if (d.special) {
      for (const [k, v] of Object.entries(d.special)) {
        game.data.special[k] = (game.data.special[k] ?? []).concat(v);
      }
    }
    if (d.stories) Object.assign(game.data.stories, d.stories);
    if (d.schedule) Object.assign(game.data.schedule, d.schedule);
  }
}

const status_data = (id) => game.data.status[id] ?? null;
const passive_data = (id) => game.data.passives[id] ?? null;
const panic_data = (id) => game.data.panics[id] ?? null;
export const gadget_data = (id) => game.data.gadgets[id] ?? null;
export const load_status_data = status_data;
export const load_passive_data = passive_data;
export const load_panic_data = panic_data;
export const load_gadget_data = gadget_data;

export function load_enemy(id) {
  const d = game.data.enemies[id];
  if (!d) throw new Error(`적 없음 : ${id}`);
  return d;
}
export function load_ally_data(id) {
  return game.data.allies[id] ?? game.data.enemies[id] ?? null;
}

// ==================================================
// 이벤트 출력
// ==================================================
export function say(text, cls = "") { game.events.push({ type: "log", text, cls }); }
export function fx(kind, unit) { if (game.in_battle) game.events.push({ type: "fx", kind, uid: unit.uid }); }
export function drain_events() { return game.events.splice(0, game.events.length); }

function normalize_sfx(name) {
  let clean = String(name).replace("counter_", "");
  if (!clean.endsWith(".wav")) clean += ".wav";
  return clean;
}
export function sfx(name, delay = 0) {
  if (!name) return;
  const clean = normalize_sfx(name);
  if (game.in_battle) game.events.push({ type: "sfx", name: clean, delay });
  else game.hooks.sfx(clean);
}

export function snapshot() {
  return game.cur_units.map((u) => ({
    uid: u.uid, hp: u.hp, max_hp: u.max_hp, sanity: u.sanity, max_sanity: u.max_sanity,
    stagger: u.current_stagger, stagger_resist: u.stagger_resist, staggered: u.is_staggered,
    panic: u.is_panicked, low: u.is_low_morale, cost: u.current_cost,
    statuses: JSON.parse(JSON.stringify(u.statuses)),
  }));
}
export function pause_mark() { game.events.push({ type: "pause", snap: snapshot() }); }

export function trigger_win_sfx(dice) {
  sfx("roll.wav");
  sfx(dice.sfx ? dice.sfx : (dice.damage_type ?? "slash"), 100);
}

// ==================================================
// 카드
// ==================================================
export class Card {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type ?? "melee";
    this.cost = data.cost;
    this.grade = data.grade ?? "paperback";
    this.dice = data.dice;
    this.on_use_dialogue = data.on_use_dialogue ?? "";
    this.flavor_text = data.flavor_text ?? data.flavor ?? "";
    this.on_use_effect = data.on_use_effect ?? [];
    this.mode_change = data.mode_change ?? {};
  }
}


export function get_card_data_internal(card_id) { return game.data.cards[card_id] ?? null; }

export function load_card(card_id) {
  const data = get_card_data_internal(card_id);
  if (!data) {
    say(`경고: ${card_id} 카드 데이터가 유효하지 않습니다.`);
    return new Card({ id: card_id, name: "유효하지 않은 카드", cost: 0, dice: [] });
  }
  return new Card({ ...data, id: card_id }); // id는 항상 파일명 기준
}

export function build_deck_list(deck) {
  const result = [];
  for (const [card_id, amount] of Object.entries(deck)) {
    for (let i = 0; i < amount; i++) result.push(card_id);
  }
  return shuffle(result);
}

export function draw_cards(unit, amount) {
  for (let i = 0; i < amount; i++) {
    if (!unit.draw_pile.length) {
      if (!unit.discard_pile.length) return;
      unit.draw_pile = shuffle(unit.discard_pile.slice());
      unit.discard_pile = [];
    }
    const ref = unit.draw_pile.pop();
    unit.hand.push(ref instanceof Card ? ref : load_card(ref));
  }
}

export function play_card_dialogue(user, card) {
  if (!card.on_use_dialogue) return;
  say(card.on_use_dialogue.split("{card_user}").join(user.name), "dialogue");
}

// ==================================================
// 패닉 / 패시브 / 상태이상
// ==================================================
export function unit_cannot_equip(unit) {
  if (!unit) return false;
  if (unit.is_panicked && unit.active_panic_effects) {
    for (const effect of unit.active_panic_effects) {
      if (
        effect.trigger === "cannot_equip" ||
        effect.trigger === "cannot_equip_card" ||
        effect.action === "cannot_equip" ||
        (effect.trigger === "equip_card" && effect.action === "prevent")
      ) {
        return true;
      }
    }
  }
  return false;
}

export function apply_panic_effects(unit) {
  if (!unit || !unit.panic_type) return;
  const data = panic_data(unit.panic_type);
  if (!data) return;

  if (unit.sanity <= 0) {
    if (!unit.is_panicked) {
      unit.active_panic_effects = data.panic_effects ?? data.effects ?? [];
      unit.is_panicked = true;
      unit.is_low_morale = false;
      unit.panicked_turns_remaining = 1;
      say(`[패닉] ${unit.name}의 정신이 붕괴되어 패닉 상태에 빠졌습니다!`, "panic");
    }
  } else if (unit.sanity <= unit.max_sanity / 2) {
    if (!unit.is_low_morale) {
      unit.active_panic_effects = data.low_morale_effects ?? [];
      unit.is_low_morale = true;
      unit.is_panicked = false;
      say(`[사기저하] ${unit.name}의 사기가 꺾였습니다!`, "panic");
    }
  } else if (unit.is_panicked || unit.is_low_morale) {
    unit.active_panic_effects = [];
    unit.is_panicked = false;
    unit.is_low_morale = false;
  }
}

export function check_passive_condition(condition, context) {
  if (!condition) return true;
  for (const [key, target_val] of Object.entries(condition)) {
    if (target_val === "all") continue;
    const ctx_val = context[key];
    if (Array.isArray(target_val)) {
      if (!target_val.includes(ctx_val)) return false;
    } else if (ctx_val !== target_val) {
      return false;
    }
  }
  return true;
}

const is_unit = (x) => x && typeof x.apply_status === "function";

export function execute_passive_logic(effect, unit, value = null, target = null) {
  const action = effect.action;
  const val = effect.value ?? 0;
  const var_name = effect.variable;

  if (action === "damage_self") unit.take_damage(val, 0);
  else if (action === "add_value") return (value || 0) + val;
  else if (action === "recover_hp") unit.change_hp(val);
  else if (action === "recover_sanity") unit.change_sanity(val);
  else if (action === "set_var") unit.passive_vars[var_name] = val;
  else if (action === "inc_var") unit.passive_vars[var_name] = (unit.passive_vars[var_name] ?? 0) + val;
  else if (action === "add_var_value") return (value || 0) + (unit.passive_vars[var_name] ?? 0);
  else if (action === "apply_status") {
    const goal = is_unit(target) ? target : unit;
    goal.apply_status(effect.status_id, effect.amount ?? 0, effect.count ?? 0);
  }
  return value;
}

export function execute_status_modify_logic(effect, unit, s_id, state, value, context) {
  const action = effect.action;
  let val = effect.value ?? 0;
  if (typeof val === "string") {
    const n = Number(val);
    if (!Number.isNaN(n)) val = n;
  }
  if (action === "modify_roll" || action === "add_value") return (value || 0) + val;
  if (action === "multiply_amount") return Math.trunc((value || 0) * val);
  if (action === "add_amount") return (value || 0) + val;
  return value;
}

export function trigger_status_modify(unit, hook, value, context) {
  if (!unit || !unit.statuses) return value;
  let new_value = value;
  for (const [s_id, state] of Object.entries(unit.statuses)) {
    const data = status_data(s_id);
    if (!data || !data.effects) continue;
    for (const effect of data.effects) {
      if (effect.trigger === hook && check_passive_condition(effect.condition, context)) {
        new_value = execute_status_modify_logic(effect, unit, s_id, state, new_value, context);
      }
    }
  }
  return new_value;
}

export function execute_status_logic(effect, unit, s_id, state) {
  const action = effect.action;
  let val = effect.value ?? 0;
  if (val === "amount") val = state.amount;
  else if (val === "count") val = state.count;

  const data = status_data(s_id);
  const name = data ? data.name : s_id;

  if (action === "damage_self") {
    say(`${name} 피해 ${val}!`, "status");
    unit.take_damage(val, 0, false);
  } else if (action === "damage_sanity") {
    say(`${name} 효과로 정신력 피해 ${val}!`, "status");
    unit.change_sanity(-val);
  } else if (action === "inc_count") state.count += val;
  else if (action === "inc_amount") state.amount += val;
  else if (action === "recover_hp") {
    say(`${name} 효과로 체력 회복!`, "status");
    unit.change_hp(val);
  }
}

export function trigger_passive_action(unit, hook, context, target = null) {
  if (!unit) return;
  for (const p_id of unit.passives) {
    const data = passive_data(p_id);
    if (!data || !data.effects) continue;
    for (const effect of data.effects) {
      if (effect.trigger === hook && check_passive_condition(effect.condition, context)) {
        execute_passive_logic(effect, unit, null, target);
      }
    }
  }
  for (const effect of unit.active_panic_effects) {
    if (effect.trigger === hook && check_passive_condition(effect.condition, context)) {
      execute_passive_logic(effect, unit, null, target);
    }
  }
}

export function trigger_passive_modify(unit, hook, value, context, target = null) {
  if (!unit) return value;
  let new_value = value;
  for (const p_id of unit.passives) {
    const data = passive_data(p_id);
    if (!data || !data.effects) continue;
    for (const effect of data.effects) {
      if (effect.trigger === hook && check_passive_condition(effect.condition, context)) {
        new_value = execute_passive_logic(effect, unit, new_value, target);
      }
    }
  }
  for (const effect of unit.active_panic_effects) {
    if (effect.trigger === hook && check_passive_condition(effect.condition, context)) {
      new_value = execute_passive_logic(effect, unit, new_value, target);
    }
  }
  return new_value;
}

export function trigger_status_effect(unit, hook, context) {
  if (!unit) return;
  const to_remove = [];
  for (const [s_id, state] of Object.entries(unit.statuses)) {
    const data = status_data(s_id);
    if (!data || !data.effects) continue;
    for (const effect of data.effects) {
      if (effect.trigger === hook) execute_status_logic(effect, unit, s_id, state);
    }
    if (state.amount <= 0 || state.count <= 0) to_remove.push(s_id);
  }
  for (const s_id of to_remove) delete unit.statuses[s_id];
}

// ==================================================
// 유닛
// ==================================================
let uid_counter = 0;

export class Unit {
  constructor(data) {
    const s = data && data.status ? data.status : data;
    this.uid = ++uid_counter;
    this.faction = "player";
    this.name = s.name ?? "Unknown";
    this.max_hp = s.max_hp ?? s.hp ?? 0;
    this.hp = s.hp ?? this.max_hp;
    this.max_sanity = s.max_sanity ?? s.sanity ?? 0;
    this.sanity = s.sanity ?? this.max_sanity;
    this.stagger_resist = s.stagger_resist ?? 20;
    this.current_stagger = this.stagger_resist;
    this.is_staggered = false;
    this.staggered_turns_remaining = 0;

    const def = { slash: 1.0, pierce: 1.0, blunt: 1.0 };
    this.endurance = { ...def, ...(s.endurance ?? {}) };
    this.stagger_endurance = { ...def, ...(s.stagger_endurance ?? {}) };
    this.base_endurance = { ...this.endurance };
    this.base_stagger_endurance = { ...this.stagger_endurance };

    this.passives = (s.passives ?? []).slice();
    this.deck = { ...(s.deck ?? {}) };
    this.max_cost = s.max_cost ?? 3;
    this.current_cost = this.max_cost;
    this.card_slot = s.card_slot ?? 1;
    this.hand = [];
    this.equipped = [];
    this.speed = { ...(s.speed ?? { min: 1, max: 5 }) };
    this.slot_speeds = [];
    this.draw_pile = [];
    this.targets = [];
    this.discard_pile = [];
    this.saved_counter = [];
    this.saved_defense = [];
    this.passive_vars = {};
    this.statuses = {};
    this.level = s.level ?? 1;
    this.exp = s.exp ?? 0;
    this.card_pool = (s.card_pool ?? []).slice();
    this.dice_power_modifiers = {};
    this.gadgets = {};
    this.panic_type = s.panic_type ?? null;
    this.active_panic_effects = [];
    this.is_panicked = false;
    this.is_low_morale = false;
    this.panicked_turns_remaining = 0;
    this.card_dice_power_modifier = 0;
    this.ai_type = s.ai_type ?? s.type ?? data.ai_type ?? data.type ?? "random";
    this.pattern = (s.pattern ?? data.pattern ?? []).slice();
    this.pattern_index = 0;
  }

  change_hp(amount) {
    const old = this.hp;
    if (amount < 0) this.take_damage(Math.abs(amount), 0);
    else this.hp = Math.min(this.max_hp, this.hp + amount);
    return this.hp - old;
  }

  take_damage(hp_dmg, stagger_dmg, trigger_hit = true) {
    this.hp = Math.max(0, this.hp - hp_dmg);
    this.current_stagger = Math.max(0, this.current_stagger - stagger_dmg);
    if (hp_dmg > 0) {
      say(`${this.name}에게 ${hp_dmg} 피해!`, "dmg");
      fx("hit", this);
    }
    if (stagger_dmg > 0) say(`${this.name}에게 ${stagger_dmg} 흐트러짐 피해!`, "stagger");

    if (trigger_hit && (hp_dmg > 0 || stagger_dmg > 0)) trigger_status_effect(this, "on_hit_received", {});
    if (this.current_stagger <= 0 && !this.is_staggered) activate_stagger(this);
  }

  recover_stagger(amount) {
    this.current_stagger = Math.min(this.stagger_resist, this.current_stagger + amount);
    say(`${this.name} 흐트러짐 ${amount} 회복!`);
  }

  apply_status(s_id, amount, count) {
    const data = status_data(s_id);
    const name = data ? data.name : s_id;
    say(`${name} 위력 ${amount} 횟수 ${count} 부여!`, "status");
    if (this.statuses[s_id]) {
      this.statuses[s_id].amount += amount;
      this.statuses[s_id].count += count;
    } else {
      this.statuses[s_id] = { amount, count };
    }
  }

  change_sanity(amount) {
    const old = this.sanity;
    this.sanity = Math.max(0, Math.min(this.sanity + amount, this.max_sanity));
    if (this.sanity !== old) {
      say(`${this.name} 정신력 ${amount >= 0 ? "+" : ""}${amount}!`, "sanity");
      apply_panic_effects(this);
    }
    return this.sanity - old;
  }
}

export class PlayerChar extends Unit {
  constructor(data) {
    super(data);
    this.id = data.id ?? "player";
  }
  add_gadget(item, amount = 1) { this.gadgets[item] = (this.gadgets[item] ?? 0) + amount; }
  gadget_count(item) { return this.gadgets[item] ?? 0; }
  has_gadget(item) { return item in this.gadgets; }
  remove_gadget(item, amount = 1) {
    if (!(item in this.gadgets)) return;
    this.gadgets[item] -= amount;
    if (this.gadgets[item] <= 0) delete this.gadgets[item];
  }
}

export class Ally extends Unit {
  constructor(data, ai_type = null, pattern = null) {
    super(data);
    this.id = data.id ?? "ally";
    const s = data.status ?? {};
    this.ai_type = ai_type ?? s.ai_type ?? s.type ?? data.ai_type ?? data.type ?? "random";
    this.pattern = (pattern ?? s.pattern ?? data.pattern ?? []).slice();
    this.pattern_index = 0;
    this.faction = "player";
  }
}

export class Enemy extends Unit {
  constructor(data) {
    super(data);
    this.id = data.id ?? "enemy";
    const s = data.status ?? {};
    this.faction = "enemy";
    this.appear = s.appear ?? "";
    this.dialogue_lines = s.dialogue_lines ?? {};
    this.ai_type = s.ai_type ?? s.type ?? data.ai_type ?? data.type ?? "random";
    this.pattern = (s.pattern ?? data.pattern ?? []).slice();
    this.pattern_index = 0;
  }
}

export function init_summoned_unit(u) {
  u.passive_vars = {};
  u.statuses = {};
  u.active_panic_effects = [];
  u.panicked_turns_remaining = 0;
  u.draw_pile = build_deck_list(u.deck);
  u.hand = [];
  u.equipped = Array(u.card_slot).fill(null);
  u.slot_speeds = Array.from({ length: u.card_slot }, () => randint(u.speed.min, u.speed.max));
  u.targets = Array(u.card_slot).fill(null);
  u.discard_pile = [];
  u.current_cost = u.max_cost;
  draw_cards(u, 3);
  apply_panic_effects(u);
}

export function summon_unit(summon_type, param, caster = null) {
  // 1. 시전자 진영 판별 (플레이어 진영 여부)
  let caster_is_player_side = true;
  if (caster) {
    if (game.battle) {
      if (game.battle.enemies.includes(caster)) caster_is_player_side = false;
      else if (game.battle.allies.includes(caster)) caster_is_player_side = true;
      else caster_is_player_side = (caster.faction !== "enemy");
    } else {
      caster_is_player_side = (caster.faction !== "enemy");
    }
  }

  // 2. 소환 대상 진영 (시전자 기준)
  const target_is_player_side = (summon_type === "summon_ally")
    ? caster_is_player_side
    : !caster_is_player_side;

  // 3. 파라미터 파싱
  const unit_id = typeof param === "string" ? param : (param?.id ?? "");
  const default_ai = target_is_player_side ? "controllable" : "random";
  let ai_type = (typeof param === "object" && param.ai_type) ? param.ai_type : default_ai;
  const pattern = (typeof param === "object" && param.pattern) ? param.pattern : null;

  // 적 진영에 controllable 속성을 가진 유닛이 소환된다면 random 속성으로 변경
  if (!target_is_player_side && ai_type === "controllable") {
    ai_type = "random";
  }

  let new_unit;
  if (target_is_player_side) {
    let data = load_ally_data(unit_id);
    if (!data) {
      try { data = load_enemy(unit_id); } catch (e) {}
    }
    if (!data) {
      say(`[오류] 소환할 아군 데이터를 찾을 수 없습니다: ${unit_id}`);
      return null;
    }
    new_unit = new Ally(data, ai_type, pattern);
    new_unit.faction = "player";
  } else {
    let data;
    try {
      data = load_enemy(unit_id);
    } catch (e) {
      data = load_ally_data(unit_id);
    }
    if (!data) {
      say(`[오류] 소환할 적군 데이터를 찾을 수 없습니다: ${unit_id}`);
      return null;
    }
    new_unit = new Enemy(data);
    new_unit.ai_type = ai_type;
    new_unit.pattern = pattern ?? [];
    new_unit.pattern_index = 0;
    new_unit.faction = "enemy";
  }

  init_summoned_unit(new_unit);

  if (game.battle) {
    if (target_is_player_side) {
      game.battle.allies.push(new_unit);
    } else {
      game.battle.enemies.push(new_unit);
      game.enemies = game.battle.enemies;
    }
    game.cur_units = [...game.battle.allies, ...game.battle.enemies];
  } else {
    if (target_is_player_side) game.allies.push(new_unit);
    else game.enemies.push(new_unit);
  }

  const sideName = target_is_player_side ? "아군 진영" : "적 진영";
  say(`[소환] ${sideName}에 [${new_unit.name}]이(가) 나타났습니다!`, "mode");
  game.events.push({
    type: "unit_summoned",
    unit: new_unit,
    side: target_is_player_side ? "ally" : "enemy",
  });
  pause_mark();
  return new_unit;
}

// ==================================================
// 카드 사용 효과 / 주사위 효과
// ==================================================
export function apply_on_use_effects(unit, card, target = null) {
  if (!card || !card.on_use_effect) return;

  for (const effect of card.on_use_effect) {
    if (!effect) continue;

    if ("summon_ally" in effect) {
      const list = Array.isArray(effect.summon_ally) ? effect.summon_ally : [effect.summon_ally];
      for (const item of list) summon_unit("summon_ally", item, unit);
    }

    if ("summon_enemy" in effect) {
      const list = Array.isArray(effect.summon_enemy) ? effect.summon_enemy : [effect.summon_enemy];
      for (const item of list) summon_unit("summon_enemy", item, unit);
    }

    if ("draw_cards" in effect) {
      draw_cards(unit, effect.draw_cards);
      say(`[${unit.name}] 효과로 카드 ${effect.draw_cards}장 드로우!`);
    }

    if ("recover_cost" in effect) {
      const amount = effect.recover_cost;
      unit.current_cost = Math.min(unit.max_cost, unit.current_cost + amount);
      say(`[${unit.name}] 효과로 빛 ${amount} 회복! (현재: ${unit.current_cost}/${unit.max_cost})`);
    }

    if ("apply_status" in effect) {
      for (const [s_id, params] of Object.entries(effect.apply_status)) {
        unit.apply_status(s_id, params.amount ?? 0, params.count ?? 0);
      }
    }

    if ("remove_status" in effect) {
      const s_id = effect.remove_status;
      if (s_id in unit.statuses) {
        const s_data = status_data(s_id);
        delete unit.statuses[s_id];
        say(`[${unit.name}] ${s_data ? s_data.name : s_id} 효과 제거!`);
      }
    }

    if ("mode_change" in effect) {
      const mode_key = effect.mode_change;
      for (const container of [unit.hand, unit.equipped]) {
        for (let i = 0; i < container.length; i++) {
          if (container[i] && mode_key in container[i].mode_change) {
            container[i] = load_card(container[i].mode_change[mode_key]);
          }
        }
      }
      for (const pile of [unit.draw_pile, unit.discard_pile]) {
        for (let i = 0; i < pile.length; i++) {
          const c_data = get_card_data_internal(pile[i]);
          if (c_data && c_data.mode_change && mode_key in c_data.mode_change) {
            pile[i] = c_data.mode_change[mode_key];
          }
        }
      }
      say(`[${unit.name}] ${mode_key} 모드로 전환! 현재 전투에서 일부 카드가 변환되었습니다.`, "mode");
    }

    if ("modify_dice_power" in effect) {
      const params = effect.modify_dice_power;
      let p_kind = "all", p_val;
      if (params && typeof params === "object") {
        p_kind = params.kind ?? "all";
        p_val = params.value ?? 0;
      } else {
        p_val = params;
      }
      unit.dice_power_modifiers[p_kind] = (unit.dice_power_modifiers[p_kind] ?? 0) + p_val;
      const kind_name = p_kind !== "all" ? (DICE_TYPE_MAP[p_kind] ?? "모든") : "모든";
      say(`[${unit.name}] 효과로 이번 턴 동안 ${kind_name} 주사위 위력 ${p_val >= 0 ? "+" : ""}${p_val}!`);
    }

    if ("condition_modify_dice_power" in effect) {
      const params = effect.condition_modify_dice_power;
      const dest = params.target ?? "opponent";
      const p_val = params.value ?? 0;
      const goal = dest === "self" ? unit : target;

      if (goal) {
        let condition_met = true;
        const reasons = [];

        if ("is_staggered" in params) {
          const required = params.is_staggered;
          if (!!goal.is_staggered !== required) condition_met = false;
          else reasons.push(required ? "흐트러짐 상태" : "비흐트러짐 상태");
        }

        if (condition_met && "status_id" in params) {
          const s_id = params.status_id;
          const check_type = params.check ?? "amount";
          const threshold = params.threshold ?? 0;
          const current = goal.statuses[s_id] ? (goal.statuses[s_id][check_type] ?? 0) : 0;
          if (current < threshold) condition_met = false;
          else {
            const s_data = status_data(s_id);
            reasons.push(`${s_data ? s_data.name : s_id} ${check_type === "amount" ? "위력" : "횟수"} ${current}>=${threshold}`);
          }
        }

        if (condition_met) {
          unit.card_dice_power_modifier += p_val;
          const dest_name = dest === "self" ? "자신" : `[${goal.name}]`;
          say(`[${unit.name}] 조건 만족! (${dest_name} ${reasons.join(", ")}) -> 이 카드의 주사위 위력 ${p_val >= 0 ? "+" : ""}${p_val}!`);
        }
      }
    }
  }
}

export function apply_dice_effects(attacker, target, dice) {
  if (!target || !dice) return;
  for (const entry of dice.dice_effect ?? []) {
    if (!entry) continue;

    if ("apply_effects" in entry) {
      let apply_effs = entry.apply_effects;
      if (!Array.isArray(apply_effs)) apply_effs = [apply_effs];
      for (const status_obj of apply_effs) {
        if (status_obj && typeof status_obj === "object") {
          for (const [s_id, params] of Object.entries(status_obj)) {
            let amt = params.amount ?? 0;
            const cnt = params.count ?? 0;
            if (attacker) amt = trigger_status_modify(attacker, "on_status_apply", amt, { status_id: s_id });
            target.apply_status(s_id, amt, cnt);
          }
        }
      }
    }

    if ("fixed_damage" in entry) target.take_damage(entry.fixed_damage, 0);
    if ("sanity_damage" in entry) target.change_sanity(-entry.sanity_damage);

    if ("tremor_burst" in entry) {
      const tremor = target.statuses.tremor;
      if (tremor && tremor.amount > 0) {
        const t_dmg = tremor.amount;
        say(`[${target.name}] 진동 폭발! ${t_dmg} 흐트러짐 피해!`, "stagger");
        target.take_damage(0, t_dmg);
        tremor.count -= 1;
        if (tremor.count <= 0) delete target.statuses.tremor;
      }
    }

    if ("heal_hp" in entry) {
      const recovered = attacker.change_hp(entry.heal_hp);
      if (recovered > 0) say(`[${attacker.name}] 적중 효과로 체력 ${recovered} 회복!`, "heal");
    }

    if ("generate_card" in entry) {
      const gen = entry.generate_card;
      if (gen && typeof gen === "object") {
        let dest = gen.target ?? "self";
        let card_id = gen.card_id;
        if ("self" in gen) { dest = "self"; card_id = gen.self; }
        else if ("opponent" in gen) { dest = "target"; card_id = gen.opponent; }
        const receiver = dest === "self" ? attacker : target;
        if (card_id && receiver) {
          const new_card = load_card(card_id);
          receiver.hand.push(new_card);
          const dest_text = dest === "self" ? "패" : `[${target.name}]의 패`;
          say(`[${attacker.name}] 적중 효과로 ${dest_text}에 [${new_card.name}] 생성!`);
        }
      }
    }
  }
}

export function apply_clash_win_effects(winner, loser, dice) {
  if (!loser || !dice) return;
  for (const entry of dice.dice_effect ?? []) {
    if (!entry) continue;

    if ("clash_recover_cost" in entry) {
      const val = entry.clash_recover_cost;
      winner.current_cost = Math.min(winner.max_cost, winner.current_cost + val);
      say(`[${winner.name}] 합 승리 효과로 빛 ${val} 회복!`);
    }

    const hp_dmg = entry.clash_fixed_damage ?? 0;
    const stagger_dmg = entry.clash_fixed_stagger ?? 0;
    if (hp_dmg > 0 || stagger_dmg > 0) {
      say(`[${winner.name}] 합 승리 효과!`);
      loser.take_damage(hp_dmg, stagger_dmg);
    }

    if ("clash_give_card_self" in entry) {
      const c = load_card(entry.clash_give_card_self);
      winner.hand.push(c);
      say(`[${winner.name}] 합 승리 효과로 패에 [${c.name}] 생성!`);
    }
    if ("clash_give_card_target" in entry) {
      const c = load_card(entry.clash_give_card_target);
      loser.hand.push(c);
      say(`[${winner.name}] 합 승리 효과로 [${loser.name}]의 패에 [${c.name}] 생성!`);
    }
  }
}

export function check_and_consume_gun_cost(unit, dice) {
  for (const entry of dice.dice_effect ?? []) {
    if (entry && "gun" in entry) {
      const cost = entry.gun;
      const bullet = unit.statuses.bullet;
      if (!bullet || (bullet.amount ?? 0) < cost) return false;
      bullet.amount -= cost;
      say(`[${unit.name}] 탄환 ${cost}발 소모! (남은 탄환: ${bullet.amount})`);
      if (bullet.amount <= 0) delete unit.statuses.bullet;
    }
  }
  return true;
}

// ==================================================
// 흐트러짐 / 턴 시작
// ==================================================
export function activate_stagger(unit) {
  if (unit.is_staggered) return;
  unit.current_stagger = 0;
  unit.is_staggered = true;
  unit.staggered_turns_remaining = 1;
  for (const k of Object.keys(unit.endurance)) unit.endurance[k] = 2.0;
  for (const k of Object.keys(unit.stagger_endurance)) unit.stagger_endurance[k] = 2.0;
}

export function ensure_staggered(unit) {
  if (unit.current_stagger <= 0 && !unit.is_staggered) activate_stagger(unit);
}

export function begin_turn(unit) {
  unit.dice_power_modifiers = {};
  ensure_staggered(unit);

  let has_dead;
  if (unit.faction === "enemy") {
    has_dead = game.fallen_enemy_count > 0;
  } else {
    has_dead = [game.player_char, ...game.allies].some((a) => a && a.hp <= 0);
  }
  trigger_passive_action(unit, "on_turn_start", { has_dead_ally: has_dead });

  if (unit.is_panicked) {
    if ((unit.panicked_turns_remaining ?? 0) > 0) {
      unit.panicked_turns_remaining -= 1;
    } else {
      say(`${unit.name} 패닉에서 회복, 정신력을 최대로 회복합니다.`, "panic");
      unit.is_panicked = false;
      unit.panicked_turns_remaining = 0;
      unit.change_sanity(unit.max_sanity);
    }
  }

  apply_panic_effects(unit);

  if (!unit.is_staggered) return;
  if (unit.staggered_turns_remaining > 0) {
    unit.staggered_turns_remaining -= 1;
    return;
  }
  unit.current_stagger = unit.stagger_resist;
  unit.endurance = { ...unit.base_endurance };
  unit.stagger_endurance = { ...unit.base_stagger_endurance };
  unit.is_staggered = false;
  unit.staggered_turns_remaining = 0;
}

// ==================================================
// 주사위 / 피해 계산
// ==================================================
export function roll_dice(dice, unit = null, kind = "all") {
  const context = { kind, dmg_type: dice.damage_type ?? "all" };
  if (unit) {
    trigger_passive_action(unit, "on_roll", context, null);
    trigger_status_effect(unit, "on_roll", context);
    ensure_staggered(unit);
    if (unit.is_staggered) return 0;
  }

  const min_val = dice.min;
  let max_val = dice.max;
  if (unit) max_val = trigger_passive_modify(unit, "modify_max_roll", max_val, context);

  let roll = randint(min_val, Math.max(min_val, max_val));

  if (unit) {
    roll = trigger_passive_modify(unit, "modify_roll", roll, context);
    roll = trigger_status_modify(unit, "on_roll", roll, context);

    let bonus = unit.dice_power_modifiers.all ?? 0;
    const dmg_type = dice.damage_type ?? "all";
    if (dmg_type !== "all") bonus += unit.dice_power_modifiers[dmg_type] ?? 0;
    roll += bonus;
    roll += unit.card_dice_power_modifier ?? 0;

    if (unit.statuses.strength) {
      if (["attack", "counter"].includes(dice.type) || ["attack", "counter"].includes(kind)) {
        roll += unit.statuses.strength.amount;
      }
    }

    let has_hand_scaling = false;
    for (const entry of dice.dice_effect ?? []) {
      if (entry && ((typeof entry === "object" && "hand_scaling" in entry) || entry === "hand_scaling")) {
        has_hand_scaling = true;
        break;
      }
    }
    if (has_hand_scaling || dice.hand_scaling) roll += (unit.hand ?? []).length;
  }
  return Math.max(0, roll);
}

export function calc_damage(value, damage_type, target, attacker = null) {
  const resist = target.endurance[damage_type] ?? 1.0;
  let dmg = Math.trunc(value * resist);

  if (attacker) {
    const context = { kind: "attack", dmg_type: damage_type };
    dmg = trigger_passive_modify(attacker, "modify_damage_dealt", dmg, context, target);

    const poise = attacker.statuses.poise;
    if (poise && poise.amount > 0) {
      if (randint(1, 100) <= poise.amount * 5) {
        say(`[${attacker.name}] 크리티컬!`, "crit");
        dmg = Math.trunc(dmg * 1.2);
        poise.count -= 1;
        if (poise.count <= 0) delete attacker.statuses.poise;
      }
    }
  }
  return Math.max(0, dmg);
}

export function calc_stagger_damage(value, damage_type, target) {
  const resist = target.stagger_endurance[damage_type] ?? 1.0;
  return Math.trunc(value * resist);
}

export function extract_counter_dice(unit) {
  for (const card of unit.equipped) {
    if (!card) continue;
    const remain = [];
    for (const dice of card.dice) {
      if (dice.type === "counter") unit.saved_counter.push(dice);
      else remain.push(dice);
    }
    card.dice = remain;
  }
}

const tname = (t) => DICE_TYPE_MAP[t] ?? t;

// ==================================================
// 일방 공격
// ==================================================
export function resolve_one_side_attack(attacker, defender, attack_dice) {
  if (!check_and_consume_gun_cost(attacker, attack_dice)) {
    say(`[${attacker.name}] 탄환 부족으로 주사위 파괴!`);
    return;
  }

  const defense_pool = [...defender.saved_counter, ...defender.saved_defense];
  const atk_damage_type = attack_dice.damage_type;

  if (!defense_pool.length) {
    const atk_roll = roll_dice(attack_dice, attacker, "attack");
    if (atk_roll <= 0) return;

    const hp_dmg = calc_damage(atk_roll, atk_damage_type, defender, attacker);
    const stagger_dmg = calc_stagger_damage(atk_roll, atk_damage_type, defender);
    say(`[일방공격] ${atk_roll}(${tname(atk_damage_type)})`, "clash");
    trigger_win_sfx(attack_dice);
    defender.take_damage(hp_dmg, stagger_dmg);
    apply_dice_effects(attacker, defender, attack_dice);
    trigger_passive_action(attacker, "on_hit", { kind: "attack", dmg_type: atk_damage_type }, defender);
    pause_mark();
    return;
  }

  while (defense_pool.length) {
    const defend_dice = defense_pool[0];
    const atk_roll = roll_dice(attack_dice, attacker, "attack");
    const def_roll = roll_dice(defend_dice, defender, "counter");
    const def_damage_type = defend_dice.damage_type;

    const atk_val = atk_roll > 0 ? atk_roll : "흐트러짐!";
    const def_val = def_roll > 0 ? def_roll : "흐트러짐!";
    const label = def_damage_type && def_damage_type.includes("counter") ? "반격" : "수비";
    say(`[${label} 합] ${atk_val}(${tname(atk_damage_type)}) VS ${def_val}(${tname(def_damage_type)})`, "clash");

    if (atk_roll > def_roll) {
      defense_pool.shift();
      defender.change_sanity(-5);
      let i = defender.saved_counter.indexOf(defend_dice);
      if (i >= 0) defender.saved_counter.splice(i, 1);
      i = defender.saved_defense.indexOf(defend_dice);
      if (i >= 0) defender.saved_defense.splice(i, 1);
      pause_mark();
      continue;
    } else if (def_roll > atk_roll) {
      sfx(def_damage_type);
      if (def_damage_type === "block") {
        say(`[${defender.name}] 공격 차단!`);
        const i = defender.saved_defense.indexOf(defend_dice);
        if (i >= 0) defender.saved_defense.splice(i, 1);
        pause_mark();
        return;
      } else if (def_damage_type === "evade") {
        say(`[${defender.name}] 회피 성공!`);
        pause_mark();
        return;
      } else if (def_damage_type === "counter_block") {
        say(`[${defender.name}] 반격 차단 성공!`);
        pause_mark();
        return;
      } else if (def_damage_type === "counter_evade") {
        say(`[${defender.name}] 반격 회피 성공!`);
        pause_mark();
        return;
      } else if (["counter_slash", "counter_pierce", "counter_blunt"].includes(def_damage_type)) {
        const real_type = def_damage_type.replace("counter_", "");
        const dmg = calc_damage(def_roll, real_type, attacker, defender);
        say(`[${defender.name}] 반격 적중!`);
        attacker.take_damage(dmg, 0);
        attacker.change_sanity(-5);
        pause_mark();
        return;
      }
      return; // 알 수 없는 수비 종류로 무한 루프에 빠지지 않게 함
    } else {
      say("무승부!");
      pause_mark();
      return;
    }
  }
}

// ==================================================
// 합 (카드 대결)
// ==================================================
export function clash_cards(player, enemy, player_card, enemy_card) {
  const player_dice = player_card.dice.slice();
  const enemy_dice = enemy_card.dice.slice();

  say(`${player_card.name} VS ${enemy_card.name}`, "clash-title");

  const p_ct = player_card.type;
  const e_ct = enemy_card.type;
  const is_p_melee_vs_e_ranged = p_ct === "melee" && e_ct === "ranged";
  const is_e_melee_vs_p_ranged = e_ct === "melee" && p_ct === "ranged";

  player.card_dice_power_modifier = 0;
  enemy.card_dice_power_modifier = 0;

  play_card_dialogue(player, player_card);
  apply_on_use_effects(player, player_card, enemy);
  play_card_dialogue(enemy, enemy_card);
  apply_on_use_effects(enemy, enemy_card, player);

  let clash_index = 1;

  while (player_dice.length && enemy_dice.length) {
    while (player_dice.length && !check_and_consume_gun_cost(player, player_dice[0])) {
      say(`[${player.name}] 탄환 부족으로 주사위 파괴!`);
      player_dice.shift();
    }
    while (enemy_dice.length && !check_and_consume_gun_cost(enemy, enemy_dice[0])) {
      say(`[${enemy.name}] 탄환 부족으로 주사위 파괴!`);
      enemy_dice.shift();
    }
    if (!player_dice.length || !enemy_dice.length || player.hp <= 0 || enemy.hp <= 0) break;

    const p_dice = player_dice.shift();
    const e_dice = enemy_dice.shift();

    const p_roll = player.is_staggered ? 0 : roll_dice(p_dice, player);
    const e_roll = roll_dice(e_dice, enemy);

    const p_kind = p_dice.type, e_kind = e_dice.type;
    const p_type = p_dice.damage_type, e_type = e_dice.damage_type;

    const p_val = p_roll > 0 ? p_roll : "흐트러짐!";
    const e_val = e_roll > 0 ? e_roll : "흐트러짐!";
    say(`[합 ${clash_index}] ${p_val}(${tname(p_type)}) VS ${e_val}(${tname(e_type)})`, "clash");
    clash_index += 1;

    if (p_kind === "attack" && e_kind === "attack") {
      // 공격 vs 공격
      if (p_roll > e_roll) {
        trigger_win_sfx(p_dice);
        if (is_p_melee_vs_e_ranged) {
          player_dice.push(p_dice);
          say(`[${player.name}] 근거리 선공! 주사위를 재사용하며 ${enemy.name}은(는) 피해를 입지 않습니다.`);
          continue;
        }
        enemy.change_sanity(-5);
        const hp_dmg = calc_damage(p_roll, p_type, enemy, player);
        const stagger_dmg = calc_stagger_damage(p_roll, p_type, enemy);
        enemy.take_damage(hp_dmg, stagger_dmg);
        apply_dice_effects(player, enemy, p_dice);
        trigger_passive_action(player, "on_hit", { kind: "attack", dmg_type: p_type }, enemy);
        apply_clash_win_effects(player, enemy, p_dice);
        trigger_passive_action(player, "on_clash_win", { kind: "attack", dmg_type: p_type }, enemy);
      } else if (e_roll > p_roll) {
        trigger_win_sfx(e_dice);
        if (is_e_melee_vs_p_ranged) {
          enemy_dice.push(e_dice);
          say(`[${enemy.name}] 근거리 선공! 주사위를 재사용하며 ${player.name}은(는) 피해를 입지 않습니다.`);
          continue;
        }
        player.change_sanity(-5);
        const hp_dmg = calc_damage(e_roll, e_type, player, enemy);
        const stagger_dmg = calc_stagger_damage(e_roll, e_type, player);
        say(`[${enemy.name} 승리!]`);
        player.take_damage(hp_dmg, stagger_dmg);
        apply_dice_effects(enemy, player, e_dice);
        apply_clash_win_effects(enemy, player, e_dice);
        trigger_passive_action(enemy, "on_clash_win", { kind: "attack", dmg_type: e_type }, player);
        trigger_passive_action(enemy, "on_hit", { kind: "attack", dmg_type: e_type }, player);
      } else {
        sfx("draw_atk");
        say("무승부!");
      }
    } else if (p_kind === "attack" && e_type === "block") {
      // 공격 vs 수비(block)
      if (p_roll > e_roll) {
        trigger_win_sfx(p_dice);
        if (is_p_melee_vs_e_ranged) {
          player_dice.push(p_dice);
          say(`[${player.name}] 근거리 합 승리! 주사위를 재사용합니다.`);
          continue;
        }
        const diff = p_roll - e_roll;
        const hp_dmg = calc_damage(diff, p_type, enemy, player);
        const stagger_dmg = calc_stagger_damage(diff, p_type, enemy);
        say(`[${player.name} 승리!]`);
        enemy.change_sanity(-5);
        enemy.take_damage(hp_dmg, stagger_dmg);
        apply_dice_effects(player, enemy, p_dice);
        apply_clash_win_effects(player, enemy, p_dice);
        trigger_passive_action(player, "on_clash_win", { kind: "attack", dmg_type: p_type }, enemy);
        trigger_passive_action(player, "on_hit", { kind: "attack", dmg_type: p_type }, enemy);
      } else if (e_roll > p_roll) {
        sfx("block");
        if (is_e_melee_vs_p_ranged) {
          enemy_dice.push(e_dice);
          say(`[${enemy.name}] 방어 성공! 주사위를 재사용합니다.`);
          continue;
        }
        const diff = e_roll - p_roll;
        const stagger_dmg = calc_stagger_damage(diff, p_type, enemy);
        player.change_sanity(-5);
        enemy.take_damage(0, stagger_dmg);
        apply_clash_win_effects(enemy, player, e_dice);
      } else {
        sfx("evade");
        say("무승부!");
      }
    } else if (p_type === "block" && e_kind === "attack") {
      // 수비(block) vs 공격
      if (e_roll > p_roll) {
        trigger_win_sfx(e_dice);
        if (is_e_melee_vs_p_ranged) {
          enemy_dice.push(e_dice);
          say(`[${enemy.name}] 근거리 합 승리! 주사위를 재사용합니다.`);
          continue;
        }
        const diff = e_roll - p_roll;
        const hp_dmg = calc_damage(diff, e_type, player, enemy);
        const stagger_dmg = calc_stagger_damage(diff, e_type, player);
        say(`[${enemy.name} 승리!]`);
        player.change_sanity(-5);
        player.take_damage(hp_dmg, stagger_dmg);
        apply_dice_effects(enemy, player, e_dice);
        apply_clash_win_effects(enemy, player, e_dice);
        trigger_passive_action(enemy, "on_hit", { kind: "attack", dmg_type: e_type }, player);
      } else if (p_roll > e_roll) {
        sfx("block");
        if (is_p_melee_vs_e_ranged) {
          player_dice.push(p_dice);
          say(`[${player.name}] 방어 성공! 주사위를 재사용합니다.`);
          continue;
        }
        const diff = p_roll - e_roll;
        const stagger_dmg = calc_stagger_damage(diff, e_type, player);
        enemy.change_sanity(-5);
        player.take_damage(0, stagger_dmg);
        apply_clash_win_effects(player, enemy, p_dice);
      } else {
        sfx("block");
        say("무승부!");
      }
    } else if (p_kind === "attack" && e_type === "evade") {
      // 공격 vs 회피(evade)
      if (p_roll > e_roll) {
        trigger_win_sfx(p_dice);
        if (is_p_melee_vs_e_ranged) {
          player_dice.push(p_dice);
          say(`[${player.name}] 공격 성공! 주사위를 재사용합니다.`);
          continue;
        }
        const diff = p_roll - e_roll;
        const hp_dmg = calc_damage(diff, p_type, enemy, player);
        const stagger_dmg = calc_stagger_damage(diff, p_type, enemy);
        say(`[${player.name} 승리!]`);
        enemy.change_sanity(-5);
        enemy.take_damage(hp_dmg, stagger_dmg);
        apply_dice_effects(player, enemy, p_dice);
        apply_clash_win_effects(player, enemy, p_dice);
        trigger_passive_action(player, "on_hit", { kind: "attack", dmg_type: p_type }, enemy);
      } else if (e_roll > p_roll) {
        sfx("evade");
        enemy.current_stagger = Math.min(enemy.stagger_resist, enemy.current_stagger + e_roll);
        say(`${enemy.name} 흐트러짐 ${e_roll} 회복!`);
        player.change_sanity(-5);
        enemy_dice.unshift(e_dice);
      } else {
        sfx("evade");
        say("무승부!");
      }
    } else if (p_type === "evade" && e_kind === "attack") {
      // 회피(evade) vs 공격
      if (p_roll > e_roll) {
        sfx("evade");
        if (is_p_melee_vs_e_ranged) {
          player_dice.push(p_dice);
          say(`[${player.name}] 회피 성공! 주사위를 재사용합니다.`);
          continue;
        }
        player.current_stagger = Math.min(player.stagger_resist, player.current_stagger + p_roll);
        say(`${player.name} 흐트러짐 ${p_roll} 회복!`);
        enemy.change_sanity(-5);
        player_dice.unshift(p_dice);
      } else if (e_roll > p_roll) {
        trigger_win_sfx(e_dice);
        const diff = e_roll - p_roll;
        const hp_dmg = calc_damage(diff, e_type, player, enemy);
        const stagger_dmg = calc_stagger_damage(diff, e_type, player);
        player.change_sanity(-5);
        player.take_damage(hp_dmg, stagger_dmg);
      } else {
        sfx("block");
        say("무승부!");
      }
    } else {
      // 방어 vs 방어
      if (p_roll > e_roll) {
        if (is_p_melee_vs_e_ranged) {
          sfx(p_type);
          player_dice.push(p_dice);
          say(`[${player.name}] 수비 성공! 주사위를 재사용합니다.`);
          continue;
        }
        if (p_type === "block") {
          sfx("block");
          const stagger_dmg = p_roll - e_roll;
          enemy.current_stagger -= stagger_dmg;
          enemy.change_sanity(-5);
          say(`${enemy.name}에게 ${stagger_dmg} 흐트러짐 피해!`, "stagger");
        } else if (p_type === "evade") {
          sfx("evade");
          player.current_stagger = Math.min(player.stagger_resist, player.current_stagger + (p_roll - e_roll));
          enemy.change_sanity(-5);
          say(`${player.name} 흐트러짐 회복!`);
        }
      } else if (e_roll > p_roll) {
        if (is_e_melee_vs_p_ranged) {
          sfx(e_type);
          enemy_dice.push(e_dice);
          say(`[${enemy.name}] 수비 성공! 주사위를 재사용합니다.`);
          continue;
        }
        if (e_type === "block") {
          sfx("block");
          const stagger_dmg = e_roll - p_roll;
          player.current_stagger -= stagger_dmg;
          player.change_sanity(-5);
          say(`${player.name}에게 ${stagger_dmg} 흐트러짐 피해!`, "stagger");
        } else if (e_type === "evade") {
          sfx("evade");
          enemy.current_stagger = Math.min(enemy.stagger_resist, enemy.current_stagger + (e_roll - p_roll));
          player.change_sanity(-5);
          say(`${enemy.name} 흐트러짐 회복!`);
        }
      } else {
        sfx(p_type);
        say("무승부!");
      }
    }
    pause_mark();
  }

  // 남은 주사위 일방공격 처리
  while (player_dice.length && player.hp > 0 && enemy.hp > 0) {
    const p_dice = player_dice.shift();
    if (p_dice.type === "attack") {
      say(`[${player.name}] 남은 주사위 일방공격!`);
      resolve_one_side_attack(player, enemy, p_dice);
    } else if (["defense", "block", "evade"].includes(p_dice.type)) player.saved_defense.push(p_dice);
    else if (p_dice.type === "counter") player.saved_counter.push(p_dice);
  }
  while (enemy_dice.length && player.hp > 0 && enemy.hp > 0) {
    const e_dice = enemy_dice.shift();
    if (e_dice.type === "attack") {
      say(`[${enemy.name}] 남은 주사위 일방공격!`);
      resolve_one_side_attack(enemy, player, e_dice);
    } else if (["defense", "block", "evade"].includes(e_dice.type)) enemy.saved_defense.push(e_dice);
    else if (e_dice.type === "counter") enemy.saved_counter.push(e_dice);
  }
  player.card_dice_power_modifier = 0;
  enemy.card_dice_power_modifier = 0;
}

// ==================================================
// 턴 해결
// ==================================================
export function resolve_turn(allies, enemies) {
  const everyone = [...allies, ...enemies];
  for (const unit of everyone) {
    unit.saved_counter = [];
    unit.saved_defense = [];
    extract_counter_dice(unit);
  }

  const all_actions = [];
  for (const unit of everyone) {
    for (let i = 0; i < unit.equipped.length; i++) {
      if (unit.equipped[i] && unit.targets && unit.targets[i]) {
        all_actions.push({ unit, slot: i, card: unit.equipped[i], t_unit: unit.targets[i][0], t_slot: unit.targets[i][1], done: false });
      }
    }
  }

  // 1. 합
  for (const action of all_actions) {
    if (action.done) continue;
    const partner = all_actions.find((o) => !o.done && o !== action
      && o.unit === action.t_unit && o.slot === action.t_slot
      && action.unit === o.t_unit && action.slot === o.t_slot);
    if (partner) {
      clash_cards(action.unit, partner.unit, action.card, partner.card);
      action.done = true;
      partner.done = true;
    }
  }

  // 2. 일방 공격
  for (const action of all_actions) {
    if (action.done) continue;
    const attacker = action.unit, card = action.card, defender = action.t_unit;
    if (attacker.hp > 0 && !attacker.is_staggered && defender.hp > 0) {
      say(`[${attacker.name}] -> [${defender.name}] 일방공격!`, "clash-title");
      attacker.card_dice_power_modifier = 0;
      play_card_dialogue(attacker, card);
      apply_on_use_effects(attacker, card, defender);

      for (const dice of card.dice) {
        const dtype = dice.type;
        if (dtype === "attack") {
          resolve_one_side_attack(attacker, defender, dice);
          if (defender.hp <= 0) break;
        } else if (["defense", "block", "evade"].includes(dtype)) attacker.saved_defense.push(dice);
        else if (dtype === "counter") attacker.saved_counter.push(dice);
      }
      attacker.card_dice_power_modifier = 0;
    }
    action.done = true;
  }

  for (const u of everyone) ensure_staggered(u);
}

// ==================================================
// AI 카드 선택
// ==================================================
export function select_cards_pattern(unit, opponents) {
  if (unit.hp <= 0 || unit.is_staggered || unit_cannot_equip(unit) || !opponents.length) return;
  const live = opponents.filter((o) => o.hp > 0);
  if (!live.length) return;

  const pattern = unit.pattern ?? [];
  if (!pattern.length) {
    enemy_select_cards_random(unit, opponents);
    return;
  }

  const step = pattern[unit.pattern_index % pattern.length];
  const cards_list = Array.isArray(step) ? step : [step];

  let slot_idx = 0;
  for (const entry of cards_list) {
    let card_id, target_idx = null;
    if (entry && typeof entry === "object") {
      card_id = entry.card_id ?? entry.id;
      target_idx = entry.target_idx ?? null;
    } else {
      card_id = String(entry);
    }
    if (!card_id) continue;

    const card = load_card(card_id);
    if (card.type === "on_play") {
      unit.current_cost = Math.max(0, unit.current_cost - card.cost);
      const h_idx = unit.hand.findIndex((h) => (h.id ?? h) === card.id);
      if (h_idx >= 0) unit.hand.splice(h_idx, 1);
      unit.discard_pile.push(card.id);
      play_card_dialogue(unit, card);
      apply_on_use_effects(unit, card);
      continue;
    }

    if (slot_idx >= unit.card_slot) continue;

    unit.equipped[slot_idx] = card;
    unit.current_cost = Math.max(0, unit.current_cost - card.cost);

    const h_idx = unit.hand.findIndex((h) => (h.id ?? h) === card.id);
    if (h_idx >= 0) unit.hand.splice(h_idx, 1);

    let target_unit;
    if (target_idx !== null && target_idx >= 0 && target_idx < live.length) {
      target_unit = live[target_idx];
    } else {
      target_unit = rand_choice(live);
    }
    unit.targets[slot_idx] = [target_unit, randint(0, target_unit.card_slot - 1)];
    slot_idx += 1;
  }

  unit.pattern_index = (unit.pattern_index + 1) % pattern.length;
}

export function enemy_select_cards_random(unit, opponents) {
  const live = opponents.filter((o) => o.hp > 0);
  if (!live.length) return;

  const on_play = unit.hand.filter((c) => c.type === "on_play");
  for (const card of on_play) {
    if (card.cost <= unit.current_cost) {
      unit.current_cost -= card.cost;
      unit.hand.splice(unit.hand.indexOf(card), 1);
      unit.discard_pile.push(card.id);
      play_card_dialogue(unit, card);
      apply_on_use_effects(unit, card);
    }
  }

  for (let i = 0; i < unit.card_slot; i++) {
    const candidates = unit.hand.filter((c) => c.cost <= unit.current_cost);
    if (!candidates.length) break;
    const card = rand_choice(candidates);
    unit.equipped[i] = card;
    unit.hand.splice(unit.hand.indexOf(card), 1);
    unit.current_cost -= card.cost;

    const target_unit = rand_choice(live);
    const target_slot = randint(0, target_unit.card_slot - 1);
    unit.targets[i] = [target_unit, target_slot];
  }
}

export function enemy_select_cards(unit, opponents) {
  if (unit.hp <= 0 || unit.is_staggered || unit_cannot_equip(unit) || !opponents.length) return;
  const ai_type = unit.ai_type ?? "random";
  if (ai_type === "pattern") {
    select_cards_pattern(unit, opponents);
    return;
  }
  enemy_select_cards_random(unit, opponents);
}

export function ally_select_cards(ally, enemies) {
  if (ally.hp <= 0 || ally.is_staggered || unit_cannot_equip(ally) || !enemies.length) return;
  const ai_type = ally.ai_type ?? "random";
  if (ai_type === "controllable") return;
  if (ai_type === "pattern") {
    select_cards_pattern(ally, enemies);
    return;
  }
  if (ai_type === "random") enemy_select_cards_random(ally, enemies);
}

export function get_battle_flavor_text(player, enemies) {
  if (!enemies.length) return "";
  const leader = enemies[0];
  const d = leader.dialogue_lines ?? {};
  if (player.is_panicked && d.on_panic?.player) return d.on_panic.player;
  if (leader.is_panicked && d.on_panic?.enemy) return d.on_panic.enemy;
  if (player.is_staggered && d.on_staggered?.player) return d.on_staggered.player;
  if (leader.is_staggered && d.on_staggered?.enemy) return d.on_staggered.enemy;
  if (d.common && d.common.length) return rand_choice(d.common);
  return "";
}

// ==================================================
// 전투 진행 객체
// ==================================================
export class Battle {
  constructor(enemy_ids) {
    if (typeof enemy_ids === "string") enemy_ids = [enemy_ids];
    this.player = game.player_char;
    this.allies = [this.player, ...game.allies];
    this.enemies = enemy_ids.map((id) => new Enemy(load_enemy(id)));
    game.enemies = this.enemies;
    game.battle = this;
    game.fallen_enemy_count = 0;
    this.defeated = [];
    this.turn = 0;
    this.first = true;
    this.outcome = null;
    this.phase = "plan";
    this.bgm = this.enemies[0].dialogue_lines.bgm ?? game.basic_battle_theme;
    game.cur_units = [...this.allies, ...this.enemies];

    for (const u of game.cur_units) {
      u.passive_vars = {};
      u.statuses = {};
      u.active_panic_effects = [];
      u.panicked_turns_remaining = 0;
      u.draw_pile = build_deck_list(u.deck);
      u.hand = [];
      u.equipped = Array(u.card_slot).fill(null);
      u.slot_speeds = Array(u.card_slot).fill(0);
      u.targets = Array(u.card_slot).fill(null);
      u.discard_pile = [];
      u.current_cost = u.max_cost;
      draw_cards(u, 3);
      apply_panic_effects(u);
    }
    this.msg = this.enemies[0].appear || "";
  }

  all_units() { return [...this.allies, ...this.enemies]; }

  // 턴 시작: 아군/적 준비와 적 AI의 카드 선택까지 (이후 플레이어가 카드를 배치)
  start_turn() {
    game.in_battle = true;
    this.turn += 1;
    const all = this.all_units();
    for (const u of all) begin_turn(u);

    if (!this.first) this.msg = get_battle_flavor_text(this.player, this.enemies);
    this.first = false;

    for (const u of all) {
      u.equipped = Array(u.card_slot).fill(null);
      u.slot_speeds = Array.from({ length: u.card_slot }, () => randint(u.speed.min, u.speed.max));
      u.targets = Array(u.card_slot).fill(null);
      draw_cards(u, 1);
    }
    for (const en of this.enemies) enemy_select_cards(en, this.allies);
    for (const al of this.allies) if (al !== this.player) ally_select_cards(al, this.enemies);
    this.phase = "plan";
    pause_mark();
  }

  // ----- 플레이어 조작 -----
  can_act(unit) { return unit.hp > 0 && !unit.is_staggered && !unit_cannot_equip(unit) && this.phase === "plan"; }

  equip(unit, hand_index, slot, target_unit, target_slot) {
    if (!this.can_act(unit)) {
      let error = "전투 불능 상태입니다.";
      if (unit.is_staggered) error = "이 유닛은 흐트러진 상태입니다.";
      else if (unit_cannot_equip(unit)) error = "이 유닛은 패닉으로 인해 카드를 장착할 수 없습니다.";
      return { ok: false, error };
    }
    const card = unit.hand[hand_index];
    if (!card) return { ok: false, error: "카드가 없습니다." };
    if (card.type === "on_play") return this.play_on_play(unit, hand_index);
    if (slot < 0 || slot >= unit.card_slot) return { ok: false, error: "잘못된 슬롯입니다." };
    if (!target_unit || target_slot < 0 || target_slot >= target_unit.card_slot) return { ok: false, error: "잘못된 대상입니다." };

    const old_card = unit.equipped[slot];
    const available_light = unit.current_cost + (old_card ? old_card.cost : 0);
    if (card.cost > available_light) return { ok: false, error: "빛 부족" };

    const my_speed = unit.slot_speeds[slot];
    const target_speed = target_unit.slot_speeds[target_slot];
    const notes = [];
    if (my_speed > target_speed) {
      const cur = target_unit.targets[target_slot];
      if (!cur || cur[0] !== unit || cur[1] !== slot) {
        notes.push(`[속도 우위] ${unit.name}의 속도(${my_speed})가 ${target_unit.name}의 속도(${target_speed})보다 빠릅니다! 공격 대상을 가로챕니다.`);
        target_unit.targets[target_slot] = [unit, slot];
      }
    }

    if (old_card) {
      unit.current_cost += old_card.cost;
      unit.hand.push(old_card);
    }
    unit.equipped[slot] = card;
    unit.targets[slot] = [target_unit, target_slot];
    unit.hand.splice(unit.hand.indexOf(card), 1);
    unit.current_cost -= card.cost;
    return { ok: true, notes };
  }

  unequip(unit, slot) {
    if (!this.can_act(unit)) return { ok: false, error: "지금은 조작할 수 없습니다." };
    const card = unit.equipped[slot];
    if (!card) return { ok: false };
    unit.current_cost += card.cost;
    unit.hand.push(card);
    unit.equipped[slot] = null;
    unit.targets[slot] = null;
    return { ok: true };
  }

  play_on_play(unit, hand_index) {
    if (!this.can_act(unit)) return { ok: false, error: "지금은 조작할 수 없습니다." };
    const card = unit.hand[hand_index];
    if (!card || card.type !== "on_play") return { ok: false, error: "즉시 발동 카드가 아닙니다." };
    if (card.cost > unit.current_cost) return { ok: false, error: "빛 부족" };
    unit.current_cost -= card.cost;
    unit.hand.splice(hand_index, 1);
    unit.discard_pile.push(card.id);
    say(`[${card.name}] 사용!`);
    play_card_dialogue(unit, card);
    apply_on_use_effects(unit, card);
    return { ok: true, used: true };
  }

  // ----- 턴 해결 -----
  // 반환: "win" | "lose" | "continue". 이벤트는 game.events 에 쌓입니다.
  resolve() {
    game.in_battle = true;
    this.phase = "resolving";
    resolve_turn(this.allies, this.enemies);

    for (const u of this.all_units()) trigger_status_effect(u, "on_turn_end", {});

    for (const e of this.enemies) {
      if (e.hp <= 0) {
        game.fallen_enemy_count += 1;
        this.defeated.push(e);
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    game.enemies = this.enemies;

    if (!this.enemies.length) {
      say("전투 승리!", "win");
      for (const al of this.allies) {
        if (al.hp <= 0) {
          al.hp = Math.floor(al.max_hp / 2);
          say(`[${al.name}]이(가) 다시 정신을 차립니다. (HP ${al.hp} 회복)`);
        }
      }
      pause_mark();
      this.outcome = "win";
      this.phase = "over";
      return "win";
    }

    if (this.player.hp <= 0 || !this.allies.some((a) => a.hp > 0)) {
      say("[사망] 플레이어 진영이 궤멸되었습니다...", "dmg");
      game.ending_name = "육체적 사망";
      game.ended = true;
      pause_mark();
      this.outcome = "lose";
      this.phase = "over";
      return "lose";
    }

    pause_mark();
    for (const u of this.all_units()) {
      u.current_cost = Math.min(u.max_cost, u.current_cost + 1);
      for (const card of u.equipped) if (card) u.discard_pile.push(card.id);
    }
    this.phase = "resolved";
    return "continue";
  }

  finish() {
    game.in_battle = false;
    game.battle = null;
    game.cur_units = [];
  }
}
