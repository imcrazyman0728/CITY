// CITY 인카운터/진행 엔진 (main.py의 run_encounter, apply_effects, game_loop 등을 옮긴 모듈)
// 화면과는 `rt.ui` 어댑터로만 대화합니다. (ui.js가 구현, 테스트에서는 가짜 어댑터를 꽂을 수 있음)
//
// rt.ui 가 구현해야 하는 비동기 함수
//   node({ text, choices:[{ text, chance, met }] })   -> 선택한 choices 인덱스
//   notes(lines)                                      -> 획득/변화 알림 (기다리지 않음)
//   roll({ chance, roll, success })                   -> 확률 판정 연출
//   pickCard({ title, items:[{id,name,count}] })      -> 카드 id | null
//   pickGadget({ title, items:[{id,name,count}], step, total }) -> 가젯 id | null
//   levelUp({ level, hp_inc, san_inc, max_hp, max_sanity, options:[{id,name,cost,grade}] }) -> 인덱스
//   battle(battle)                                    -> "win" | "lose"
//   ending({ name, dead })                            -> 유언 문자열 (죽은 경우), 아니면 ""
import * as E from "./engine.js";
import { game, randint, rand_choice, shuffle, sample, weighted_pick_n } from "./engine.js";

export const rt = { ui: null };
const ui = () => rt.ui;

// ==================================================
// 프로필 / 도감 / 도전과제
// ==================================================
export function save_profile() { game.hooks.save_profile(game.profile); }

export function give_achievement(name) {
  const list = (game.profile.achievements ??= []);
  if (list.includes(name)) return false;
  list.push(name);
  save_profile();
  return true;
}

export function update_encyclopedia({ enemy = null, player = null, gadget_id = null } = {}) {
  const p = game.profile;
  let updated = false;
  const push_unique = (key, value) => {
    const arr = (p[key] ??= []);
    if (!arr.includes(value)) { arr.push(value); updated = true; }
  };
  if (enemy) {
    const kills = (p.enemy_kills ??= {});
    kills[enemy.id] = (kills[enemy.id] ?? 0) + 1;
    updated = true;
    push_unique("unlocked_enemies", enemy.id);
    for (const card_id of Object.keys(enemy.deck)) push_unique("unlocked_cards", card_id);
  }
  if (player) for (const card_id of Object.keys(player.deck)) push_unique("unlocked_cards", card_id);
  if (gadget_id) push_unique("unlocked_gadgets", gadget_id);
  if (updated) save_profile();
}

// ==================================================
// 조건 / 확률
// ==================================================
const gadget_cats = (g_id) => E.load_gadget_data(g_id)?.category ?? [];

export function check_requirements(req) {
  if (!req) return true;
  const player = game.player_char;
  if (!player) return true;

  if ("item" in req && !player.has_gadget(req.item)) return false;
  if ("not_item" in req && player.has_gadget(req.not_item)) return false;
  if ("items" in req) {
    for (const [name, amount] of Object.entries(req.items)) if (player.gadget_count(name) < amount) return false;
  }
  if ("required_category" in req) {
    for (const [cat, min_amt] of Object.entries(req.required_category)) {
      let total = 0;
      for (const [g_id, n] of Object.entries(player.gadgets)) if (gadget_cats(g_id).includes(cat)) total += n;
      if (total < min_amt) return false;
    }
  }
  if ("has_card" in req && (player.deck[req.has_card] ?? 0) <= 0) return false;
  if ("has_passive" in req && !player.passives.includes(req.has_passive)) return false;
  if ("has_cards" in req) {
    for (const [c_id, amt] of Object.entries(req.has_cards)) if ((player.deck[c_id] ?? 0) < amt) return false;
  }
  const flags = game.profile.flags ?? {};
  if ("flag_min" in req) {
    for (const [f, v] of Object.entries(req.flag_min)) if ((flags[f] ?? 0) < v) return false;
  }
  if ("flag_max" in req) {
    for (const [f, v] of Object.entries(req.flag_max)) if ((flags[f] ?? 0) >= v) return false;
  }
  if ("name" in req && player.name !== req.name) return false;
  if ("not_name" in req && player.name === req.not_name) return false;
  return true;
}

