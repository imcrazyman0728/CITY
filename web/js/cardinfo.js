// 카드/효과를 사람이 읽을 문장으로 바꿉니다. (main.py의 show_card_info_battle, format_on_use_effect_kor)
import * as E from "./engine.js";

const status_name = (id) => E.load_status_data(id)?.name ?? id;
export const KIND_KOR = { attack: "공격", defense: "수비", counter: "반격" };

function on_use_lines(effect) {
  if (!effect || typeof effect !== "object") return [];
  const out = [];
  if ("mode_change" in effect) out.push(`${effect.mode_change} 모드로 전환`);
  if ("apply_status" in effect) {
    for (const [id, p] of Object.entries(effect.apply_status)) out.push(`${status_name(id)} 위력 ${p.amount ?? 0}, 횟수 ${p.count ?? 0} 부여`);
  }
  if ("draw_cards" in effect) out.push(`카드 ${effect.draw_cards}장 드로우`);
  if ("recover_cost" in effect) out.push(`빛 ${effect.recover_cost} 회복`);
  if ("remove_status" in effect) out.push(`${status_name(effect.remove_status)} 효과 제거`);
  if ("modify_dice_power" in effect) {
    const p = effect.modify_dice_power;
    const kind = typeof p === "object" ? (p.kind ?? "all") : "all";
    const val = typeof p === "object" ? (p.value ?? 0) : p;
    const kn = kind === "all" ? "모든" : (E.DICE_TYPE_MAP[kind] ?? kind);
    out.push(`이번 턴 동안 ${kn} 주사위 위력 ${val >= 0 ? "+" : ""}${val}`);
  }
  if ("condition_modify_dice_power" in effect) {
    const p = effect.condition_modify_dice_power;
    const who = p.target === "self" ? "자신" : "상대";
    const val = p.value ?? 0;
    const conds = [];
    if ("is_staggered" in p) conds.push(p.is_staggered ? "흐트러진 상태" : "흐트러지지 않은 상태");
    if (p.status_id) conds.push(`${status_name(p.status_id)} ${(p.check ?? "amount") === "amount" ? "위력" : "횟수"} ${p.threshold ?? 0} 이상`);
    out.push(`${who}이(가) ${conds.join(", ") || "조건 없음"}이면 이 카드의 모든 주사위 위력 ${val >= 0 ? "+" : ""}${val}`);
  }
  return out;
}

function dice_effect_lines(entry) {
  if (!entry) return [];
  if (entry === "hand_scaling") return ["위력이 손패의 카드 수만큼 증가"];
  const out = [];
  if (entry.apply_effects) {
    const list = Array.isArray(entry.apply_effects) ? entry.apply_effects : [entry.apply_effects];
    for (const group of list) for (const [id, p] of Object.entries(group)) out.push(`적중 시 ${status_name(id)} 위력 ${p.amount ?? 0}, 횟수 ${p.count ?? 0} 부여`);
  }
  if ("fixed_damage" in entry) out.push(`적중 시 ${entry.fixed_damage} 고정 피해`);
  if ("sanity_damage" in entry) out.push(`적중 시 ${entry.sanity_damage} 정신력 피해`);
  if ("tremor_burst" in entry) out.push("적중 시 진동 폭발");
  if ("heal_hp" in entry) out.push(`적중 시 체력 ${entry.heal_hp} 회복`);
  if ("clash_recover_cost" in entry) out.push(`합 승리 시 빛 ${entry.clash_recover_cost} 회복`);
  if ("clash_fixed_damage" in entry) out.push(`합 승리 시 ${entry.clash_fixed_damage} 고정 피해`);
  if ("clash_fixed_stagger" in entry) out.push(`합 승리 시 ${entry.clash_fixed_stagger} 흐트러짐 피해`);
  if ("clash_give_card_self" in entry) out.push(`합 승리 시 자신의 패에 [${E.load_card(entry.clash_give_card_self).name}] 생성`);
  if ("clash_give_card_target" in entry) out.push(`합 승리 시 상대의 패에 [${E.load_card(entry.clash_give_card_target).name}] 생성`);
  if (entry.generate_card) {
    const g = entry.generate_card;
    const id = g.card_id ?? g.self ?? g.opponent;
    const toSelf = g.self !== undefined || (g.target ?? "self") === "self";
    if (id) out.push(`적중 시 ${toSelf ? "자신" : "상대"}의 패에 [${E.load_card(id).name}] 생성`);
  }
  if ("gun" in entry) out.push(`탄환 ${entry.gun}발 소모`);
  if (entry.hand_scaling) out.push("위력이 손패의 카드 수만큼 증가");
  return out;
}

export function describe_card(card) {
  const uses = (card.on_use_effect ?? []).flatMap(on_use_lines);
  const dice = (card.dice ?? []).map((d) => ({
    kind: d.type,
    kind_label: KIND_KOR[d.type] ?? d.type,
    damage_type: d.damage_type,
    type_label: E.DICE_TYPE_MAP[d.damage_type] ?? d.damage_type,
    min: d.min, max: d.max,
    notes: (d.dice_effect ?? []).flatMap(dice_effect_lines),
    has_gun: (d.dice_effect ?? []).some((e) => e && typeof e === "object" && "gun" in e),
  }));
  return {
    id: card.id, name: card.name, cost: card.cost,
    type: card.type, type_label: E.CARD_TYPE_MAP[card.type] ?? card.type,
    grade: card.grade, grade_label: E.CARD_GRADE_MAP[card.grade] ?? card.grade,
    uses, dice,
    dialogue: card.on_use_dialogue ? card.on_use_dialogue.split("{card_user}").join("나").replace(/\u001b\[\d+m/g, "") : "",
  };
}