export function calculate_chance(choice) {
  const player = game.player_char;
  let chance = choice.chance ?? 100;
  if (!player) return chance;

  if (choice.bonus_item) chance += player.gadget_count(choice.bonus_item) * (choice.bonus_per_item ?? 0);
  for (const [item, pen] of Object.entries(choice.penalty_items ?? {})) if (player.has_gadget(item)) chance -= pen;
  for (const [item, per] of Object.entries(choice.penalty_per_items ?? {})) chance -= player.gadget_count(item) * per;
  for (const [cat, per] of Object.entries(choice.penalty_category ?? {})) {
    let count = 0;
    for (const [g_id, n] of Object.entries(player.gadgets)) if (gadget_cats(g_id).includes(cat)) count += n;
    chance -= count * per;
  }
  if (choice.penalty_item) chance -= player.gadget_count(choice.penalty_item) * (choice.penalty_per_item ?? 0);
  return Math.max(0, Math.min(100, chance));
}

async function roll_choice(choice) {
  const chance = calculate_chance(choice);
  const roll = randint(1, 100);
  const success = roll <= chance;
  await ui().roll({ chance, roll, success });
  return success;
}

export function get_valid_choices(node) {
  return (node.choices ?? []).filter((c) => check_requirements(c.requirements) || (c.show ?? true));
}

// ==================================================
// 예약 인카운터
// ==================================================
export function schedule_special(gadget_id) {
  const pool = game.special_encounters[gadget_id];
  if (!pool || !pool.length) return;
  game.scheduled.push({ after: randint(3, 5), encounter: rand_choice(pool) });
}
function tick_scheduled() { for (const d of game.scheduled) d.after -= 1; }
function get_scheduled_ready() {
  const ready = [], remain = [];
  for (const d of game.scheduled) (d.after <= 0 ? ready : remain).push(d);
  game.scheduled = remain;
  return ready.map((d) => d.encounter);
}

// ==================================================
// 경험치 / 레벨업
// ==================================================
export async function gain_exp(unit, amount) {
  if (amount <= 0) return;
  unit.exp += amount;
  ui().notes([`경험치 ${amount} 획득 (현재 ${unit.exp}/10)`]);
  while (unit.exp >= 10) {
    unit.exp -= 10;
    await handle_level_up();
  }
}

const GRADE_WEIGHTS = { paperback: 50, hardcover: 35, limited: 10, "objet_d'art": 5 };

export async function handle_level_up() {
  const char = game.player_char;
  if (!char) return;
  const flags = game.profile.flags ?? {};
  const hp_inc = flags.levelup_hp ?? 0;
  const san_inc = flags.levelup_sanity ?? 0;

  char.level += 1;
  char.max_hp += hp_inc;
  char.max_sanity += san_inc;
  char.hp = char.max_hp;
  char.sanity = char.max_sanity;

  let options = [];
  if (char.card_pool.length) {
    const weights = char.card_pool.map((c) => GRADE_WEIGHTS[E.load_card(c).grade] ?? 1);
    options = weighted_pick_n(char.card_pool, weights, 3).map((id) => {
      const c = E.load_card(id);
      return { id, name: c.name, cost: c.cost, grade: c.grade };
    });
  }
  const idx = await ui().levelUp({
    level: char.level, hp_inc, san_inc, max_hp: char.max_hp, max_sanity: char.max_sanity, options,
  });
  if (options.length) {
    const picked = options[Math.max(0, Math.min(options.length - 1, idx ?? 0))].id;
    char.deck[picked] = (char.deck[picked] ?? 0) + 1;
    update_encyclopedia({ player: char });
    ui().notes([`[${E.load_card(picked).name}] 기술을 덱에 추가했습니다.`]);
  }
}

// ==================================================
// 전투
// ==================================================
export async function run_battle(enemy_ids) {
  const battle = new E.Battle(enemy_ids);
  const bgm = battle.bgm;
  if (bgm) game.hooks.bgm(bgm, { fade_ms: 500 });

  const outcome = await ui().battle(battle);
  battle.finish();

  if (outcome === "win") {
    if (game.field_theme) game.hooks.bgm(game.field_theme, { fade_ms: 1000 });
    else game.hooks.stop_bgm(1000);
    for (const e of battle.defeated) update_encyclopedia({ enemy: e });
    const total_exp = battle.defeated.reduce((s, e) => s + (e.exp ?? 0), 0);
    if (total_exp > 0) await gain_exp(battle.player, total_exp);
  } else {
    game.ended = true;
    game.hooks.stop_bgm(0); // 엔딩 화면이 죽음 곡을 직접 튼다
  }
  return outcome;
}

// ==================================================
// 효과 적용
// ==================================================
function upgradable_cards(char) {
  return Object.keys(char.deck).filter((id) => !id.endsWith("+") && game.data.cards[id + "+"]);
}
function deck_items(char, filter = null) {
  return Object.entries(char.deck)
    .filter(([id]) => !filter || filter.includes(id))
    .map(([id, count]) => ({ id, name: E.load_card(id).name, count }));
}
function remove_from_deck(char, id, n = 1) {
  char.deck[id] -= n;
  if (char.deck[id] <= 0) delete char.deck[id];
}
function expand_deck(char) {
  return Object.entries(char.deck).flatMap(([id, n]) => Array(n).fill(id));
}
const gadget_name = (id) => E.load_gadget_data(id)?.name ?? id;
const passive_name = (id) => E.load_passive_data(id)?.name ?? id;

export function create_player_char(char_id) {
  const data = game.data.players[char_id];
  if (!data) return `오류: ${char_id} 캐릭터 데이터를 불러올 수 없습니다.`;
  game.player_char = new E.PlayerChar(data);
  return `${game.player_char.name} 로 플레이 시작!`;
}

export async function apply_effects(effects) {
  if (!effects) return;
  const notes = [];
  const flush = () => { if (notes.length) ui().notes(notes.splice(0)); };
  const char = () => game.player_char;

  for (const [key, value] of Object.entries(effects)) {
    if (game.ended) break;
    const c = char();
    switch (key) {
      case "hp": if (c) { const d = c.change_hp(value); notes.push(`HP ${d >= 0 ? "+" : ""}${d}`); } break;
      case "sanity": if (c) { const d = c.change_sanity(value); notes.push(`정신력 ${d >= 0 ? "+" : ""}${d}`); } break;
      case "give_item":
        if (c) {
          c.add_gadget(value);
          update_encyclopedia({ gadget_id: value });
          notes.push(`[${gadget_name(value)}] 획득`);
          schedule_special(value);
        }
        break;
      case "exp": case "give_exp":
        if (c) { flush(); await gain_exp(c, value); }
        break;
      case "give_items":
        if (c) {
          for (const [item, amt] of Object.entries(value)) {
            c.add_gadget(item, amt);
            update_encyclopedia({ gadget_id: item });
            notes.push(`[${gadget_name(item)}] x${amt}`);
            schedule_special(item);
          }
        }
        break;
      case "remove_item": if (c) { c.remove_gadget(value); notes.push(`[${gadget_name(value)}] 제거`); } break;
      case "remove_items":
        if (c) for (const [item, amt] of Object.entries(value)) { c.remove_gadget(item, amt); notes.push(`[${gadget_name(item)}] x${amt} 제거`); }
        break;
      case "battle":
        flush();
        await run_battle(value);
        break;
      case "load_player_char": notes.push(create_player_char(value)); break;
      case "give_card":
        if (c) { c.deck[value] = (c.deck[value] ?? 0) + 1; update_encyclopedia({ player: c }); notes.push(`카드 [${E.load_card(value).name}] 획득`); }
        break;
      case "give_passive":
        if (c && !c.passives.includes(value)) { c.passives.push(value); notes.push(`패시브 [${passive_name(value)}] 획득`); }
        break;
      case "remove_card":
        if (c && value in c.deck) { remove_from_deck(c, value); notes.push(`카드 [${E.load_card(value).name}] 제거`); }
        break;
      case "remove_passive":
        if (c && c.passives.includes(value)) { c.passives.splice(c.passives.indexOf(value), 1); notes.push(`패시브 [${passive_name(value)}] 제거`); }
        break;
      case "give_cards":
        if (c) {
          for (const [id, amt] of Object.entries(value)) { c.deck[id] = (c.deck[id] ?? 0) + amt; notes.push(`카드 [${E.load_card(id).name}] x${amt} 획득`); }
          update_encyclopedia({ player: c });
        }
        break;
      case "remove_cards":
        if (c) {
          for (const [id, amt] of Object.entries(value)) {
            if (id in c.deck) { const n = Math.min(c.deck[id], amt); remove_from_deck(c, id, n); notes.push(`카드 [${E.load_card(id).name}] x${n} 제거`); }
          }
        }
        break;
      case "give_passives":
        if (c) for (const id of value) if (!c.passives.includes(id)) { c.passives.push(id); notes.push(`패시브 [${passive_name(id)}] 획득`); }
        break;
      case "remove_passives":
        if (c) for (const id of value) if (c.passives.includes(id)) { c.passives.splice(c.passives.indexOf(id), 1); notes.push(`패시브 [${passive_name(id)}] 제거`); }
        break;
      case "give_ally":
        if (c) {
          const a_id = typeof value === "string" ? value : value.id;
          const ai = typeof value === "string" ? "random" : (value.ai_type ?? "random");
          const pat = typeof value === "string" ? null : (value.pattern ?? []);
          const a_data = E.load_ally_data(a_id);
          if (a_data) {
            const ally = new E.Ally(a_data, ai, pat);
            game.allies.push(ally);
            notes.push(`조력자 [${ally.name}]가 합류했습니다!`);
          }
        }
        break;
      case "remove_ally":
        if (c) { game.allies = game.allies.filter((a) => a.id !== value); notes.push(`조력자 [${value}]가 팀을 떠났습니다.`); }
        break;
      case "set_flag": Object.assign((game.profile.flags ??= {}), value); save_profile(); break;
      case "inc_flag": { const f = (game.profile.flags ??= {}); for (const [k, v] of Object.entries(value)) f[k] = (f[k] ?? 0) + v; save_profile(); break; }
      case "dec_flag": { const f = (game.profile.flags ??= {}); for (const [k, v] of Object.entries(value)) f[k] = (f[k] ?? 0) - v; save_profile(); break; }
      case "remove_flag": if (game.profile.flags) delete game.profile.flags[value]; save_profile(); break;
      case "choice_remove_card":
        if (c) {
          flush();
          const t = await ui().pickCard({ title: "제거할 카드를 선택하세요.", items: deck_items(c) });
          if (t) { remove_from_deck(c, t); notes.push(`카드 [${E.load_card(t).name}] 제거 완료.`); }
        }
        break;
      case "choice_duplicate_card":
        if (c) {
          flush();
          const t = await ui().pickCard({ title: "복제할 카드를 선택하세요.", items: deck_items(c) });
          if (t) { c.deck[t] = (c.deck[t] ?? 0) + 1; update_encyclopedia({ player: c }); notes.push(`카드 [${E.load_card(t).name}] 복제 완료.`); }
        }
        break;
      case "choice_upgrade_card":
        if (c) {
          const ups = upgradable_cards(c);
          if (!ups.length) { notes.push("강화할 수 있는 카드가 없습니다."); break; }
          flush();
          const t = await ui().pickCard({ title: "강화할 카드를 선택하세요.", items: deck_items(c, ups) });
          if (t) {
            const new_id = t + "+";
            remove_from_deck(c, t);
            c.deck[new_id] = (c.deck[new_id] ?? 0) + 1;
            update_encyclopedia({ player: c });
            notes.push(`강화 완료: [${E.load_card(t).name}] → [${E.load_card(new_id).name}]`);
          }
        }
        break;
      case "random_remove_card":
        if (c) {
          const all = expand_deck(c);
          const n = Math.min(all.length, value);
          if (n > 0) for (const t of sample(all, n)) { remove_from_deck(c, t); notes.push(`무작위 제거: [${E.load_card(t).name}]`); }
          else notes.push("제거할 카드가 없습니다.");
        }
        break;
      case "random_upgrade_card":
        if (c) {
          const pool = Object.entries(c.deck).filter(([id]) => !id.endsWith("+") && game.data.cards[id + "+"]).flatMap(([id, n]) => Array(n).fill(id));
          const n = Math.min(pool.length, value);
          if (n > 0) {
            for (const t of sample(pool, n)) {
              const new_id = t + "+";
              remove_from_deck(c, t);
              c.deck[new_id] = (c.deck[new_id] ?? 0) + 1;
              notes.push(`무작위 강화: [${E.load_card(t).name}] → [${E.load_card(new_id).name}]`);
            }
            update_encyclopedia({ player: c });
          } else notes.push("강화 가능한 카드가 없습니다.");
        }
        break;
      case "random_duplicate_card":
        if (c) {
          const all = expand_deck(c);
          const n = Math.min(all.length, value);
          if (n > 0) {
            for (const t of sample(all, n)) { c.deck[t] = (c.deck[t] ?? 0) + 1; notes.push(`무작위 복제: [${E.load_card(t).name}]`); }
            update_encyclopedia({ player: c });
          } else notes.push("복제할 카드가 없습니다.");
        }
        break;
      case "achievement":
        if (give_achievement(value)) notes.push(`도전과제 달성! ${value}`);
        break;
      case "level_up": flush(); await handle_level_up(); break;
      case "set_field_theme": game.field_theme = value; game.hooks.bgm(value, { fade_ms: 1000 }); break;
      case "set_basic_battle_theme": game.basic_battle_theme = value; break;
      case "bgm_fade_out": game.hooks.stop_bgm(typeof value === "number" ? value : 2000); break;
      case "bgm_fade_in": if (game.field_theme) game.hooks.bgm(game.field_theme, { fade_ms: typeof value === "number" ? value : 2000 }); break;
      case "schedule":
        for (const [enc_id, delay] of Object.entries(value)) {
          const data = game.data.schedule[enc_id];
          if (data) game.scheduled.push({ after: delay, encounter: data });
          else notes.push(`[오류] 예약된 인카운터를 찾을 수 없습니다: ${enc_id}`);
        }
        break;
      case "sfx": game.hooks.sfx(value); break;
      case "change_name": if (c) { c.name = value; notes.push(`이름이 [${value}](으)로 변경되었습니다.`); } break;
      case "max_cost": if (c) { c.max_cost = Math.max(1, c.max_cost + value); c.current_cost = Math.min(c.max_cost, c.current_cost); notes.push(`최대 빛 ${value >= 0 ? "+" : ""}${value} (현재: ${c.max_cost})`); } break;
      case "card_slot": if (c) { c.card_slot = Math.max(1, c.card_slot + value); notes.push(`최대 슬롯 ${value >= 0 ? "+" : ""}${value} (현재: ${c.card_slot})`); } break;
      case "endurance": case "stagger_endurance":
        if (c) {
          const base = key === "endurance" ? c.base_endurance : c.base_stagger_endurance;
          const cur = key === "endurance" ? c.endurance : c.stagger_endurance;
          for (const [dtype, mod] of Object.entries(value)) {
            const nv = Math.round(Math.max(0.1, (base[dtype] ?? 1.0) + mod) * 10) / 10;
            base[dtype] = nv;
            if (!c.is_staggered) cur[dtype] = nv;
            notes.push(`[${E.DICE_TYPE_MAP[dtype] ?? dtype}] ${key === "endurance" ? "피해" : "흐트러짐"} 내성 ${mod >= 0 ? "+" : ""}${mod} (현재: ${nv}x)`);
          }
        }
        break;
      case "choice_remove_gadget_category":
        if (c) {
          flush();
          const total = value.count ?? 1;
          for (let step = 1; step <= total; step++) {
            const items = Object.entries(c.gadgets)
              .filter(([id, n]) => n > 0 && gadget_cats(id).includes(value.category))
              .map(([id, n]) => ({ id, name: gadget_name(id), count: n }));
            if (!items.length) { if (step === 1) notes.push("보유 중인 가젯이 없거나 조건에 맞는 가젯이 없습니다."); break; }
            const t = await ui().pickGadget({ title: `사용할 ${value.category} 가젯을 선택하세요.`, items, step, total });
            if (!t) break;
            c.remove_gadget(t);
            notes.push(`[${gadget_name(t)}] 제거 완료.`);
          }
        }
        break;
      default: break; // "next" 같은 알 수 없는 키는 main.py처럼 무시
    }
  }
  flush();
}

// ==================================================
// 인카운터 진행
// ==================================================
export async function run_encounter(encounter) {
  let current = encounter.start;
  const visited = new Set();

  for (;;) {
    const node = encounter.nodes[current];
    if (!node) throw new Error(`인카운터 [${encounter.id}]에 노드가 없습니다: ${current}`);

    if (!visited.has(current)) {
      // 노드 진입 효과는 본문을 보여주기 전에 적용(main.py와 동일: 텍스트 출력 후 즉시 적용)
      visited.add(current);
      const pending = apply_effects(node.effects);
      ui().showText?.(node.text);
      await pending;
    }
    if (game.ended) return { type: "end" };
    if (node.end) {
      await ui().node({ text: node.text, choices: [{ text: "계속", chance: null, met: true }] });
      return { type: "end" };
    }

    const choices = get_valid_choices(node);
    if (game.ended) return { type: "end" };
    if (!choices.length) return { type: "end" };

    const view = choices.map((choice) => {
      const branch = (choice.branches ?? []).find((b) => check_requirements(b.requirements));
      let chance = null;
      if (branch && "chance" in branch) chance = calculate_chance(branch);
      else if ("chance" in choice) chance = calculate_chance(choice);
      return { text: choice.text, chance, met: check_requirements(choice.requirements) };
    });

    let select;
    for (;;) {
      select = await ui().node({ text: node.text, choices: view });
      if (select >= 0 && select < choices.length && view[select].met) break;
    }
    const choice = choices[select];

    // 분기(branches)
    let resolved = false;
    for (const branch of choice.branches ?? []) {
      if (!check_requirements(branch.requirements)) continue;
      await apply_effects(branch.effects);
      if (game.ended) return { type: "end" };
      if ("chance" in branch) {
        if (await roll_choice(branch)) { await apply_effects(branch.success_effects); current = branch.success; }
        else { await apply_effects(branch.fail_effects); current = branch.fail; }
      } else if ("next" in branch) current = branch.next;
      else if ("next_main" in branch) return { type: "next_main", target: branch.next_main };
      else if ("ending" in branch) return { type: "ending", name: branch.ending };
      else if (branch.end) return { type: "end" };
      else continue;
      resolved = true;
      break;
    }
    if (resolved) { if (game.ended) return { type: "end" }; continue; }

    await apply_effects(choice.effects);
    if (game.ended) return { type: "end" };

    if ("chance" in choice) {
      if (await roll_choice(choice)) { await apply_effects(choice.success_effects); current = choice.success; }
      else { await apply_effects(choice.fail_effects); current = choice.fail; }
      if (game.ended) return { type: "end" };
      continue;
    }
    if ("next" in choice) { current = choice.next; continue; }
    if ("next_main" in choice) return { type: "next_main", target: choice.next_main };
    if ("ending" in choice) return { type: "ending", name: choice.ending };
    if (choice.end) return { type: "end" };
    // 아무 이동 정보도 없는 선택지: 같은 노드를 다시 보여줌 (main.py와 동일)
  }
}

// ==================================================
// 게임 전체 흐름
// ==================================================
export function reset_game() {
  Object.assign(game, {
    ended: false, ending_name: null, scheduled: [], player_char: null, allies: [], enemies: [],
    field_theme: null, basic_battle_theme: null, fallen_enemy_count: 0, events: [], in_battle: false, cur_units: [],
  });
}

export function init_story(story_name) {
  game.story_name = story_name;
  game.main_encounters = game.data.stories[story_name] ?? {};
  game.common_encounters = game.data.common.slice();
  game.common_deck = shuffle(game.common_encounters.slice());
  game.special_encounters = game.data.special;
  update_encyclopedia({ player: game.player_char });
}

async function run_sub_events(count) {
  for (let i = 0; i < count; i++) {
    tick_scheduled();
    const ready = get_scheduled_ready();
    const enc = ready.length ? rand_choice(ready) : (game.common_deck.shift() ?? null);
    if (!enc) continue;
    await run_encounter(enc);
    if (game.player_char && game.player_char.hp <= 0) {
      game.ended = true;
      game.ending_name = "death_hp";
      return;
    }
  }
}

export async function game_loop() {
  let current_main = "start";
  const total_main = Object.keys(game.main_encounters).length;
  const total_sub_events = game.common_deck.length;
  let mains_played = 0;
  let remaining_sub = total_sub_events;

  for (;;) {
    if (game.player_char) {
      const v_flag = Number(game.profile.flags?.vending_unlocked ?? 0);
      if (v_flag > 0) {
        const pool = game.special_encounters.vending_machine ?? [];
        const enc = pool.find((e) => e.id === `vending_machine${v_flag}`);
        if (enc) {
          await run_encounter(enc);
          if (game.ended) break;
        }
      }
    }

    const encounter = game.main_encounters[current_main];
    if (!encounter) {
      game.ended = true;
      game.ending_name = "missing_main";
      break;
    }

    mains_played += 1;
    const result = await run_encounter(encounter);

    if (game.player_char && game.player_char.hp <= 0) {
      game.ended = true;
      game.ending_name = "사망";
      break;
    }
    if (result.type === "ending") {
      game.ended = true;
      game.ending_name = result.name;
      break;
    }
    if (result.type === "next_main") {
      const gaps_remaining = Math.max(1, total_main - mains_played);
      if (gaps_remaining > 0) {
        const count = Math.floor(remaining_sub / gaps_remaining);
        await run_sub_events(count);
        remaining_sub -= count;
      }
      if (game.ended) break;
      current_main = result.target;
      continue;
    }
    if (game.ended) break;
  }
  return await show_ending();
}

// 엔딩 처리: 사망이면 묘비, 아니면 클리어 기록 (광기: 레벨당 5 획득)
export async function show_ending() {
  const char = game.player_char;
  const dead = !!char && (char.hp <= 0 || char.sanity <= 0);
  const lunacy_gain = char ? Math.max(1, char.level ?? 1) * 5 : 0;
  if (char && lunacy_gain > 0) {
    game.profile.lunacy = (game.profile.lunacy ?? 0) + lunacy_gain;
    save_profile();
  }
  const will = await ui().ending({ name: game.ending_name, dead, lunacy_gain });
  if (!char) return { dead: false };
  if (dead) {
    game.profile.death_count = (game.profile.death_count ?? 0) + 1;
    save_profile();
    game.hooks.save_grave(grave_record(char, will));
  } else {
    game.hooks.save_clear(clear_record(char));
  }
  return { dead };
}

function record_base(char) {
  return {
    name: char.name,
    hp: char.hp, max_hp: char.max_hp, sanity: char.sanity, max_sanity: char.max_sanity,
    stagger_resist: char.stagger_resist,
    endurance: { ...char.base_endurance }, stagger_endurance: { ...char.base_stagger_endurance },
    passives: char.passives.slice(), max_cost: char.max_cost, card_slot: char.card_slot,
    deck: { ...char.deck }, gadgets: { ...char.gadgets },
    date: new Date().toLocaleString("sv-SE"),
  };
}
export const grave_record = (char, will) => ({ ...record_base(char), will });
export const clear_record = (char) => ({ ...record_base(char), level: char.level, story: game.story_name });
