import json
import os
import random
import sys
import time
from pathlib import Path

try:
    import pygame
except ImportError:
    pygame = None

# PyInstaller 배포 환경 대응
# BASE_DIR : 읽기 전용 리소스(cards, enemy, mus ...)  / DATA_DIR : 실행 후에도 남아야 하는 저장 데이터
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
    DATA_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent
    DATA_DIR = BASE_DIR

GRAVES_DIR = DATA_DIR / "graves"
CLEARS_DIR = DATA_DIR / "clears"

_AUDIO_ENABLED = pygame is not None


def pause():
    input("\n엔터를 눌러 계속...")


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


# ==================================================
# 오디오 시스템 (BGM / SFX)
# ==================================================

def play_sfx(filename):
    """sfx 폴더에서 효과음을 재생합니다."""
    global _AUDIO_ENABLED
    if not _AUDIO_ENABLED or not filename:
        return

    clean_name = filename.replace("counter_", "")
    if not clean_name.endswith(".wav"):
        clean_name += ".wav"

    path = BASE_DIR / "sfx" / clean_name
    if not path.exists():
        return

    try:
        if not pygame.mixer.get_init():
            try:
                pygame.mixer.init()
            except Exception:
                _AUDIO_ENABLED = False
                return
        pygame.mixer.Sound(str(path)).play()
    except Exception:
        _AUDIO_ENABLED = False


def trigger_win_sfx(dice):
    """합 승리 시 roll.wav를 재생하고 0.1초 후 주사위 SFX를 재생합니다."""
    play_sfx("roll.wav")
    time.sleep(0.1)

    sfx_file = dice.get("sfx")
    if sfx_file:
        play_sfx(sfx_file)
    else:
        dtype = dice.get("damage_type", "slash")
        play_sfx(dtype)


_BGM_VOLUME = 0.5


def set_bgm_volume(volume):
    """BGM 볼륨을 조절합니다 (0.0 ~ 1.0)."""
    global _BGM_VOLUME, _AUDIO_ENABLED
    if not _AUDIO_ENABLED:
        return

    # 0.0과 1.0 사이 값으로 제한
    _BGM_VOLUME = max(0.0, min(1.0, float(volume)))

    try:
        if pygame.mixer.get_init():
            pygame.mixer.music.set_volume(_BGM_VOLUME)
    except Exception:
        pass


def play_bgm(filename, loop=-1, fade_ms=0, volume=None):
    """mus 폴더에서 배경 음악을 재생합니다."""
    global _AUDIO_ENABLED, _BGM_VOLUME
    if not _AUDIO_ENABLED or not filename:
        return

    clean_name = filename
    if not (clean_name.endswith(".wav") or clean_name.endswith(".mp3")):
        clean_name += ".wav"

    path = BASE_DIR / "mus" / clean_name
    if not path.exists():
        return

    try:
        if not pygame.mixer.get_init():
            try:
                pygame.mixer.init()
            except Exception:
                _AUDIO_ENABLED = False
                return

        pygame.mixer.music.load(str(path))

        # 지정된 볼륨이 있으면 우선 적용, 없으면 기본 설정된 볼륨 적용
        current_vol = volume if volume is not None else _BGM_VOLUME
        pygame.mixer.music.set_volume(max(0.0, min(1.0, float(current_vol))))

        try:
            pygame.mixer.music.play(loop, 0.0, fade_ms)
        except TypeError:
            pygame.mixer.music.play(loop)
    except Exception:
        _AUDIO_ENABLED = False


def stop_bgm(fade_ms=0):
    """배경 음악을 정지합니다."""
    global _AUDIO_ENABLED
    if not _AUDIO_ENABLED:
        return
    try:
        if pygame.mixer.get_init():
            pygame.mixer.music.fadeout(fade_ms)
    except Exception:
        pass


# ==================================================
# 캐싱 및 데이터 로더
# ==================================================

PASSIVE_CACHE = {}
STATUS_CACHE = {}
PANIC_CACHE = {}
GADGET_CACHE = {}
CARD_DATA_CACHE = {}

DICE_TYPE_MAP = {
    "slash": "참격",
    "pierce": "관통",
    "blunt": "타격",
    "block": "방어",
    "evade": "회피",
    "counter_slash": "반격-참격",
    "counter_pierce": "반격-관통",
    "counter_blunt": "반격-타격",
    "counter_block": "반격-방어",
    "counter_evade": "반격-회피",
}

CARD_TYPE_MAP = {
    "melee": "근거리",
    "ranged": "원거리",
    "on_play": "즉시 발동",
}

CARD_GRADE_MAP = {
    "paperback": "보급",
    "hardcover": "고급",
    "limited": "한정",
    "objet_d'art": "예술",
}


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"\n[오류] JSON 파싱 실패: {path}")
        print(f"이유: {e.msg} (줄: {e.lineno}, 열: {e.colno})")
        return None
    except Exception as e:
        print(f"\n[오류] 파일 읽기 실패: {path}")
        print(f"상세: {e}")
        return None


def get_card_data_internal(card_id):
    if card_id in CARD_DATA_CACHE:
        return CARD_DATA_CACHE[card_id]
    path = BASE_DIR / "cards" / f"{card_id}.json"
    data = load_json(path)
    if data:
        data["id"] = card_id  # JSON 안의 id가 파일명과 달라도 파일명을 기준으로 통일
        CARD_DATA_CACHE[card_id] = data
    return data


def load_passive_data(p_id):
    if p_id in PASSIVE_CACHE:
        return PASSIVE_CACHE[p_id]
    path = BASE_DIR / "passives" / f"{p_id}.json"
    if path.exists():
        data = load_json(path)
        PASSIVE_CACHE[p_id] = data
        return data
    return None


def load_status_data(s_id):
    if s_id in STATUS_CACHE:
        return STATUS_CACHE[s_id]
    path = BASE_DIR / "status" / f"{s_id}.json"
    if path.exists():
        data = load_json(path)
        STATUS_CACHE[s_id] = data
        return data
    return None


def load_panic_data(p_id):
    if p_id in PANIC_CACHE:
        return PANIC_CACHE[p_id]
    path = BASE_DIR / "panics" / f"{p_id}.json"
    if path.exists():
        data = load_json(path)
        PANIC_CACHE[p_id] = data
        return data
    return None


def load_gadget_data(g_id):
    if g_id in GADGET_CACHE:
        return GADGET_CACHE[g_id]
    path = BASE_DIR / "gadgets" / f"{g_id}.json"
    if path.exists():
        data = load_json(path)
        GADGET_CACHE[g_id] = data
        return data
    return None


def load_ally_data(ally_id):
    path = BASE_DIR / "ally" / f"{ally_id}.json"
    if not path.exists():
        path = BASE_DIR / "enemy" / f"{ally_id}.json"
    return load_json(path)


def load_enemy(enemy_id):
    path = BASE_DIR / "enemy" / f"{enemy_id}.json"
    if not path.exists():
        found = list((BASE_DIR / "enemy").rglob(f"{enemy_id}.json"))
        if not found:
            raise Exception(f"적 없음 : {enemy_id}")
        path = found[0]
    data = load_json(path)
    if not data:
        raise Exception(f"적 데이터를 불러올 수 없습니다 (JSON 오류): {enemy_id}")
    return data


# ==================================================
# 전투 규칙 및 패시브/효과 로직
# ==================================================

def unit_cannot_equip(unit):
    """유닛이 패닉 등의 효과로 인해 카드를 장착할 수 없는 상태인지 확인합니다."""
    if not unit:
        return False
    if getattr(unit, "is_panicked", False):
        for effect in getattr(unit, "active_panic_effects", []):
            if effect.get("trigger") in ["cannot_equip", "cannot_equip_card"] or effect.get("action") in ["cannot_equip", "prevent_equip"] or (effect.get("trigger") == "equip_card" and effect.get("action") == "prevent"):
                return True
    return False


def apply_panic_effects(unit):
    """유닛의 정신력 수치에 따라 패닉 효과를 활성화하거나 해제합니다."""
    if not unit or not unit.panic_type:
        return

    data = load_panic_data(unit.panic_type)
    if not data:
        return

    if unit.sanity <= 0:
        if not unit.is_panicked:
            unit.active_panic_effects = data.get("panic_effects", data.get("effects", []))
            unit.is_panicked = True
            unit.is_low_morale = False
            unit.panicked_turns_remaining = 1
            print(f"\n[패닉] {unit.name}의 정신이 붕괴되어 패닉 상태에 빠졌습니다!")
    elif unit.sanity <= unit.max_sanity / 2:
        if not unit.is_low_morale:
            unit.active_panic_effects = data.get("low_morale_effects", [])
            unit.is_low_morale = True
            unit.is_panicked = False
            print(f"\n[사기저하] {unit.name}의 사기가 꺾였습니다!")
    else:
        if unit.is_panicked or unit.is_low_morale:
            unit.active_panic_effects = []
            unit.is_panicked = False
            unit.is_low_morale = False


def check_passive_condition(condition, context):
    if not condition:
        return True
    for key, target_val in condition.items():
        if target_val == "all":
            continue
        ctx_val = context.get(key)
        # 리스트 조건 지원 (예: status_id: ["burn", "sinking"])
        if isinstance(target_val, list):
            if ctx_val not in target_val:
                return False
        else:
            if ctx_val != target_val:
                return False
    return True


def execute_passive_logic(effect, unit, value=None, target=None):
    action = effect.get("action")
    val = effect.get("value", 0)
    var_name = effect.get("variable")

    if action == "damage_self":
        unit.take_damage(val, 0)
    elif action == "add_value":
        return (value or 0) + val
    elif action == "recover_hp":
        unit.change_hp(val)
    elif action == "recover_sanity":
        unit.change_sanity(val)
    elif action == "set_var":
        unit.passive_vars[var_name] = val
    elif action == "inc_var":
        unit.passive_vars[var_name] = unit.passive_vars.get(var_name, 0) + val
    elif action == "add_var_value":
        return (value or 0) + unit.passive_vars.get(var_name, 0)
    elif action == "apply_status":
        s_id = effect.get("status_id")
        s_amount = effect.get("amount", 0)
        s_count = effect.get("count", 0)
        goal = target if target else unit
        goal.apply_status(s_id, s_amount, s_count)
    return value


def execute_status_modify_logic(effect, unit, s_id, state, value, context):
    """상태이상에 정의된 수치 변경 액션을 실행합니다."""
    action = effect.get("action")
    val = effect.get("value", 0)

    # 문자열 "-1", "2" 등이 들어와도 숫자로 안전하게 변환
    try:
        if isinstance(val, str):
            val = float(val) if "." in val else int(val)
    except (ValueError, TypeError):
        pass

    # 1. 주사위 위력 증감 액션
    if action in ["modify_roll", "add_value"]:
        return (value or 0) + val

    # 2. 상태이상 부여 위력 곱연산 (배율)
    elif action == "multiply_amount":
        return int((value or 0) * val)

    # 3. 상태이상 부여 위력 합연산
    elif action == "add_amount":
        return (value or 0) + val

    return value


def trigger_status_modify(unit, hook, value, context):

    if not unit or not getattr(unit, "statuses", None):
        return value

    new_value = value
    for s_id, state in list(unit.statuses.items()):
        data = load_status_data(s_id)
        if not data or "effects" not in data:
            continue
        for effect in data["effects"]:
            if effect.get("trigger") == hook:
                if check_passive_condition(effect.get("condition"), context):
                    new_value = execute_status_modify_logic(effect, unit, s_id, state, new_value, context)

    return new_value

def apply_on_use_effects(unit, card, target=None):
    if not card or not card.on_use_effect:
        return

    for effect in card.on_use_effect:
        if not effect:
            continue

        if "draw_cards" in effect:
            amount = effect["draw_cards"]
            draw_cards(unit, amount)
            print(f"[{unit.name}] 효과로 카드 {amount}장 드로우!")

        if "recover_cost" in effect:
            amount = effect["recover_cost"]
            unit.current_cost = min(unit.max_cost, unit.current_cost + amount)
            print(f"[{unit.name}] 효과로 빛 {amount} 회복! (현재: {unit.current_cost}/{unit.max_cost})")

        if "apply_status" in effect:
            for s_id, params in effect["apply_status"].items():
                unit.apply_status(s_id, params.get("amount", 0), params.get("count", 0))

        if "remove_status" in effect:
            s_id = effect["remove_status"]
            if s_id in unit.statuses:
                s_data = load_status_data(s_id)
                s_name = s_data["name"] if s_data else s_id
                del unit.statuses[s_id]
                print(f"[{unit.name}] {s_name} 효과 제거!")

        if "mode_change" in effect:
            mode_key = effect["mode_change"]
            for container in [unit.hand, unit.equipped]:
                for i in range(len(container)):
                    if container[i] and mode_key in container[i].mode_change:
                        new_id = container[i].mode_change[mode_key]
                        container[i] = load_card(new_id)

            for pile in [unit.draw_pile, unit.discard_pile]:
                for i in range(len(pile)):
                    c_id = pile[i]
                    c_data = get_card_data_internal(c_id)
                    if c_data and "mode_change" in c_data and mode_key in c_data["mode_change"]:
                        pile[i] = c_data["mode_change"][mode_key]


            print(f"\n[{unit.name}] {mode_key} 모드로 전환! 현재 전투에서 일부 카드가 변환되었습니다.")

        if "modify_dice_power" in effect:
            params = effect["modify_dice_power"]
            if isinstance(params, dict):
                p_kind = params.get("kind", "all")
                p_val = params.get("value", 0)
            else:
                p_kind = "all"
                p_val = params

            unit.dice_power_modifiers[p_kind] = unit.dice_power_modifiers.get(p_kind, 0) + p_val
            kind_name = DICE_TYPE_MAP.get(p_kind, "모든") if p_kind != "all" else "모든"
            print(f"[{unit.name}] 효과로 이번 턴 동안 {kind_name} 주사위 위력 {p_val:+}!")

        if "condition_modify_dice_power" in effect:
            params = effect["condition_modify_dice_power"]
            dest = params.get("target", "opponent")  # "self", "target", "opponent"
            p_val = params.get("value", 0)

            # 대상 유닛 결정 (self면 자신, 아니면 상대 target)
            goal = unit if dest == "self" else target

            if goal:
                condition_met = True
                reasons = []

                # 1. 흐트러짐 조건 검사
                if "is_staggered" in params:
                    required_stagger = params["is_staggered"]
                    if getattr(goal, "is_staggered", False) != required_stagger:
                        condition_met = False
                    else:
                        reasons.append("흐트러짐 상태" if required_stagger else "비흐트러짐 상태")

                # 2. 상태이상 조건 검사 (status_id가 있는 경우)
                if condition_met and "status_id" in params:
                    s_id = params["status_id"]
                    check_type = params.get("check", "amount")
                    threshold = params.get("threshold", 0)
                    current_stat = goal.statuses.get(s_id, {}).get(check_type, 0)
                    if current_stat < threshold:
                        condition_met = False
                    else:
                        s_data = load_status_data(s_id)
                        s_name = s_data["name"] if s_data else s_id
                        check_name = "위력" if check_type == "amount" else "횟수"
                        reasons.append(f"{s_name} {check_name} {current_stat}>={threshold}")

                # 모든 조건 충족 시 위력 적용
                if condition_met:
                    unit.card_dice_power_modifier += p_val
                    dest_name = "자신" if dest == "self" else f"[{goal.name}]"
                    reason_text = ", ".join(reasons)
                    print(f"[{unit.name}] 조건 만족! ({dest_name} {reason_text}) -> 이 카드의 주사위 위력 {p_val:+}!")


def apply_dice_effects(attacker, target, dice):
    if not target or not dice:
        return
    effects = dice.get("dice_effect", [])
    for effect_entry in effects:
        if not effect_entry:
            continue

        if "apply_effects" in effect_entry:
            apply_effs = effect_entry["apply_effects"]
            if isinstance(apply_effs, dict):
                apply_effs = [apply_effs]
            for status_data in apply_effs:
                if isinstance(status_data, dict):
                    for s_id, params in status_data.items():
                        amt = params.get("amount", 0)
                        cnt = params.get("count", 0)

                        # [신규] 공격자 상태이상 효과에 따른 상태이상 부여 위력 보정 (예: 배율 2배 등)
                        if attacker:
                            amt = trigger_status_modify(attacker, "on_status_apply", amt, {"status_id": s_id})

                        target.apply_status(s_id, amt, cnt)

        if "fixed_damage" in effect_entry:
            target.take_damage(effect_entry["fixed_damage"], 0)

        if "sanity_damage" in effect_entry:
            target.change_sanity(-effect_entry["sanity_damage"])

        if "tremor_burst" in effect_entry:
            tremor = target.statuses.get("tremor")
            if tremor and tremor["amount"] > 0:
                t_dmg = tremor["amount"]
                print(f"[{target.name}] 진동 폭발! {t_dmg} 흐트러짐 피해!")
                target.take_damage(0, t_dmg)
                tremor["count"] -= 1
                if tremor["count"] <= 0:
                    del target.statuses["tremor"]

        if "heal_hp" in effect_entry:
            heal_amt = effect_entry["heal_hp"]
            recovered = attacker.change_hp(heal_amt)
            if recovered > 0:
                print(f"[{attacker.name}] 적중 효과로 체력 {recovered} 회복!")

        if "generate_card" in effect_entry:
            gen_data = effect_entry["generate_card"]
            if isinstance(gen_data, dict):
                dest = gen_data.get("target", "self")
                card_id = gen_data.get("card_id")
                if "self" in gen_data:
                    dest, card_id = "self", gen_data["self"]
                elif "opponent" in gen_data:
                    dest, card_id = "target", gen_data["opponent"]

                receiver = attacker if dest == "self" else target
                if card_id and receiver is not None:
                    new_card = load_card(card_id)
                    receiver.hand.append(new_card)
                    dest_text = "패" if dest == "self" else f"[{target.name}]의 패"
                    print(f"[{attacker.name}] 적중 효과로 {dest_text}에 [{new_card.name}] 생성!")


def apply_clash_win_effects(winner, loser, dice):
    if not loser or not dice:
        return
    effects = dice.get("dice_effect", [])
    for effect_entry in effects:
        if not effect_entry:
            continue

        if "clash_recover_cost" in effect_entry:
            val = effect_entry["clash_recover_cost"]
            winner.current_cost = min(winner.max_cost, winner.current_cost + val)
            print(f"[{winner.name}] 합 승리 효과로 빛 {val} 회복!")

        hp_dmg = effect_entry.get("clash_fixed_damage", 0)
        stagger_dmg = effect_entry.get("clash_fixed_stagger", 0)
        if hp_dmg > 0 or stagger_dmg > 0:
            print(f"[{winner.name}] 합 승리 효과!")
            loser.take_damage(hp_dmg, stagger_dmg)

        if "clash_give_card_self" in effect_entry:
            c_id = effect_entry["clash_give_card_self"]
            new_card = load_card(c_id)
            winner.hand.append(new_card)
            print(f"[{winner.name}] 합 승리 효과로 패에 [{new_card.name}] 생성!")

        if "clash_give_card_target" in effect_entry:
            c_id = effect_entry["clash_give_card_target"]
            new_card = load_card(c_id)
            loser.hand.append(new_card)
            print(f"[{winner.name}] 합 승리 효과로 [{loser.name}]의 패에 [{new_card.name}] 생성!")


def check_and_consume_gun_cost(unit, dice):
    effects = dice.get("dice_effect", [])
    for effect_entry in effects:
        if effect_entry and "gun" in effect_entry:
            cost = effect_entry["gun"]
            bullet_status = unit.statuses.get("bullet")
            if not bullet_status or bullet_status.get("amount", 0) < cost:
                return False

            bullet_status["amount"] -= cost
            print(f"[{unit.name}] 탄환 {cost}발 소모! (남은 탄환: {bullet_status['amount']})")
            if bullet_status["amount"] <= 0:
                del unit.statuses["bullet"]
    return True


def execute_status_logic(effect, unit, s_id, state):
    action = effect.get("action")
    val = effect.get("value", 0)

    if val == "amount":
        val = state["amount"]
    elif val == "count":
        val = state["count"]

    data = load_status_data(s_id)
    name = data["name"] if data else s_id

    if action == "damage_self":
        print(f"{name} 피해 {val}!")
        unit.take_damage(val, 0, trigger_hit=False)
    elif action == "damage_sanity":
        print(f"{name} 효과로 정신력 피해 {val}!")
        unit.change_sanity(-val)
    elif action == "inc_count":
        state["count"] += val
    elif action == "inc_amount":
        state["amount"] += val
    elif action == "recover_hp":
        print(f"{name} 효과로 체력 회복!")
        unit.change_hp(val)


def trigger_passive_action(unit, hook, context, *args):
    if not unit:
        return
    target = args[0] if args else None
    for p_id in unit.passives:
        data = load_passive_data(p_id)
        if not data or "effects" not in data:
            continue
        for effect in data["effects"]:
            if effect.get("trigger") == hook:
                if check_passive_condition(effect.get("condition"), context):
                    execute_passive_logic(effect, unit, target=target)

    for effect in unit.active_panic_effects:
        if effect.get("trigger") == hook:
            if check_passive_condition(effect.get("condition"), context):
                execute_passive_logic(effect, unit, target=target)


def trigger_passive_modify(unit, hook, value, context, *args):
    if not unit:
        return value
    new_value = value
    target = args[0] if args else None
    for p_id in unit.passives:
        data = load_passive_data(p_id)
        if not data or "effects" not in data:
            continue
        for effect in data["effects"]:
            if effect.get("trigger") == hook:
                if check_passive_condition(effect.get("condition"), context):
                    new_value = execute_passive_logic(effect, unit, value=new_value, target=target)

    for effect in unit.active_panic_effects:
        if effect.get("trigger") == hook:
            if check_passive_condition(effect.get("condition"), context):
                new_value = execute_passive_logic(effect, unit, value=new_value, target=target)

    return new_value


def trigger_status_effect(unit, hook, context):
    if not unit:
        return

    to_remove = []
    for s_id, state in list(unit.statuses.items()):
        data = load_status_data(s_id)
        if not data or "effects" not in data:
            continue
        for effect in data["effects"]:
            if effect.get("trigger") == hook:
                execute_status_logic(effect, unit, s_id, state)

        if state["amount"] <= 0 or state["count"] <= 0:
            to_remove.append(s_id)

    for s_id in to_remove:
        del unit.statuses[s_id]


# ==================================================
# 유닛 및 엔티티 클래스
# ==================================================

class Unit:
    """플레이어, 조력자, 적의 공통 전투 기능을 담당하는 부모 클래스"""
    def __init__(self, data):
        status = data.get("status", data) if isinstance(data, dict) else data
        self.name = status.get("name", "Unknown")
        self.max_hp = status.get("max_hp", status.get("hp", 0))
        self.hp = status.get("hp", self.max_hp)
        self.max_sanity = status.get("max_sanity", status.get("sanity", 0))
        self.sanity = status.get("sanity", self.max_sanity)
        self.stagger_resist = status.get("stagger_resist", 20)
        self.current_stagger = self.stagger_resist
        self.is_staggered = False
        self.staggered_turns_remaining = 0

        default_resist = {"slash": 1.0, "pierce": 1.0, "blunt": 1.0}
        self.endurance = {**default_resist, **status.get("endurance", {})}
        self.stagger_endurance = {**default_resist, **status.get("stagger_endurance", {})}
        self.base_endurance = self.endurance.copy()
        self.base_stagger_endurance = self.stagger_endurance.copy()

        self.passives = status.get("passives", [])
        self.deck = status.get("deck", {})
        self.max_cost = status.get("max_cost", 3)
        self.current_cost = self.max_cost
        self.card_slot = status.get("card_slot", 1)
        self.hand = []
        self.equipped = []
        self.speed = status.get("speed", {"min": 1, "max": 5})
        self.slot_speeds = []
        self.draw_pile = []
        self.targets = []
        self.discard_pile = []
        self.saved_counter = []
        self.saved_defense = []
        self.passive_vars = {}
        self.statuses = {}
        self.level = status.get("level", 1)
        self.exp = status.get("exp", 0)
        self.card_pool = status.get("card_pool", [])
        self.dice_power_modifiers = {}
        self.gadgets = {}
        self.panic_type = status.get("panic_type")
        self.active_panic_effects = []
        self.is_panicked = False
        self.is_low_morale = False
        self.panicked_turns_remaining = 0
        self.card_dice_power_modifier = 0  # 해당 카드 한정 위력 보정치

    def change_hp(self, amount):
        old_hp = self.hp
        if amount < 0:
            self.take_damage(abs(amount), 0)
        else:
            self.hp = min(self.max_hp, self.hp + amount)
        return self.hp - old_hp

    def take_damage(self, hp_dmg, stagger_dmg, trigger_hit=True):
        self.hp = max(0, self.hp - hp_dmg)
        self.current_stagger = max(0, self.current_stagger - stagger_dmg)
        if hp_dmg > 0:
            print(f"{self.name}에게 {hp_dmg} 피해!")
        if stagger_dmg > 0:
            print(f"{self.name}에게 {stagger_dmg} 흐트러짐 피해!")

        # 상태이상 자해 등(trigger_hit=False)에서는 재귀 호출 방지
        if trigger_hit and (hp_dmg > 0 or stagger_dmg > 0):
            trigger_status_effect(self, "on_hit_received", {})

        if self.current_stagger <= 0 and not self.is_staggered:
            activate_stagger(self)

    def recover_stagger(self, amount):
        self.current_stagger = min(self.stagger_resist, self.current_stagger + amount)
        print(f"{self.name} 흐트러짐 {amount} 회복!")

    def apply_status(self, s_id, amount, count):
        data = load_status_data(s_id)
        name = data["name"] if data else s_id
        print(f"{name} 위력 {amount} 횟수 {count} 부여!")

        if s_id in self.statuses:
            self.statuses[s_id]["amount"] += amount
            self.statuses[s_id]["count"] += count
        else:
            self.statuses[s_id] = {"amount": amount, "count": count}

    def change_sanity(self, amount):
        old_sanity = self.sanity
        self.sanity = max(0, min(self.sanity + amount, self.max_sanity))
        if self.sanity != old_sanity:
            print(f"{self.name} 정신력 {amount:+d}!")
            apply_panic_effects(self)
        return self.sanity - old_sanity

    def gain_exp(self, amount):
        if amount <= 0:
            return
        self.exp += amount
        print(f"\n[{self.name}] 경험치 {amount} 획득! (현재: {self.exp}/10)")
        if self.exp >= 10:
            pause()
        while self.exp >= 10:
            self.exp -= 10
            handle_level_up()


class PlayerChar(Unit):
    def __init__(self, data):
        super().__init__(data)
        self.id = data.get("id", "player")

    def add_gadget(self, item, amount=1):
        self.gadgets[item] = self.gadgets.get(item, 0) + amount

    def gadget_count(self, item):
        return self.gadgets.get(item, 0)

    def has_gadget(self, item):
        return item in self.gadgets

    def remove_gadget(self, item, amount=1):
        if item not in self.gadgets:
            return
        self.gadgets[item] -= amount
        if self.gadgets[item] <= 0:
            del self.gadgets[item]


class Ally(Unit):
    def __init__(self, data, ai_type="random", pattern=None):
        super().__init__(data)
        self.id = data.get("id", "ally")
        self.ai_type = ai_type  # "random", "pattern", "controllable"
        self.pattern = pattern or []
        self.pattern_index = 0
        self.faction = "player"


class Enemy(Unit):
    def __init__(self, data):
        super().__init__(data)
        self.id = data.get("id", "enemy")
        status = data.get("status", {})
        self.faction = "enemy"
        self.appear = status.get("appear", "")
        self.dialogue_lines = status.get("dialogue_lines", {})


# ==================================================
# 게임 상태 관리
# ==================================================

class Game:
    def __init__(self):
        self.player_profile = {"death_count": 0, "achievements": []}
        self.profile = {"death_count": 0, "achievements": []}
        self.common_deck = []
        self.story_name = None
        self.main_encounters = {}
        self.common_encounters = []
        self.special_encounters = {}
        self.scheduled = []
        self.ended = False
        self.ending_name = None
        self.seen_encounters = set()
        self.player_char = None
        self.field_theme = None
        self.allies = []
        self.enemies = []
        self.basic_battle_theme = None
        self.fallen_enemy_count = 0  # 이번 전투에서 쓰러진 적 수 (적 진영의 has_dead_ally 판단용)


game = Game()


def show_status():
    char = game.player_char
    if not char:
        return

    print("\n" + "=" * 40)
    print(f"이름 : {char.name}")
    print(f"HP   : {char.hp} / {char.max_hp}")
    print(f"SAN  : {char.sanity} / {char.max_sanity}")
    print(f"흐트러짐 저항 : {char.current_stagger} / {char.stagger_resist}")
    print(f"총 카드 수 : {sum(char.deck.values())}장")
    print("\n가젯:")
    if not char.gadgets:
        print("없음")
    else:
        for g_id, count in char.gadgets.items():
            g_data = load_gadget_data(g_id)
            display_name = g_data.get("name", g_id) if g_data else g_id
            print(f"- {display_name} x{count}")
    print("=" * 40)


def show_detailed_status():
    show_status()
    pause()


# ==================================================
# 시나리오 및 인카운터 로더
# ==================================================

def get_story_list():
    path = BASE_DIR / "encounter_main"
    result = []
    if not path.exists():
        return result
    for folder in path.iterdir():
        if folder.is_dir():
            result.append(folder.name)
    return result


def choose_story():
    stories = get_story_list()
    if not stories:
        print("스토리가 없습니다.")
        quit()

    print("\n스토리 선택\n")
    for i, story in enumerate(stories, start=1):
        print(f"{i}. {story}")

    while True:
        try:
            choice = int(input("\n> ")) - 1
            if 0 <= choice < len(stories):
                selected = stories[choice]
                game.story_name = selected
                return selected
        except (ValueError, IndexError):
            pass


def load_main_story(story_name):
    path = BASE_DIR / "encounter_main" / story_name
    encounters = {}
    for file in path.glob("*.json"):
        data = load_json(file)
        if data and "id" in data:
            encounters[data["id"]] = data
        else:
            print(f"경고: {file.name} 로드 실패 (데이터 누락)")
    return encounters


def load_common_encounters():
    path = BASE_DIR / "encounter_normal" / "common"
    result = []
    if not path.exists():
        return result
    for file in path.glob("*.json"):
        data = load_json(file)
        if data:
            result.append(data)
    return result


def load_special_encounters():
    root = BASE_DIR / "encounter_normal"
    result = {}
    if not root.exists():
        return result

    for folder in root.iterdir():
        if not folder.is_dir() or folder.name == "common":
            continue
        encounters = []
        for file in folder.glob("*.json"):
            data = load_json(file)
            if data:
                encounters.append(data)
        result[folder.name] = encounters
    return result


# ==================================================
# 전투 시스템 세부 구현
# ==================================================

def activate_stagger(unit):
    if unit.is_staggered:
        return
    unit.current_stagger = 0
    unit.is_staggered = True
    unit.staggered_turns_remaining = 1
    unit.endurance = {dtype: 2.0 for dtype in unit.endurance}
    unit.stagger_endurance = {dtype: 2.0 for dtype in unit.stagger_endurance}


def ensure_staggered(unit):
    if unit.current_stagger <= 0 and not unit.is_staggered:
        activate_stagger(unit)


def begin_turn(unit):
    unit.dice_power_modifiers = {}
    ensure_staggered(unit)

    if getattr(unit, "faction", "player") == "enemy":
        has_dead = game.fallen_enemy_count > 0
    else:
        allies_to_check = [game.player_char] + game.allies
        has_dead = any(a.hp <= 0 for a in allies_to_check if a)
    trigger_passive_action(unit, "on_turn_start", {"has_dead_ally": has_dead})

    if unit.is_panicked:
        if getattr(unit, "panicked_turns_remaining", 0) > 0:
            unit.panicked_turns_remaining -= 1
        else:
            print(f"\n{unit.name} 패닉에서 회복, 정신력을 최대로 회복합니다.")
            unit.is_panicked = False
            unit.panicked_turns_remaining = 0
            unit.change_sanity(unit.max_sanity)

    apply_panic_effects(unit)

    if not unit.is_staggered:
        return

    if unit.staggered_turns_remaining > 0:
        unit.staggered_turns_remaining -= 1
        return

    unit.current_stagger = unit.stagger_resist
    unit.endurance = unit.base_endurance.copy()
    unit.stagger_endurance = unit.base_stagger_endurance.copy()
    unit.is_staggered = False
    unit.staggered_turns_remaining = 0


def roll_dice(dice, unit=None, kind="all"):
    context = {"kind": kind, "dmg_type": dice.get("damage_type", "all")}
    if unit is not None:
        trigger_passive_action(unit, "on_roll", context, dice)
        trigger_status_effect(unit, "on_roll", context)
        ensure_staggered(unit)
        if unit.is_staggered:
            return 0

    min_val = dice["min"]
    max_val = dice["max"]

    if unit is not None:
        max_val = trigger_passive_modify(unit, "modify_max_roll", max_val, context)

    roll = random.randint(min_val, max(min_val, max_val))

    if unit is not None:
        roll = trigger_passive_modify(unit, "modify_roll", roll, context)
        roll = trigger_status_modify(unit, "on_roll", roll, context)

        bonus = unit.dice_power_modifiers.get("all", 0)
        dmg_type = dice.get("damage_type", "all")
        if dmg_type != "all":
            bonus += unit.dice_power_modifiers.get(dmg_type, 0)
        roll += bonus
        roll += getattr(unit, "card_dice_power_modifier", 0)

        if "strength" in unit.statuses:
            if dice.get("type") in ["attack", "counter"] or kind in ["attack", "counter"]:
                roll += unit.statuses["strength"]["amount"]

        effects = dice.get("dice_effect", [])
        has_hand_scaling = False
        for effect_entry in effects:
            if effect_entry and ((isinstance(effect_entry, dict) and "hand_scaling" in effect_entry) or effect_entry == "hand_scaling"):
                has_hand_scaling = True
                break
        if has_hand_scaling or dice.get("hand_scaling"):
            roll += len(getattr(unit, "hand", []))

    return max(0, roll)


def calc_damage(value, damage_type, target, attacker=None):
    resist = target.endurance.get(damage_type, 1.0)
    dmg = int(value * resist)

    if attacker:
        context = {"kind": "attack", "dmg_type": damage_type}
        dmg = trigger_passive_modify(attacker, "modify_damage_dealt", dmg, context, target)

        poise = attacker.statuses.get("poise")
        if poise and poise["amount"] > 0:
            if random.randint(1, 100) <= poise["amount"] * 5:
                print(f"[{attacker.name}] 크리티컬!")
                dmg = int(dmg * 1.2)
                poise["count"] -= 1 # 크리티컬 적중 시 횟수 차감
                if poise["count"] <= 0:
                    del attacker.statuses["poise"]

    return max(0, dmg)  #


def calc_stagger_damage(value, damage_type, target):
    resist = target.stagger_endurance.get(damage_type, 1.0)
    return int(value * resist)


def extract_counter_dice(unit):
    for card in unit.equipped:
        if not card:
            continue
        remain = []
        for dice in card.dice:
            if dice["type"] == "counter":
                unit.saved_counter.append(dice)
            else:
                remain.append(dice)
        card.dice = remain


def resolve_one_side_attack(attacker, defender, attack_dice):
    if not check_and_consume_gun_cost(attacker, attack_dice):
        print(f"[{attacker.name}] 탄환 부족으로 주사위 파괴!")
        return

    defense_pool = []
    defense_pool.extend(defender.saved_counter)
    defense_pool.extend(defender.saved_defense)

    atk_damage_type = attack_dice["damage_type"]

    if not defense_pool:
        atk_roll = roll_dice(attack_dice, attacker, kind="attack")
        if atk_roll <= 0:
            return

        hp_dmg = calc_damage(atk_roll, atk_damage_type, defender, attacker)
        stagger_dmg = calc_stagger_damage(atk_roll, atk_damage_type, defender)
        atk_type_name = DICE_TYPE_MAP.get(atk_damage_type, atk_damage_type)

        print(f"\n[일방공격] {atk_roll}({atk_type_name})")
        trigger_win_sfx(attack_dice)
        defender.take_damage(hp_dmg, stagger_dmg)
        apply_dice_effects(attacker, defender, attack_dice)
        trigger_passive_action(attacker, "on_hit", {"kind": "attack", "dmg_type": atk_damage_type}, defender)

        print()
        pause()
        return

    while defense_pool:
        defend_dice = defense_pool[0]
        atk_roll = roll_dice(attack_dice, attacker, kind="attack")
        def_roll = roll_dice(defend_dice, defender, kind="counter")
        def_damage_type = defend_dice["damage_type"]

        atk_val = atk_roll if atk_roll > 0 else "흐트러짐!"
        def_val = def_roll if def_roll > 0 else "흐트러짐!"
        label = "반격" if def_damage_type and "counter" in def_damage_type else "수비"

        atk_type_name = DICE_TYPE_MAP.get(atk_damage_type, atk_damage_type)
        def_type_name = DICE_TYPE_MAP.get(def_damage_type, def_damage_type)
        print(f"\n[{label} 합] {atk_val}({atk_type_name}) VS {def_val}({def_type_name})")

        if atk_roll > def_roll:
            defense_pool.pop(0)
            defender.change_sanity(-5)
            if defend_dice in defender.saved_counter:
                defender.saved_counter.remove(defend_dice)
            if defend_dice in defender.saved_defense:
                defender.saved_defense.remove(defend_dice)
            pause()
            continue
        elif def_roll > atk_roll:
            play_sfx(def_damage_type)
            if def_damage_type == "block":
                print(f"[{defender.name}] 공격 차단!")
                if defend_dice in defender.saved_defense:
                    defender.saved_defense.remove(defend_dice)
                pause()
                return
            elif def_damage_type == "evade":
                print(f"[{defender.name}] 회피 성공!")
                pause()
                return
            elif def_damage_type == "counter_block":
                print(f"[{defender.name}] 반격 차단 성공!")
                pause()
                return
            elif def_damage_type == "counter_evade":
                print(f"[{defender.name}] 반격 회피 성공!")
                pause()
                return
            elif def_damage_type in ["counter_slash", "counter_pierce", "counter_blunt"]:
                real_type = def_damage_type.replace("counter_", "")
                dmg = calc_damage(def_roll, real_type, attacker, defender)
                print(f"[{defender.name}] 반격 적중!")
                attacker.take_damage(dmg, 0)
                attacker.change_sanity(-5)
                pause()
                return
        else:
            print("무승부!")
            pause()
            return


def clash_cards(player, enemy, player_card, enemy_card):
    player_dice = player_card.dice.copy()
    enemy_dice = enemy_card.dice.copy()

    print(f"\n{player_card.name} VS {enemy_card.name}\n" + "=" * 50)

    p_card_type = player_card.type
    e_card_type = enemy_card.type
    is_p_melee_vs_e_ranged = (p_card_type == "melee" and e_card_type == "ranged")
    is_e_melee_vs_p_ranged = (e_card_type == "melee" and p_card_type == "ranged")

    player.card_dice_power_modifier = 0
    enemy.card_dice_power_modifier = 0

    play_card_dialogue(player, player_card)
    apply_on_use_effects(player, player_card, target=enemy)

    print()

    play_card_dialogue(enemy, enemy_card)
    apply_on_use_effects(enemy, enemy_card, target=player)
    print()

    clash_index = 1

    while player_dice and enemy_dice:
        while player_dice and not check_and_consume_gun_cost(player, player_dice[0]):
            print(f"[{player.name}] 탄환 부족으로 주사위 파괴!")
            player_dice.pop(0)

        while enemy_dice and not check_and_consume_gun_cost(enemy, enemy_dice[0]):
            print(f"[{enemy.name}] 탄환 부족으로 주사위 파괴!")
            enemy_dice.pop(0)

        if not player_dice or not enemy_dice or player.hp <= 0 or enemy.hp <= 0:
            break

        p_dice = player_dice.pop(0)
        e_dice = enemy_dice.pop(0)

        p_roll = 0 if player.is_staggered else roll_dice(p_dice, player)
        e_roll = roll_dice(e_dice, enemy)

        p_kind, e_kind = p_dice["type"], e_dice["type"]
        p_type, e_type = p_dice["damage_type"], e_dice["damage_type"]

        p_val = p_roll if p_roll > 0 else "흐트러짐!"
        e_val = e_roll if e_roll > 0 else "흐트러짐!"
        p_type_name = DICE_TYPE_MAP.get(p_type, p_type)
        e_type_name = DICE_TYPE_MAP.get(e_type, e_type)

        print(f"\n[합 {clash_index}] {p_val}({p_type_name}) VS {e_val}({e_type_name})")
        clash_index += 1

        # 공격 vs 공격
        if p_kind == "attack" and e_kind == "attack":
            if p_roll > e_roll:
                trigger_win_sfx(p_dice)
                if is_p_melee_vs_e_ranged:
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 근거리 선공! 주사위를 재사용하며 {enemy.name}은(는) 피해를 입지 않습니다.")
                    continue
                enemy.change_sanity(-5)
                hp_dmg = calc_damage(p_roll, p_type, enemy, player)
                stagger_dmg = calc_stagger_damage(p_roll, p_type, enemy)
                enemy.take_damage(hp_dmg, stagger_dmg)
                apply_dice_effects(player, enemy, p_dice)
                trigger_passive_action(player, "on_hit", {"kind": "attack", "dmg_type": p_type}, enemy)
                apply_clash_win_effects(player, enemy, p_dice)
                trigger_passive_action(player, "on_clash_win", {"kind": "attack", "dmg_type": p_type}, enemy)
            elif e_roll > p_roll:
                trigger_win_sfx(e_dice)
                if is_e_melee_vs_p_ranged:
                    enemy_dice.append(e_dice)
                    print(f"[{enemy.name}] 근거리 선공! 주사위를 재사용하며 {player.name}은(는) 피해를 입지 않습니다.")
                    continue
                player.change_sanity(-5)
                hp_dmg = calc_damage(e_roll, e_type, player, enemy)
                stagger_dmg = calc_stagger_damage(e_roll, e_type, player)
                print(f"[{enemy.name} 승리!]")
                player.take_damage(hp_dmg, stagger_dmg)
                apply_dice_effects(enemy, player, e_dice)
                apply_clash_win_effects(enemy, player, e_dice)
                trigger_passive_action(enemy, "on_clash_win", {"kind": "attack", "dmg_type": e_type}, player)
                trigger_passive_action(enemy, "on_hit", {"kind": "attack", "dmg_type": e_type}, player)
            else:
                play_sfx("draw_atk")
                print("무승부!")

        # 공격 vs 수비(block)
        elif p_kind == "attack" and e_type == "block":
            if p_roll > e_roll:
                trigger_win_sfx(p_dice)
                if is_p_melee_vs_e_ranged:
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 근거리 합 승리! 주사위를 재사용합니다.")
                    continue
                diff = p_roll - e_roll
                hp_dmg = calc_damage(diff, p_type, enemy, player)
                stagger_dmg = calc_stagger_damage(diff, p_type, enemy)
                print(f"[{player.name} 승리!]")
                enemy.change_sanity(-5)
                enemy.take_damage(hp_dmg, stagger_dmg)
                apply_dice_effects(player, enemy, p_dice)
                apply_clash_win_effects(player, enemy, p_dice)
                trigger_passive_action(player, "on_clash_win", {"kind": "attack", "dmg_type": p_type}, enemy)
                trigger_passive_action(player, "on_hit", {"kind": "attack", "dmg_type": p_type}, enemy)
            elif e_roll > p_roll:
                play_sfx("block")
                if is_e_melee_vs_p_ranged:
                    enemy_dice.append(e_dice)
                    print(f"[{enemy.name}] 방어 성공! 주사위를 재사용합니다.")
                    continue
                diff = e_roll - p_roll
                stagger_dmg = calc_stagger_damage(diff, p_type, enemy)
                player.change_sanity(-5)
                enemy.take_damage(0, stagger_dmg)
                apply_clash_win_effects(enemy, player, e_dice)
            else:
                play_sfx("evade")
                print("무승부!")

        # 수비(block) vs 공격
        elif p_type == "block" and e_kind == "attack":
            if e_roll > p_roll:
                trigger_win_sfx(e_dice)
                if is_e_melee_vs_p_ranged:
                    enemy_dice.append(e_dice)
                    print(f"[{enemy.name}] 근거리 합 승리! 주사위를 재사용합니다.")
                    continue
                diff = e_roll - p_roll
                hp_dmg = calc_damage(diff, e_type, player, enemy)
                stagger_dmg = calc_stagger_damage(diff, e_type, player)
                print(f"[{enemy.name} 승리!]")
                player.change_sanity(-5)
                player.take_damage(hp_dmg, stagger_dmg)
                apply_dice_effects(enemy, player, e_dice)
                apply_clash_win_effects(enemy, player, e_dice)
                trigger_passive_action(enemy, "on_hit", {"kind": "attack", "dmg_type": e_type}, player)
            elif p_roll > e_roll:
                play_sfx("block")
                if is_p_melee_vs_e_ranged:
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 방어 성공! 주사위를 재사용합니다.")
                    continue
                diff = p_roll - e_roll
                stagger_dmg = calc_stagger_damage(diff, e_type, player)
                enemy.change_sanity(-5)
                player.take_damage(0, stagger_dmg)
                apply_clash_win_effects(player, enemy, p_dice)
            else:
                play_sfx("block")
                print("무승부!")

        # 공격 vs 회피(evade)
        elif p_kind == "attack" and e_type == "evade":
            if p_roll > e_roll:
                trigger_win_sfx(p_dice)
                if is_p_melee_vs_e_ranged:
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 공격 성공! 주사위를 재사용합니다.")
                    continue
                diff = p_roll - e_roll
                hp_dmg = calc_damage(diff, p_type, enemy, player)
                stagger_dmg = calc_stagger_damage(diff, p_type, enemy)
                print(f"[{player.name} 승리!]")
                enemy.change_sanity(-5)
                enemy.take_damage(hp_dmg, stagger_dmg)
                apply_dice_effects(player, enemy, p_dice)
                apply_clash_win_effects(player, enemy, p_dice)
                trigger_passive_action(player, "on_hit", {"kind": "attack", "dmg_type": p_type}, enemy)
            elif e_roll > p_roll:
                play_sfx("evade")
                enemy.current_stagger = min(enemy.stagger_resist, enemy.current_stagger + e_roll)
                print(f"{enemy.name} 흐트러짐 {e_roll} 회복!")
                player.change_sanity(-5)
                enemy_dice.insert(0, e_dice)
            else:
                play_sfx("evade")
                print("무승부!")

        # 회피(evade) vs 공격
        elif p_type == "evade" and e_kind == "attack":
            if p_roll > e_roll:
                play_sfx("evade")
                if is_p_melee_vs_e_ranged:
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 회피 성공! 주사위를 재사용합니다.")
                    continue
                player.current_stagger = min(player.stagger_resist, player.current_stagger + p_roll)
                print(f"{player.name} 흐트러짐 {p_roll} 회복!")
                enemy.change_sanity(-5)
                player_dice.insert(0, p_dice)
            elif e_roll > p_roll:
                trigger_win_sfx(e_dice)
                diff = e_roll - p_roll
                hp_dmg = calc_damage(diff, e_type, player, enemy)
                stagger_dmg = calc_stagger_damage(diff, e_type, player)
                player.change_sanity(-5)
                player.take_damage(hp_dmg, stagger_dmg)
            else:
                play_sfx("block")
                print("무승부!")

        # 방어 vs 방어
        else:
            if p_roll > e_roll:
                if is_p_melee_vs_e_ranged:
                    play_sfx(p_type)
                    player_dice.append(p_dice)
                    print(f"[{player.name}] 수비 성공! 주사위를 재사용합니다.")
                    continue
                if p_type == "block":
                    play_sfx("block")
                    stagger_dmg = p_roll - e_roll
                    enemy.current_stagger -= stagger_dmg
                    enemy.change_sanity(-5)
                    print(f"{enemy.name}에게 {stagger_dmg} 흐트러짐 피해!")
                elif p_type == "evade":
                    play_sfx("evade")
                    player.current_stagger = min(player.stagger_resist, player.current_stagger + (p_roll - e_roll))
                    enemy.change_sanity(-5)
                    print(f"{player.name} 흐트러짐 회복!")
            elif e_roll > p_roll:
                if is_e_melee_vs_p_ranged:
                    play_sfx(e_type)
                    enemy_dice.append(e_dice)
                    print(f"[{enemy.name}] 수비 성공! 주사위를 재사용합니다.")
                    continue
                if e_type == "block":
                    play_sfx("block")
                    stagger_dmg = e_roll - p_roll
                    player.current_stagger -= stagger_dmg
                    player.change_sanity(-5)
                    print(f"{player.name}에게 {stagger_dmg} 흐트러짐 피해!")
                elif e_type == "evade":
                    play_sfx("evade")
                    enemy.current_stagger = min(enemy.stagger_resist, enemy.current_stagger + (e_roll - p_roll))
                    player.change_sanity(-5)
                    print(f"{enemy.name} 흐트러짐 회복!")
            else:
                play_sfx(p_type)
                print("무승부!")
        pause()

    # 남은 주사위 일방공격 처리
    while player_dice and player.hp > 0 and enemy.hp > 0:
        p_dice = player_dice.pop(0)
        if p_dice["type"] == "attack":
            print(f"\n[{player.name}] 남은 주사위 일방공격!")
            resolve_one_side_attack(player, enemy, p_dice)
        elif p_dice["type"] in ["defense", "block", "evade"]:
            player.saved_defense.append(p_dice)
        elif p_dice["type"] == "counter":
            player.saved_counter.append(p_dice)

    while enemy_dice and player.hp > 0 and enemy.hp > 0:
        e_dice = enemy_dice.pop(0)
        if e_dice["type"] == "attack":
            print(f"\n[{enemy.name}] 남은 주사위 일방공격!")
            resolve_one_side_attack(enemy, player, e_dice)
        elif e_dice["type"] in ["defense", "block", "evade"]:
            enemy.saved_defense.append(e_dice)
        elif e_dice["type"] == "counter":
            enemy.saved_counter.append(e_dice)
    player.card_dice_power_modifier = 0
    enemy.card_dice_power_modifier = 0


def resolve_turn(allies, enemies):
    for unit in allies + enemies:
        unit.saved_counter = []
        unit.saved_defense = []
        extract_counter_dice(unit)

    all_actions = []
    for unit in allies + enemies:
        for i in range(len(unit.equipped)):
            if unit.equipped[i] and unit.targets and unit.targets[i]:
                all_actions.append([unit, i, unit.equipped[i], unit.targets[i][0], unit.targets[i][1], False])

    # 1. 합(Clash) 해결
    for action in all_actions:
        if action[5]:
            continue

        partner = None
        for other in all_actions:
            if other[5]:
                continue
            if (other[0] == action[3] and other[1] == action[4] and action[0] == other[3] and action[1] == other[4]):
                partner = other
                break

        if partner:
            clash_cards(action[0], partner[0], action[2], partner[2])
            action[5] = True
            partner[5] = True

    # 2. 일방 공격 해결
    for action in all_actions:
        if action[5]:
            continue

        attacker, card, defender = action[0], action[2], action[3]
        if attacker.hp > 0 and not attacker.is_staggered and defender.hp > 0:
            print(f"\n[{attacker.name}] -> [{defender.name}] 일방공격!")
            attacker.card_dice_power_modifier = 0
            play_card_dialogue(attacker, card)
            apply_on_use_effects(attacker, card, target=defender)

            for dice in card.dice:
                dtype = dice["type"]
                if dtype == "attack":
                    resolve_one_side_attack(attacker, defender, dice)
                    if defender.hp <= 0:
                        break
                elif dtype in ["defense", "block", "evade"]:
                    attacker.saved_defense.append(dice)
                elif dtype == "counter":
                    attacker.saved_counter.append(dice)

            attacker.card_dice_power_modifier = 0

        action[5] = True

    for u in allies + enemies:
        ensure_staggered(u)

    clear_screen()
    print("=" * 50)
    print("이번 턴 결과 요약")
    print("-" * 50)
    for u in allies + enemies:
        print(f"{u.name} HP: {u.hp}/{u.max_hp} SAN: {u.sanity}")
    print("=" * 50)


def get_battle_flavor_text(player, enemies):
    if not enemies:
        return ""
    leader = enemies[0]
    dialogues = getattr(leader, "dialogue_lines", {})

    if player.is_panicked:
        msg = dialogues.get("on_panic", {}).get("player")
        if msg:
            return msg
    if leader.is_panicked:
        msg = dialogues.get("on_panic", {}).get("enemy")
        if msg:
            return msg

    if player.is_staggered:
        msg = dialogues.get("on_staggered", {}).get("player")
        if msg:
            return msg
    if leader.is_staggered:
        msg = dialogues.get("on_staggered", {}).get("enemy")
        if msg:
            return msg

    common = dialogues.get("common", [])
    if common:
        return random.choice(common)
    return ""


def show_battle_ui(allies, enemies, msg="", active_unit=None, active_slot=None):
    clear_screen()
    if msg:
        print(f"\n[{msg}]")

    def print_faction(title, units, arrow):
        print(f"\n{arrow} {title} " + arrow * 40)
        for i, unit in enumerate(units, 1):
            prefix = " > " if unit == active_unit else "   "
            status = " (패닉)" if unit.is_panicked else (" (사기저하)" if unit.is_low_morale else "")
            speed_range = f" [속도 {unit.speed['min']}~{unit.speed['max']}]" if unit.hp > 0 else ""
            if unit.hp <= 0:
                stagger = " [전투 불능]"
            else:
                stagger = " 흐트러짐!" if unit.is_staggered else f" 흐트러짐: {unit.current_stagger}/{unit.stagger_resist}"

            status_list = []
            for s_id, state in unit.statuses.items():
                s_data = load_status_data(s_id)
                status_list.append(f"{(s_data['name'] if s_data else s_id)}{state['amount']}({state['count']})")
            status_summary = f" | 상태: {', '.join(status_list)}" if status_list else ""

            print(f"{prefix}[{i}] {unit.name}{status}{speed_range} | HP: {unit.hp}/{unit.max_hp} | SAN: {unit.sanity} | {stagger}{status_summary}")
            if unit.hp > 0 and unit.equipped:
                for idx, card in enumerate(unit.equipped):
                    speed_val = unit.slot_speeds[idx] if idx < len(unit.slot_speeds) else "?"
                    slot_prefix = "    *" if unit == active_unit and idx == active_slot else "     "
                    if card:
                        t_info = ""
                        if unit.targets and unit.targets[idx]:
                            t_unit, t_slot = unit.targets[idx]
                            t_info = f" -> {t_unit.name}[Slot {t_slot+1}]"
                        print(f"{slot_prefix}Slot {idx+1} [속도 {speed_val}]: {card.name}{t_info}")
                    else:
                        print(f"{slot_prefix}Slot {idx+1} [속도 {speed_val}]: 비어있음")

    print_faction("ENEMY FACTION", enemies, "▼")
    print_faction("ALLY FACTION", allies, "▲")

    if active_unit:
        print(f"\n--- 현재 조작 중: {active_unit.name} ---")
        print(f"빛: {active_unit.current_cost}/{active_unit.max_cost}")
        print("패: " + "  ".join([f"{i+1}.{c.name}({c.cost})" for i, c in enumerate(active_unit.hand)]))
        print("\n" + "-" * 60)
        print("[번호] 카드 장착 | [정보] 유닛 정보 | [명령] 조력자 조종 | [끝] 턴 종료")
    print("=" * 60)


def show_passive_info(p_id):
    info = load_passive_data(p_id)
    if not info:
        print(f"\n패시브 정보를 찾을 수 없습니다: {p_id}")
        pause()
        return

    clear_screen()
    print("=" * 50)
    print(info["name"])
    print("-" * 50)
    print(info.get("desc", "설명 정보가 없습니다."))
    print("=" * 50)
    pause()


def info_menu_battle(allies, enemies):
    while True:
        clear_screen()
        print("=" * 50)
        print("전투 상세 정보")
        print("-" * 50)
        print("1. 아군 진영 정보")
        print("2. 적 진영 정보")
        print("0. 돌아가기")
        print("=" * 50)

        choice = input("\n선택 > ")
        if choice == "0":
            break

        target_list = allies if choice == "1" else (enemies if choice == "2" else None)
        if not target_list:
            continue

        print(f"\n[{'아군' if choice == '1' else '적'} 목록]")
        for i, u in enumerate(target_list, 1):
            print(f"{i}. {u.name}")

        try:
            idx_input = input("\n대상 번호 (0:취소) > ")
            if idx_input == "0":
                continue
            idx = int(idx_input) - 1
            if 0 <= idx < len(target_list):
                unit_detail_menu(target_list[idx])
        except (ValueError, IndexError):
            continue


def unit_detail_menu(unit):
    while True:
        clear_screen()
        status_suffix = " (패닉)" if unit.is_panicked else (" (사기저하)" if unit.is_low_morale else "")
        print("=" * 50)
        print(f"<{unit.name}{status_suffix} 상세 정보>")
        print("-" * 50)
        print(f"HP : {unit.hp}/{unit.max_hp}")
        print(f"SAN: {unit.sanity}/{unit.max_sanity}")
        print(f"흐트러짐: {unit.current_stagger}/{unit.stagger_resist}")

        if unit.statuses:
            status_desc = []
            for s_id, state in unit.statuses.items():
                s_data = load_status_data(s_id)
                name = s_data["name"] if s_data else s_id
                status_desc.append(f"{name} {state['amount']}({state['count']})")
            print(f"상태이상: {', '.join(status_desc)}")
        else:
            print("상태이상: 없음")

        print("\n[내성 정보]")
        for k in ["slash", "pierce", "blunt"]:
            e_val = unit.endurance.get(k, 1.0)
            s_val = unit.stagger_endurance.get(k, 1.0)
            name = DICE_TYPE_MAP.get(k, k)
            print(f"- {name}: 피해 {e_val}x / 흐트러짐 {s_val}x")

        print("-" * 50)
        print("1. 카드 정보 확인 (패/장착)")
        print("2. 패시브 정보 확인")
        print("3. 패닉 정보 확인")
        print("0. 뒤로")
        print("=" * 50)

        cmd = input("\n선택 > ")
        if cmd == "0":
            break
        elif cmd == "1":
            show_unit_cards_battle(unit)
        elif cmd == "2":
            if not unit.passives:
                print("\n보유 패시브가 없습니다.")
                pause()
                continue
            for i, p_id in enumerate(unit.passives, start=1):
                data = load_passive_data(p_id)
                name = data["name"] if data else p_id
                print(f"{i}. {name}")
            try:
                p_idx = int(input("\n패시브 번호 (0:취소) > ")) - 1
                if p_idx >= 0:
                    show_passive_info(unit.passives[p_idx])
            except (ValueError, IndexError):
                pass
        elif cmd == "3":
            show_unit_panic_info_battle(unit)


def show_unit_cards_battle(unit):
    cards = []
    if hasattr(unit, "hand") and unit.hand:
        for c in unit.hand:
            cards.append((c, "패"))
    if hasattr(unit, "equipped"):
        for c in unit.equipped:
            if c:
                cards.append((c, "장착"))

    if not cards:
        print("\n확인 가능한 카드가 없습니다.")
        pause()
        return

    while True:
        clear_screen()
        print(f"<{unit.name} 보유 카드 목록>")
        for i, (c, tag) in enumerate(cards, 1):
            print(f"{i}. [{tag}] {c.name} (비용 {c.cost})")
        print("0. 뒤로")

        try:
            idx = int(input("\n번호 > ")) - 1
            if idx == -1:
                break
            if 0 <= idx < len(cards):
                show_card_info_battle(cards[idx][0])
        except (ValueError, IndexError):
            break


def show_unit_panic_info_battle(unit):
    if not unit.panic_type:
        print("\n패닉 유형 정보가 없습니다.")
        pause()
        return
    data = load_panic_data(unit.panic_type)
    clear_screen()
    print("=" * 50)
    print(f"패닉 유형: {data.get('name', unit.panic_type) if data else unit.panic_type}")
    print("-" * 50)
    if data:
        if "low_morale_effects" in data:
            print("\n[사기저하 효과]")
            for effect in data["low_morale_effects"]:
                print(f"- {effect.get('desc', '설명 없음')}")
        if "panic_effects" in data:
            print("\n[패닉 효과]")
            for effect in data["panic_effects"]:
                print(f"- {effect.get('desc', '설명 없음')}")
    print("=" * 50)
    pause()


def format_on_use_effect_kor(effect):
    if not isinstance(effect, dict):
        return str(effect)

    parts = []
    if "mode_change" in effect:
        parts.append(f"{effect['mode_change']} 모드로 전환")
    if "apply_status" in effect:
        status_parts = []
        for s_id, params in effect["apply_status"].items():
            s_data = load_status_data(s_id)
            s_name = s_data["name"] if s_data else s_id
            status_parts.append(f"{s_name} 위력 {params.get('amount', 0)}, 횟수 {params.get('count', 0)} 부여")
        parts.append(", ".join(status_parts))
    if "draw_cards" in effect:
        parts.append(f"카드 {effect['draw_cards']}장 드로우")
    if "recover_cost" in effect:
        parts.append(f"빛 {effect['recover_cost']} 회복")
    if "remove_status" in effect:
        s_id = effect["remove_status"]
        s_data = load_status_data(s_id)
        s_name = s_data["name"] if s_data else s_id
        parts.append(f"{s_name} 효과 제거")
    if "modify_dice_power" in effect:
        params = effect["modify_dice_power"]
        if isinstance(params, dict):
            p_kind = params.get("kind", "all")
            p_val = params.get("value", 0)
        else:
            p_kind = "all"
            p_val = params
        kind_name = DICE_TYPE_MAP.get(p_kind, "모든") if p_kind != "all" else "모든"
        parts.append(f"이번 턴 동안 {kind_name} 주사위 위력 {p_val:+}")

    if "condition_modify_dice_power" in effect:
            params = effect["condition_modify_dice_power"]
            dest_str = "자신" if params.get("target") == "self" else "상대"
            s_id = params.get("status_id", "")
            s_data = load_status_data(s_id)
            s_name = s_data["name"] if s_data else s_id
            check_str = "위력" if params.get("check", "amount") == "amount" else "횟수"
            th = params.get("threshold", 0)
            val = params.get("value", 0)
            parts.append(f"{dest_str}의 {s_name} {check_str}이 {th} 이상이면 이 카드의 모든 주사위 위력 {val:+}")

    return " / ".join(parts) if parts else str(effect)


def show_card_info_battle(card):
    clear_screen()
    print("=" * 60)
    print(f"[{card.name}]")
    c_type = CARD_TYPE_MAP.get(getattr(card, "type", "melee"), getattr(card, "type", "melee"))
    c_grade = CARD_GRADE_MAP.get(getattr(card, "grade", "paperback"), getattr(card, "grade", "paperback"))
    print(f"비용: {card.cost} | 유형: {c_type} | 등급: {c_grade}")

    if card.on_use_effect:
        print("\n[사용시 효과]")
        for effect in card.on_use_effect:
            if not effect:
                continue
            print(f"- {format_on_use_effect_kor(effect)}")

    print("\n[주사위 정보]")
    for i, dice in enumerate(card.dice, 1):
        d_type = DICE_TYPE_MAP.get(dice.get("damage_type", ""), dice.get("damage_type", ""))
        kind_kor = {"attack": "공격", "defense": "수비", "counter": "반격"}.get(dice["type"], dice["type"])
        print(f"{i}. {kind_kor}({d_type}) {dice['min']}~{dice['max']}")

        if "dice_effect" in dice and dice["dice_effect"]:
            for effect_entry in dice["dice_effect"]:
                if not effect_entry:
                    continue
                if "apply_effects" in effect_entry:
                    apply_effs = effect_entry["apply_effects"]
                    if isinstance(apply_effs, dict):
                        apply_effs = [apply_effs]
                    for status_data in apply_effs:
                        if isinstance(status_data, dict):
                            for s_id, params in status_data.items():
                                s_data = load_status_data(s_id)
                                s_name = s_data["name"] if s_data else s_id
                                print(f"   └ 적중시: {s_name} 위력 {params.get('amount', 0)}, 횟수 {params.get('count', 0)} 부여")
                if "fixed_damage" in effect_entry:
                    print(f"   └ 적중시: {effect_entry['fixed_damage']} 고정 피해")
                if "sanity_damage" in effect_entry:
                    print(f"   └ 적중시: {effect_entry['sanity_damage']} 정신력 피해")
                if "tremor_burst" in effect_entry:
                    print(f"   └ 적중시: 진동 폭발")
                if "heal_hp" in effect_entry:
                    print(f"   └ 적중시: 체력 {effect_entry['heal_hp']} 회복")
                if "clash_recover_cost" in effect_entry:
                    print(f"   └ 합 승리시: 빛 {effect_entry['clash_recover_cost']} 회복")
                if "clash_fixed_damage" in effect_entry:
                    print(f"   └ 합 승리시: 대상에게 {effect_entry['clash_fixed_damage']} 고정 피해")
                if "clash_fixed_stagger" in effect_entry:
                    print(f"   └ 합 승리시: 대상에게 {effect_entry['clash_fixed_stagger']} 흐트러짐 피해")
                if "clash_give_card_self" in effect_entry:
                    c_name = load_card(effect_entry["clash_give_card_self"]).name
                    print(f"   └ 합 승리시: 자신의 패에 [{c_name}] 생성")
                if "clash_give_card_target" in effect_entry:
                    c_name = load_card(effect_entry["clash_give_card_target"]).name
                    print(f"   └ 합 승리시: 상대의 패에 [{c_name}] 생성")
                if "gun" in effect_entry:
                    print(f"   └ 필요: 탄환 {effect_entry['gun']}발 소모")
                if (isinstance(effect_entry, dict) and "hand_scaling" in effect_entry) or effect_entry == "hand_scaling":
                    print("   └ 이 주사위의 위력은 손패의 카드 수 만큼 증가.")

    if card.on_use_dialogue:
        print(f"\n[사용 대사]\n{card.on_use_dialogue}")
    print("=" * 60)
    pause()


# 도감에서 참조할 수 있도록 연결
show_card_info = show_card_info_battle


def play_card_dialogue(user, card):
    if not card.on_use_dialogue:
        return
    print()
    print(card.on_use_dialogue.format(card_user=user.name))


def discard_card(unit, card):
    if card in unit.hand:
        unit.hand.remove(card)
    unit.discard_pile.append(getattr(card, "id", card))


def player_select_cards(allies, enemies, msg=""):
    if not allies:
        return
    active_unit = allies[0]

    while True:
        show_battle_ui(allies, enemies, msg, active_unit)
        cmd = input("\n입력 : ").strip()

        if cmd == "끝":
            break

        if cmd == "명령":
            controllables = [u for u in allies if getattr(u, "ai_type", "") == "controllable" or u == allies[0]]
            print("\n명령을 내릴 유닛 선택:")
            for i, u in enumerate(controllables, 1):
                print(f"{i}. {u.name}")

            try:
                c_idx = int(input("> ")) - 1
                if 0 <= c_idx < len(controllables):
                    active_unit = controllables[c_idx]
                    if active_unit.hp <= 0 or active_unit.is_staggered or unit_cannot_equip(active_unit):
                        print(f"\n{active_unit.name}은(는) 현재 명령을 내릴 수 없는 상태입니다.")
                        active_unit = allies[0]
                        pause()
            except (ValueError, IndexError):
                pass
            continue

        if cmd == "정보":
            info_menu_battle(allies, enemies)
            continue

        if active_unit.hp <= 0:
            print("전투 불능 상태인 유닛에게는 명령을 내릴 수 없습니다.")
            pause()
            continue

        if active_unit.is_staggered:
            print("이 유닛은 흐트러진 상태입니다.")
            pause()
            continue

        if unit_cannot_equip(active_unit):
            print(f"{active_unit.name}은(는) 패닉 상태로 인해 카드를 장착할 수 없습니다.")
            pause()
            continue

        try:
            index = int(cmd) - 1
        except ValueError:
            continue

        if index < 0 or index >= len(active_unit.hand):
            continue

        card = active_unit.hand[index]

        if card.type == "on_play":
            if card.cost > active_unit.current_cost:
                print("빛 부족")
            else:
                active_unit.current_cost -= card.cost
                print(f"\n[{card.name}] 사용!")
                active_unit.hand.pop(index)
                active_unit.discard_pile.append(card.id)
                play_card_dialogue(active_unit, card)
                apply_on_use_effects(active_unit, card)
            pause()
            continue

        print("\n공격할 대상을 선택하세요:")
        for i, en in enumerate(enemies, 1):
            print(f"{i}. {en.name}")

        try:
            target_idx = int(input("대상 유닛 번호 : ")) - 1
            if not (0 <= target_idx < len(enemies)):
                raise ValueError
            target_unit = enemies[target_idx]

            print(f"\n{target_unit.name}의 어느 슬롯을 공격하시겠습니까? (1~{target_unit.card_slot})")
            target_slot = int(input("대상 슬롯 번호 : ")) - 1
            if not (0 <= target_slot < target_unit.card_slot):
                raise ValueError
        except (ValueError, IndexError):
            print("잘못된 타겟 선택입니다.")
            pause()
            continue

        try:
            slot = int(input(f"사용할 슬롯 번호 (1~{active_unit.card_slot}) : ")) - 1
        except ValueError:
            continue

        if slot < 0 or slot >= active_unit.card_slot:
            print(f"\n잘못된 슬롯 번호입니다. (1 ~ {active_unit.card_slot})")
            pause()
            continue

        old_card = active_unit.equipped[slot]
        available_light = active_unit.current_cost + (old_card.cost if old_card else 0)

        if card.cost > available_light:
            print("\n빛 부족")
            pause()
            continue

        my_speed = active_unit.slot_speeds[slot]
        target_speed = target_unit.slot_speeds[target_slot]

        if my_speed > target_speed:
            if target_unit.targets[target_slot] != (active_unit, slot):
                print(f"\n[속도 우위] {active_unit.name}의 속도({my_speed})가 {target_unit.name}의 속도({target_speed})보다 빠릅니다!")
                print(f"{target_unit.name}의 공격 대상을 가로챕니다.")
                target_unit.targets[target_slot] = (active_unit, slot)
                pause()

        if old_card:
            active_unit.current_cost += old_card.cost
            active_unit.hand.append(old_card)

        active_unit.equipped[slot] = card
        active_unit.targets[slot] = (target_unit, target_slot)
        active_unit.hand.remove(card)
        active_unit.current_cost -= card.cost


def start_battle(enemy_ids):
    if isinstance(enemy_ids, str):
        enemy_ids = [enemy_ids]

    clear_screen()
    game.enemies = [Enemy(load_enemy(eid)) for eid in enemy_ids]
    game.fallen_enemy_count = 0
    defeated_enemies = []
    player = game.player_char
    allies = [player] + game.allies

    battle_bgm = game.enemies[0].dialogue_lines.get("bgm", game.basic_battle_theme)
    if battle_bgm:
        play_bgm(battle_bgm, fade_ms=500)

    for u in allies + game.enemies:
        u.passive_vars = {}
        u.statuses = {}
        u.active_panic_effects = []
        u.panicked_turns_remaining = 0
        u.draw_pile = build_deck_list(u.deck)
        u.hand = []
        u.equipped = [None] * u.card_slot
        u.slot_speeds = [0] * u.card_slot
        u.targets = [None] * u.card_slot
        u.discard_pile = []
        u.current_cost = u.max_cost
        draw_cards(u, 3)
        apply_panic_effects(u)

    current_msg = game.enemies[0].appear if game.enemies else ""
    is_first_turn = True

    while True:
        for u in allies + game.enemies:
            begin_turn(u)

        if not is_first_turn:
            current_msg = get_battle_flavor_text(player, game.enemies)
        is_first_turn = False

        clear_screen()

        for u in allies + game.enemies:
            u.equipped = [None] * u.card_slot
            u.slot_speeds = [random.randint(u.speed["min"], u.speed["max"]) for _ in range(u.card_slot)]
            u.targets = [None] * u.card_slot
            draw_cards(u, 1)

        for en in game.enemies:
            enemy_select_cards(en, allies)
        for al in game.allies:
            if al != player:
                ally_select_cards(al, game.enemies)

        player_select_cards(allies, game.enemies, current_msg)
        resolve_turn(allies, game.enemies)

        for u in allies + game.enemies:
            trigger_status_effect(u, "on_turn_end", {})

        for e in game.enemies:
            if e.hp <= 0:
                game.fallen_enemy_count += 1
                defeated_enemies.append(e)
        game.enemies = [e for e in game.enemies if e.hp > 0]

        if not game.enemies:
            print("\n전투 승리!")
            for al in allies:
                if al.hp <= 0:
                    al.hp = al.max_hp // 2
                    print(f"[{al.name}]이(가) 다시 정신을 차립니다. (HP {al.hp} 회복)")
            if game.field_theme:
                play_bgm(game.field_theme, fade_ms=1000)
            else:
                stop_bgm(fade_ms=1000)

            for e in defeated_enemies:
                update_encyclopedia(enemy=e)
            total_exp = sum(e.exp for e in defeated_enemies)
            if total_exp > 0:
                player.gain_exp(total_exp)
            pause()
            return

        if player.hp <= 0 or not any(a.hp > 0 for a in allies):
            print("\n[사망] 플레이어 진영이 궤멸되었습니다...")
            game.ending_name = "육체적 사망"
            game.ended = True
            stop_bgm(fade_ms=1000)
            pause()
            return

        pause()

        for u in allies + game.enemies:
            u.current_cost = min(u.max_cost, u.current_cost + 1)
            for card in u.equipped:
                if card:
                    u.discard_pile.append(card.id)


def ally_select_cards(ally, enemies):
    if ally.hp <= 0 or ally.is_staggered or unit_cannot_equip(ally) or not enemies:
        return

    ai_type = getattr(ally, "ai_type", "random")
    if ai_type == "random":
        enemy_select_cards(ally, enemies)
    elif ai_type == "pattern":
        if not ally.pattern:
            return
        p = ally.pattern[ally.pattern_index]
        card = load_card(p.get("card_id"))
        if card.cost <= ally.current_cost:
            ally.equipped[0] = card
            target_unit = enemies[min(p.get("target_idx", 0), len(enemies) - 1)]
            target_slot = random.randint(0, target_unit.card_slot - 1)
            ally.targets[0] = (target_unit, target_slot)
            ally.current_cost -= card.cost
        ally.pattern_index = (ally.pattern_index + 1) % len(ally.pattern)


def enemy_select_cards(unit, opponents):
    if unit.hp <= 0 or unit.is_staggered or unit_cannot_equip(unit) or not opponents:
        return

    live_opponents = [o for o in opponents if o.hp > 0]
    if not live_opponents:
        return

    on_play = [c for c in unit.hand if c.type == "on_play"]
    for card in list(on_play):
        if card.cost <= unit.current_cost:
            unit.current_cost -= card.cost
            unit.hand.remove(card)
            unit.discard_pile.append(card.id)
            play_card_dialogue(unit, card)
            apply_on_use_effects(unit, card)

    for i in range(unit.card_slot):
        candidates = [c for c in unit.hand if c.cost <= unit.current_cost]
        if not candidates:
            break

        card = random.choice(candidates)
        unit.equipped[i] = card
        unit.hand.remove(card)
        unit.current_cost -= card.cost

        target_unit = random.choice(live_opponents)
        target_slot = random.randint(0, target_unit.card_slot - 1)
        unit.targets[i] = (target_unit, target_slot)


# ==================================================
# 조건 검사 및 게임 흐름 제어
# ==================================================

def check_requirements(requirements):
    if not requirements:
        return True

    player = game.player_char
    if not player:
        return True

    if "item" in requirements and not player.has_gadget(requirements["item"]):
        return False

    if "not_item" in requirements and player.has_gadget(requirements["not_item"]):
        return False

    if "items" in requirements:
        for name, amount in requirements["items"].items():
            if player.gadget_count(name) < amount:
                return False

    if "required_category" in requirements:
        for cat_name, min_amt in requirements["required_category"].items():
            total_in_cat = sum(
                g_count for g_id, g_count in player.gadgets.items()
                if load_gadget_data(g_id) and cat_name in load_gadget_data(g_id).get("category", [])
            )
            if total_in_cat < min_amt:
                return False

    if "has_card" in requirements and player.deck.get(requirements["has_card"], 0) <= 0:
        return False

    if "has_passive" in requirements and requirements["has_passive"] not in player.passives:
        return False

    if "has_cards" in requirements:
        for c_id, amt in requirements["has_cards"].items():
            if player.deck.get(c_id, 0) < amt:
                return False

    profile_flags = game.profile.get("flags", {})
    if "flag_min" in requirements:
        for f_name, f_val in requirements["flag_min"].items():
            if profile_flags.get(f_name, 0) < f_val:
                return False

    if "flag_max" in requirements:
        for f_name, f_val in requirements["flag_max"].items():
            if profile_flags.get(f_name, 0) >= f_val:
                return False

    if "name" in requirements and player.name != requirements["name"]:
        return False

    if "not_name" in requirements and player.name == requirements["not_name"]:
        return False

    return True


def select_card_from_deck(unit, title, filter_ids=None):
    while True:
        clear_screen()
        print(f"\n{title}\n" + "-" * 30)

        deck_ids = [c_id for c_id in unit.deck if filter_ids is None or c_id in filter_ids]
        if not deck_ids:
            print("보유 중인 카드가 없거나 조건에 맞는 카드가 없습니다.")
            pause()
            return None

        for i, c_id in enumerate(deck_ids, 1):
            try:
                card = load_card(c_id)
                print(f"{i}. {card.name} (x{unit.deck[c_id]})")
            except Exception:
                print(f"{i}. {c_id} (x{unit.deck[c_id]})")

        print("\n0. 취소")
        cmd = input("\n> ").strip()
        if cmd == "0":
            return None
        try:
            idx = int(cmd) - 1
            if 0 <= idx < len(deck_ids):
                return deck_ids[idx]
        except ValueError:
            continue


def select_gadget_from_inventory(unit, title, filter_category=None, count=1):
    """인벤토리에서 특정 카테고리의 가젯을 선택하게 하고 제거합니다. (버그 수정 완료)"""
    removed_gadgets = []

    for current_pick in range(count):
        available_gadgets = []
        for g_id, g_count in unit.gadgets.items():
            if g_count <= 0:
                continue
            g_data = load_gadget_data(g_id)
            if filter_category:
                if not g_data or filter_category not in g_data.get("category", []):
                    continue
            available_gadgets.append(g_id)

        if not available_gadgets:
            if current_pick == 0:
                print("\n보유 중인 가젯이 없거나 조건에 맞는 가젯이 없습니다.")
                pause()
            break

        while True:
            clear_screen()
            print(f"\n{title} ({current_pick + 1}/{count})\n" + "-" * 30)

            for i, g_id in enumerate(available_gadgets, 1):
                g_data = load_gadget_data(g_id)
                display_name = g_data.get("name", g_id) if g_data else g_id
                print(f"{i}. {display_name} (소지: {unit.gadgets[g_id]})")
            print("0. 취소")

            cmd = input("\n가젯 번호 선택 > ").strip()
            if cmd == "0":
                return removed_gadgets

            try:
                idx = int(cmd) - 1
                if 0 <= idx < len(available_gadgets):
                    selected_id = available_gadgets[idx]
                    unit.remove_gadget(selected_id)
                    removed_gadgets.append(selected_id)
                    name_disp = load_gadget_data(selected_id).get("name", selected_id) if load_gadget_data(selected_id) else selected_id
                    print(f"\n[{name_disp}] 제거 완료.")
                    time.sleep(0.3)
                    break
            except ValueError:
                continue
    return removed_gadgets


def schedule_special(gadget_id):
    if gadget_id not in game.special_encounters:
        return

    pool = game.special_encounters[gadget_id]
    if not pool:
        return

    encounter = random.choice(pool)
    delay = random.randint(3, 5)
    game.scheduled.append({"after": delay, "encounter": encounter})


def handle_level_up():
    char = game.player_char
    if not char:
        return

    flags = game.profile.get("flags", {})
    hp_inc = flags.get("levelup_hp", 0)
    san_inc = flags.get("levelup_sanity", 0)

    char.level += 1
    char.max_hp += hp_inc
    char.max_sanity += san_inc
    char.hp = char.max_hp
    char.sanity = char.max_sanity

    clear_screen()
    print("=" * 50)
    print(f"          [ LEVEL UP! (LV.{char.level}) ]")
    print("=" * 50)
    print("성장한 당신의 몸과 마음이 고동칩니다.")
    print(f"최대 체력: {char.max_hp} (+{hp_inc})")
    print(f"최대 정신력: {char.max_sanity} (+{san_inc})")
    print("\n모든 수치가 완전히 회복되었습니다.\n" + "-" * 50)

    if not char.card_pool:
        pause()
        return

    GRADE_WEIGHTS = {"paperback": 50, "hardcover": 35, "limited": 10, "objet_d'art": 5}
    candidates = char.card_pool
    weights = [GRADE_WEIGHTS.get(load_card(c_id).grade, 1) for c_id in candidates]

    reward_options = []
    temp_candidates = candidates[:]
    temp_weights = weights[:]

    for _ in range(min(3, len(temp_candidates))):
        picked = random.choices(temp_candidates, weights=temp_weights, k=1)[0]
        reward_options.append(picked)
        idx = temp_candidates.index(picked)
        temp_candidates.pop(idx)
        temp_weights.pop(idx)

    print("\n새로운 기술을 터득할 기회입니다. 하나를 선택하세요:")
    for i, c_id in enumerate(reward_options, 1):
        card = load_card(c_id)
        print(f"{i}. [{card.name}] (비용: {card.cost}, 등급: {card.grade})")

    while True:
        cmd = input("\n선택 (번호) : ").strip()
        try:
            idx = int(cmd) - 1
            if 0 <= idx < len(reward_options):
                selected_id = reward_options[idx]
                char.deck[selected_id] = char.deck.get(selected_id, 0) + 1
                update_encyclopedia(player=char)
                print(f"\n[{load_card(selected_id).name}] 기술을 덱에 추가했습니다.")
                break
        except ValueError:
            continue

    print("=" * 50)
    pause()


def apply_effects(effects):
    if not effects:
        return

    has_pending_msg = False

    for key, value in effects.items():
        if game.ended:
            break

        char = game.player_char

        if key == "hp" and char:
            print(f"HP {char.change_hp(value):+}")
            has_pending_msg = True
        elif key == "sanity" and char:
            print(f"정신력 {char.change_sanity(value):+}")
            has_pending_msg = True
        elif key == "give_item" and char:
            g_data = load_gadget_data(value)
            name = g_data.get("name", value) if g_data else value
            char.add_gadget(value)
            update_encyclopedia(gadget_id=value)
            print(f"[{name}] 획득")
            schedule_special(value)
            has_pending_msg = True

        elif key in ("exp", "give_exp") and char:
            char.gain_exp(value)
            has_pending_msg = True
        elif key == "give_items" and char:
            for item, amt in value.items():
                g_data = load_gadget_data(item)
                name = g_data.get("name", item) if g_data else item
                char.add_gadget(item, amt)
                update_encyclopedia(gadget_id=item)
                print(f"[{name}] x{amt}")
                schedule_special(item)
            has_pending_msg = True
        elif key == "remove_item" and char:
            g_data = load_gadget_data(value)
            name = g_data.get("name", value) if g_data else value
            char.remove_gadget(value)
            print(f"[{name}] 제거")
            has_pending_msg = True
        elif key == "remove_items" and char:
            for item, amt in value.items():
                g_data = load_gadget_data(item)
                name = g_data.get("name", item) if g_data else item
                char.remove_gadget(item, amt)
                print(f"[{name}] x{amt} 제거")
            has_pending_msg = True
        elif key == "battle":
            if has_pending_msg:
                pause()
                has_pending_msg = False
            start_battle(value)
        elif key == "load_player_char":
            print(create_player_char(value))
            has_pending_msg = True
        elif key == "give_card" and char:
            char.deck[value] = char.deck.get(value, 0) + 1
            update_encyclopedia(player=char)
            card_obj = load_card(value)
            print(f"카드 [{card_obj.name}] 획득")
            has_pending_msg = True
        elif key == "give_passive" and char:
            if value not in char.passives:
                char.passives.append(value)
                p_data = load_passive_data(value)
                p_name = p_data.get("name", value) if p_data else value
                print(f"패시브 [{p_name}] 획득")
                has_pending_msg = True
        elif key == "remove_card" and char:
            if value in char.deck:
                char.deck[value] -= 1
                if char.deck[value] <= 0:
                    del char.deck[value]
                card_obj = load_card(value)
                print(f"카드 [{card_obj.name}] 제거")
                has_pending_msg = True
        elif key == "remove_passive" and char:
            if value in char.passives:
                char.passives.remove(value)
                p_data = load_passive_data(value)
                p_name = p_data.get("name", value) if p_data else value
                print(f"패시브 [{p_name}] 제거")
                has_pending_msg = True
        elif key == "give_cards" and char:
            for c_id, amt in value.items():
                char.deck[c_id] = char.deck.get(c_id, 0) + amt
                card_obj = load_card(c_id)
                print(f"카드 [{card_obj.name}] x{amt} 획득")
            update_encyclopedia(player=char)
            has_pending_msg = True
        elif key == "remove_cards" and char:
            for c_id, amt in value.items():
                if c_id in char.deck:
                    removed_count = min(char.deck[c_id], amt)
                    char.deck[c_id] -= removed_count
                    if char.deck[c_id] <= 0:
                        del char.deck[c_id]
                    card_obj = load_card(c_id)
                    print(f"카드 [{card_obj.name}] x{removed_count} 제거")
            has_pending_msg = True
        elif key == "give_passives" and char:
            for p_id in value:
                if p_id not in char.passives:
                    char.passives.append(p_id)
                    p_data = load_passive_data(p_id)
                    p_name = p_data.get("name", p_id) if p_data else p_id
                    print(f"패시브 [{p_name}] 획득")
            has_pending_msg = True
        elif key == "remove_passives" and char:
            for p_id in value:
                if p_id in char.passives:
                    char.passives.remove(p_id)
                    p_data = load_passive_data(p_id)
                    p_name = p_data.get("name", p_id) if p_data else p_id
                    print(f"패시브 [{p_name}] 제거")
            has_pending_msg = True
        elif key == "give_ally" and char:
            if isinstance(value, str):
                a_id, ai, pat = value, "random", None
            else:
                a_id = value.get("id")
                ai = value.get("ai_type", "random")
                pat = value.get("pattern", [])

            a_data = load_ally_data(a_id)
            if a_data:
                new_ally = Ally(a_data, ai_type=ai, pattern=pat)
                game.allies.append(new_ally)
                print(f"조력자 [{new_ally.name}]가 합류했습니다!")
                has_pending_msg = True
        elif key == "remove_ally" and char:
            game.allies = [a for a in game.allies if a.id != value]
            print(f"조력자 [{value}]가 팀을 떠났습니다.")
            has_pending_msg = True
        elif key == "set_flag":
            f = game.profile.setdefault("flags", {})
            f.update(value)
            save_profile(game.profile)
        elif key == "inc_flag":
            f = game.profile.setdefault("flags", {})
            for k, v in value.items():
                f[k] = f.get(k, 0) + v
            save_profile(game.profile)
        elif key == "dec_flag":
            f = game.profile.setdefault("flags", {})
            for k, v in value.items():
                f[k] = f.get(k, 0) - v
            save_profile(game.profile)
        elif key == "remove_flag":
            game.profile.get("flags", {}).pop(value, None)
            save_profile(game.profile)
        elif key == "choice_remove_card" and char:
            target = select_card_from_deck(char, "제거할 카드를 선택하세요.")
            if target:
                char.deck[target] -= 1
                if char.deck[target] <= 0:
                    del char.deck[target]
                card_obj = load_card(target)
                print(f"카드 [{card_obj.name}] 제거 완료.")
                has_pending_msg = True
        elif key == "choice_duplicate_card" and char:
            target = select_card_from_deck(char, "복제할 카드를 선택하세요.")
            if target:
                char.deck[target] = char.deck.get(target, 0) + 1
                card_obj = load_card(target)
                print(f"카드 [{card_obj.name}] 복제 완료.")
                update_encyclopedia(player=char)
                has_pending_msg = True
        elif key == "choice_upgrade_card" and char:
            upgradable = [c_id for c_id in char.deck if not c_id.endswith("+") and (BASE_DIR / "cards" / f"{c_id}+.json").exists()]
            if not upgradable:
                print("\n강화할 수 있는 카드가 없습니다.")
                has_pending_msg = True
            else:
                target = select_card_from_deck(char, "강화할 카드를 선택하세요.", filter_ids=upgradable)
                if target:
                    new_id = target + "+"
                    char.deck[target] -= 1
                    if char.deck[target] <= 0:
                        del char.deck[target]
                    char.deck[new_id] = char.deck.get(new_id, 0) + 1
                    print(f"강화 완료: [{load_card(target).name}] -> [{load_card(new_id).name}]")
                    update_encyclopedia(player=char)
                    has_pending_msg = True
        elif key == "random_remove_card" and char:
            all_cards = [c_id for c_id, count in char.deck.items() for _ in range(count)]
            count_to_remove = min(len(all_cards), value)
            if count_to_remove > 0:
                targets = random.sample(all_cards, count_to_remove)
                for t in targets:
                    char.deck[t] -= 1
                    if char.deck[t] <= 0:
                        del char.deck[t]
                    print(f"무작위 제거: [{load_card(t).name}]")
                has_pending_msg = True
            else:
                print("제거할 카드가 없습니다.")
                has_pending_msg = True
        elif key == "random_upgrade_card" and char:
            upgradable = [c_id for c_id, count in char.deck.items() if not c_id.endswith("+") and (BASE_DIR / "cards" / f"{c_id}+.json").exists() for _ in range(count)]
            count_to_upgrade = min(len(upgradable), value)
            if count_to_upgrade > 0:
                targets = random.sample(upgradable, count_to_upgrade)
                for t in targets:
                    new_id = t + "+"
                    char.deck[t] -= 1
                    if char.deck[t] <= 0:
                        del char.deck[t]
                    char.deck[new_id] = char.deck.get(new_id, 0) + 1
                    print(f"무작위 강화: [{load_card(t).name}] -> [{load_card(new_id).name}]")
                update_encyclopedia(player=char)
                has_pending_msg = True
            else:
                print("강화 가능한 카드가 없습니다.")
                has_pending_msg = True
        elif key == "random_duplicate_card" and char:
            all_cards = [c_id for c_id, count in char.deck.items() for _ in range(count)]
            count_to_dup = min(len(all_cards), value)
            if count_to_dup > 0:
                targets = random.sample(all_cards, count_to_dup)
                for t in targets:
                    char.deck[t] = char.deck.get(t, 0) + 1
                    print(f"무작위 복제: [{load_card(t).name}]")
                update_encyclopedia(player=char)
                has_pending_msg = True
            else:
                print("복제할 카드가 없습니다.")
                has_pending_msg = True
        elif key == "achievement":
            give_achievement(value)
            has_pending_msg = True
        elif key == "level_up":
            handle_level_up()
        elif key == "set_field_theme":
            game.field_theme = value
            play_bgm(value, fade_ms=1000)
        elif key == "set_basic_battle_theme":
            game.basic_battle_theme = value
        elif key == "bgm_fade_out":
            duration = value if isinstance(value, (int, float)) else 2000
            stop_bgm(fade_ms=int(duration))
        elif key == "bgm_fade_in":
            duration = value if isinstance(value, (int, float)) else 2000
            if game.field_theme:
                play_bgm(game.field_theme, fade_ms=int(duration))
        elif key == "schedule":
            for enc_id, delay in value.items():
                path = BASE_DIR / "encounter_normal" / "schedule" / f"{enc_id}.json"
                data = load_json(path)
                if data:
                    game.scheduled.append({"after": delay, "encounter": data})
                else:
                    print(f"\n[오류] 예약된 인카운터 파일을 찾을 수 없습니다: {path}")
        elif key == "sfx":
            play_sfx(value)
        elif key == "change_name" and char:
            char.name = value
            print(f"이름이 [{value}](으)로 변경되었습니다.")
            has_pending_msg = True
        elif key == "max_cost" and char:
            char.max_cost = max(1, char.max_cost + value)
            char.current_cost = min(char.max_cost, char.current_cost)
            print(f"최대 빛 {value:+} (현재: {char.max_cost})")
            has_pending_msg = True
        elif key == "card_slot" and char:
            char.card_slot = max(1, char.card_slot + value)
            print(f"최대 슬롯 {value:+} (현재: {char.card_slot})")
            has_pending_msg = True
        elif key == "endurance" and char:
            for dtype, mod in value.items():
                old = char.base_endurance.get(dtype, 1.0)
                new = round(max(0.1, old + mod), 1)
                char.base_endurance[dtype] = new
                if not char.is_staggered:
                    char.endurance[dtype] = new
                type_name = DICE_TYPE_MAP.get(dtype, dtype)
                print(f"[{type_name}] 피해 내성 {mod:+} (현재: {new}x)")
            has_pending_msg = True
        elif key == "stagger_endurance" and char:
            for dtype, mod in value.items():
                old = char.base_stagger_endurance.get(dtype, 1.0)
                new = round(max(0.1, old + mod), 1)
                char.base_stagger_endurance[dtype] = new
                if not char.is_staggered:
                    char.stagger_endurance[dtype] = new
                type_name = DICE_TYPE_MAP.get(dtype, dtype)
                print(f"[{type_name}] 흐트러짐 내성 {mod:+} (현재: {new}x)")
            has_pending_msg = True
        elif key == "choice_remove_gadget_category" and char:
            cat = value.get("category")
            count = value.get("count", 1)
            title = f"사용할 {cat} 가젯을 선택하세요."
            removed = select_gadget_from_inventory(char, title, filter_category=cat, count=count)
            if removed:
                has_pending_msg = True

    if has_pending_msg and not game.ended:
        pause()


def calculate_chance(choice):
    player = game.player_char
    chance = choice.get("chance", 100)
    if not player:
        return chance

    bonus_item = choice.get("bonus_item")
    if bonus_item:
        per = choice.get("bonus_per_item", 0)
        chance += player.gadget_count(bonus_item) * per

    for item_name, penalty_val in choice.get("penalty_items", {}).items():
        if player.has_gadget(item_name):
            chance -= penalty_val

    for item_name, per_val in choice.get("penalty_per_items", {}).items():
        chance -= player.gadget_count(item_name) * per_val

    for cat_name, per_val in choice.get("penalty_category", {}).items():
        count = sum(
            g_count for g_id, g_count in player.gadgets.items()
            if load_gadget_data(g_id) and cat_name in load_gadget_data(g_id).get("category", [])
        )
        chance -= count * per_val

    penalty_item = choice.get("penalty_item")
    if penalty_item:
        per = choice.get("penalty_per_item", 0)
        chance -= player.gadget_count(penalty_item) * per

    return max(0, min(100, chance))


def roll_choice(choice):
    chance = calculate_chance(choice)
    roll = random.randint(1, 100)
    print(f"\n성공률 : {chance}%\n주사위 : {roll}")
    return roll <= chance


def get_valid_choices(node):
    all_choices = node.get("choices", [])
    filtered_choices = []
    for choice in all_choices:
        is_met = check_requirements(choice.get("requirements"))
        if is_met or choice.get("show", True):
            filtered_choices.append(choice)
    return filtered_choices


def run_encounter(encounter):
    current_node = encounter["start"]
    visited_nodes = set()

    while True:
        clear_screen()
        node = encounter["nodes"][current_node]

        print("\n" + "=" * 50)
        print(node["text"])
        print("=" * 50)

        if current_node not in visited_nodes:
            apply_effects(node.get("effects"))
            visited_nodes.add(current_node)

        if game.ended or node.get("end"):
            if not game.ended and not node.get("effects"):
                pause()
            return {"type": "end"}

        choices = get_valid_choices(node)
        if game.ended:
            return {"type": "end"}
        if not choices:
            print("\n선택지가 없습니다.")
            return {"type": "end"}

        for i, choice in enumerate(choices, start=1):
            chance_val = None
            branches = choice.get("branches", [])
            valid_branch = next((b for b in branches if check_requirements(b.get("requirements"))), None)

            if valid_branch and "chance" in valid_branch:
                chance_val = calculate_chance(valid_branch)
            elif "chance" in choice:
                chance_val = calculate_chance(choice)

            chance_text = f" [{chance_val}%]" if chance_val is not None else ""
            is_met = check_requirements(choice.get("requirements"))
            if is_met:
                print(f"{i}. {choice['text']}{chance_text}")
            else:
                print(f"{i}. \033[31m{choice['text']}{chance_text} (조건 미충족)\033[0m")

        print("\n['정보' 입력 시 상세 상태 확인 가능]")

        while True:
            cmd = input("\n> ").strip()

            if cmd == "정보":
                show_detailed_status()
                clear_screen()
                print("\n" + "=" * 50)
                print(node["text"])
                print("=" * 50)
                for i, choice in enumerate(choices, start=1):
                    chance_val = None
                    branches = choice.get("branches", [])
                    valid_branch = next((b for b in branches if check_requirements(b.get("requirements"))), None)

                    if valid_branch and "chance" in valid_branch:
                        chance_val = calculate_chance(valid_branch)
                    elif "chance" in choice:
                        chance_val = calculate_chance(choice)

                    chance_text = f" [{chance_val}%]" if chance_val is not None else ""
                    is_met = check_requirements(choice.get("requirements"))
                    if is_met:
                        print(f"{i}. {choice['text']}{chance_text}")
                    else:
                        print(f"{i}. \033[31m{choice['text']}{chance_text} (조건 미충족)\033[0m")
                print("\n['정보' 입력 시 상세 상태 확인 가능]")
                continue

            try:
                select = int(cmd) - 1
                if 0 <= select < len(choices):
                    if check_requirements(choices[select].get("requirements")):
                        break
                    else:
                        print("\033[31m[경고] 요구 사항을 충족하지 못해 선택할 수 없습니다.\033[0m")
            except ValueError:
                pass

        choice = choices[select]
        clear_screen()

        branches = choice.get("branches", [])
        branch_resolved = False

        for branch in branches:
            if check_requirements(branch.get("requirements")):
                apply_effects(branch.get("effects"))
                if "chance" in branch:
                    if roll_choice(branch):
                        apply_effects(branch.get("success_effects"))
                        current_node = branch["success"]
                    else:
                        apply_effects(branch.get("fail_effects"))
                        current_node = branch["fail"]
                elif "next" in branch:
                    current_node = branch["next"]
                elif "next_main" in branch:
                    return {"type": "next_main", "target": branch["next_main"]}
                elif "ending" in branch:
                    return {"type": "ending", "name": branch["ending"]}
                elif branch.get("end"):
                    return {"type": "end"}
                else:
                    continue

                branch_resolved = True
                break

        if branch_resolved:
            continue

        apply_effects(choice.get("effects"))

        if "chance" in choice:
            if roll_choice(choice):
                apply_effects(choice.get("success_effects"))
                current_node = choice["success"]
            else:
                apply_effects(choice.get("fail_effects"))
                current_node = choice["fail"]
            continue

        if "next" in choice:
            current_node = choice["next"]
            continue

        if "next_main" in choice:
            return {"type": "next_main", "target": choice["next_main"]}

        if "ending" in choice:
            return {"type": "ending", "name": choice["ending"]}

        if choice.get("end"):
            return {"type": "end"}


def tick_scheduled():
    for data in game.scheduled:
        data["after"] -= 1


def get_scheduled_ready():
    ready = []
    remain = []
    for data in game.scheduled:
        if data["after"] <= 0:
            ready.append(data["encounter"])
        else:
            remain.append(data)
    game.scheduled = remain
    return ready


def get_random_common():
    if not game.common_deck:
        return None
    return game.common_deck.pop(0)


def run_sub_events(count=None):
    if count is None:
        count = random.randint(2, 4)

    for _ in range(count):
        tick_scheduled()
        ready = get_scheduled_ready()
        encounter = random.choice(ready) if ready else get_random_common()

        if encounter is None:
            continue

        run_encounter(encounter)
        if game.player_char and game.player_char.hp <= 0:
            game.ended = True
            game.ending_name = "death_hp"
            return


def get_main_encounter(encounter_id):
    if encounter_id not in game.main_encounters:
        print(f"\n메인 인카운터 없음: {encounter_id}")
        game.ended = True
        game.ending_name = "missing_main"
        return None
    return game.main_encounters[encounter_id]


def show_ending():
    print("\n" + "=" * 50)
    print("게임 종료")
    print("=" * 50)
    print(f"\n엔딩 : {game.ending_name}\n")

    show_status()
    if not game.player_char:
        pause()
        return

    if game.player_char.hp <= 0 or game.player_char.sanity <= 0:
        game.profile["death_count"] = game.profile.get("death_count", 0) + 1
        save_profile(game.profile)
        play_bgm("death_theme.mp3", loop=-1, fade_ms=1000)
        print("\n" + "!" * 50)
        print("당신은 도시의 차가운 바닥에서 숨을 거두었습니다...")
        print("공동묘지에 남길 마지막 한 마디(유언)를 적어주세요.")
        will = input("> ").strip()
        save_tombstone(will)
    else:
        save_clear_record()

    pause()
    stop_bgm(fade_ms=1000)


def game_loop():
    current_main = "start"
    total_main = len(game.main_encounters)
    total_sub_events = len(game.common_deck)
    mains_played = 0
    remaining_sub = total_sub_events

    while True:
        if game.player_char:
            v_flag = game.profile.get("flags", {}).get("vending_unlocked", 0)
            if int(v_flag) > 0:
                vm_pool = game.special_encounters.get("vending_machine", [])
                target_id = f"vending_machine{v_flag}"
                target_enc = next((enc for enc in vm_pool if enc.get("id") == target_id), None)
                if target_enc:
                    run_encounter(target_enc)
                    if game.ended:
                        break

        encounter = get_main_encounter(current_main)
        if encounter is None:
            return

        mains_played += 1
        result = run_encounter(encounter)

        if game.player_char and game.player_char.hp <= 0:
            game.ended = True
            game.ending_name = "사망"
            break

        if result.get("type") == "ending":
            game.ended = True
            game.ending_name = result["name"]
            break

        if result.get("type") == "next_main":
            next_main = result["target"]
            gaps_remaining = max(1, total_main - mains_played)
            if gaps_remaining > 0:
                count = remaining_sub // gaps_remaining
                run_sub_events(count)
                remaining_sub -= count

            if game.ended:
                break
            current_main = next_main
            continue

        if result.get("type") == "end":
            if game.ended:
                break
            continue

    show_ending()


# ==================================================
# 프로필 및 도감 / 기록 시스템
# ==================================================

PROFILE_PATH = DATA_DIR / "player" / "profile.json"


def save_profile(data):
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def load_profile():
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PROFILE_PATH.exists():
        data = {
            "death_count": 0,
            "achievements": [],
            "unlocked_cards": [],
            "unlocked_enemies": [],
            "enemy_kills": {},
            "unlocked_gadgets": [],
            "flags": {},
        }
        save_profile(data)
        return data

    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def give_achievement(achievement_name):
    achievements = game.profile.setdefault("achievements", [])
    if achievement_name in achievements:
        return

    achievements.append(achievement_name)
    save_profile(game.profile)
    print("\n" + "=" * 40)
    print(f"도전과제 달성!\n{achievement_name}")
    print("=" * 40)


def show_profile():
    profile = game.profile
    print("\n" + "=" * 50)
    print("내 정보")
    print("=" * 50)
    print(f"\n죽은 횟수 : {profile.get('death_count', 0)}\n\n도전과제")

    achievements = profile.get("achievements", [])
    if not achievements:
        print("없음")
    else:
        for ach in achievements:
            print(f"- {ach}")
    input("\n엔터를 눌러 돌아가기")


def update_encyclopedia(enemy=None, player=None, gadget_id=None):
    profile = game.profile
    updated = False

    if enemy:
        enemy_kills = profile.setdefault("enemy_kills", {})
        enemy_kills[enemy.id] = enemy_kills.get(enemy.id, 0) + 1
        updated = True

        if enemy.id not in profile.setdefault("unlocked_enemies", []):
            profile["unlocked_enemies"].append(enemy.id)
            updated = True
        for card_id in enemy.deck:
            if card_id not in profile.setdefault("unlocked_cards", []):
                profile["unlocked_cards"].append(card_id)
                updated = True

    if player:
        for card_id in player.deck:
            if card_id not in profile.setdefault("unlocked_cards", []):
                profile["unlocked_cards"].append(card_id)
                updated = True

    if gadget_id:
        if gadget_id not in profile.setdefault("unlocked_gadgets", []):
            profile["unlocked_gadgets"].append(gadget_id)
            updated = True

    if updated:
        save_profile(profile)


def save_tombstone(will):
    GRAVES_DIR.mkdir(exist_ok=True)
    char = game.player_char
    data = {
        "name": char.name,
        "hp": char.hp,
        "max_hp": char.max_hp,
        "sanity": char.sanity,
        "max_sanity": char.max_sanity,
        "stagger_resist": char.stagger_resist,
        "endurance": char.base_endurance,
        "stagger_endurance": char.base_stagger_endurance,
        "passives": char.passives,
        "max_cost": char.max_cost,
        "card_slot": char.card_slot,
        "deck": char.deck,
        "gadgets": char.gadgets,
        "will": will,
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    filename = f"grave_{int(time.time())}.json"
    with open(GRAVES_DIR / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"\n[{char.name}]의 묘비가 세워졌습니다.")


def save_clear_record():
    CLEARS_DIR.mkdir(exist_ok=True)
    char = game.player_char
    data = {
        "name": char.name,
        "level": getattr(char, "level", 1),
        "hp": char.hp,
        "max_hp": char.max_hp,
        "sanity": char.sanity,
        "max_sanity": char.max_sanity,
        "stagger_resist": char.stagger_resist,
        "endurance": char.base_endurance,
        "stagger_endurance": char.base_stagger_endurance,
        "passives": char.passives,
        "max_cost": char.max_cost,
        "card_slot": char.card_slot,
        "deck": char.deck,
        "gadgets": char.gadgets,
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "story": game.story_name,
    }
    filename = f"clear_{int(time.time())}.json"
    with open(CLEARS_DIR / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"\n[{char.name}]의 기록이 서재에 보관되었습니다.")


def show_graves():
    while True:
        clear_screen()
        print("=" * 50)
        print("공동묘지")
        print("=" * 50)

        if not GRAVES_DIR.exists() or not list(GRAVES_DIR.glob("*.json")):
            print("묘비가 없습니다.")
            pause()
            return

        files = list(GRAVES_DIR.glob("*.json"))
        for i, f in enumerate(files, 1):
            d = load_json(f)
            if d:
                print(f"{i}. {d.get('name', '???')} ({d.get('date', '')})")

        print("\n[번호] 상세 보기 (0: 돌아가기)")
        try:
            cmd = input("\n> ").strip()
            if cmd == "0":
                break
            choice = int(cmd) - 1
            if 0 <= choice < len(files):
                show_grave_detail(files[choice])
        except (ValueError, IndexError):
            continue


def show_grave_detail(file_path):
    data = load_json(file_path)
    if not data:
        print("기록을 불러올 수 없습니다.")
        pause()
        return

    clear_screen()
    print("=" * 50)
    print(f"<{data.get('name', '???')}의 묘비>")
    print(f"사망 일시: {data.get('date', '알 수 없음')}\n" + "-" * 50)
    print(f"유언: \"{data.get('will', '')}\"\n" + "-" * 50)
    print(f"최종 체력: {data.get('hp', 0)} / {data.get('max_hp', 0)}")
    print(f"최종 정신력: {data.get('sanity', 0)} / {data.get('max_sanity', 0)}")
    print(f"최대 흐트러짐 저항: {data.get('stagger_resist', 20)}")

    print("\n[내성 정보]")
    endurance = data.get("endurance", {})
    stagger = data.get("stagger_endurance", {})
    for k in ["slash", "pierce", "blunt"]:
        print(f"- {DICE_TYPE_MAP.get(k, k)}: 피해 {endurance.get(k, 1.0)}x / 흐트러짐 {stagger.get(k, 1.0)}x")

    print("\n[보유 패시브]")
    passives = data.get("passives", [])
    if not passives:
        print("없음")
    else:
        for p_id in passives:
            p_info = load_passive_data(p_id)
            print(f"- {p_info.get('name', p_id) if p_info else p_id}")

    print("\n[보유 가젯]")
    gadgets = data.get("gadgets", {})
    if not gadgets:
        print("없음")
    else:
        for g_id, count in gadgets.items():
            g_data = load_gadget_data(g_id)
            print(f"- {g_data.get('name', g_id) if g_data else g_id} x{count}")

    print("\n[최종 덱]")
    deck = data.get("deck", {})
    if not deck:
        print("없음")
    else:
        for card_id, count in deck.items():
            try:
                print(f"- {load_card(card_id).name} (x{count})")
            except Exception:
                print(f"- {card_id} (x{count})")
    print("=" * 50)
    pause()


def show_clears():
    while True:
        clear_screen()
        print("=" * 50)
        print("명예의 전당")
        print("=" * 50)

        if not CLEARS_DIR.exists() or not list(CLEARS_DIR.glob("*.json")):
            print("클리어 기록이 없습니다.")
            pause()
            return

        files = list(CLEARS_DIR.glob("*.json"))
        for i, f in enumerate(files, 1):
            d = load_json(f)
            if d:
                print(f"{i}. {d.get('name', '???')} - {d.get('story', '알 수 없음')} ({d.get('date', '')})")

        print("\n[번호] 상세 보기 (0: 돌아가기)")
        try:
            cmd = input("\n> ").strip()
            if cmd == "0":
                break
            choice = int(cmd) - 1
            if 0 <= choice < len(files):
                show_clear_detail(files[choice])
        except (ValueError, IndexError):
            continue


def show_clear_detail(file_path):
    data = load_json(file_path)
    if not data:
        print("기록을 불러올 수 없습니다.")
        pause()
        return

    clear_screen()
    print("=" * 50)
    print(f"<{data.get('name', '???')}의 클리어 기록>")
    print(f"클리어 일시: {data.get('date', '알 수 없음')}")
    print(f"진행 스토리: {data.get('story', '알 수 없음')}\n" + "-" * 50)
    print(f"최종 체력: {data.get('hp', 0)} / {data.get('max_hp', 0)}")
    print(f"최종 정신력: {data.get('sanity', 0)} / {data.get('max_sanity', 0)}")
    print(f"최대 흐트러짐 저항: {data.get('stagger_resist', 20)}")

    print("\n[내성 정보]")
    endurance = data.get("endurance", {})
    stagger = data.get("stagger_endurance", {})
    for k in ["slash", "pierce", "blunt"]:
        print(f"- {DICE_TYPE_MAP.get(k, k)}: 피해 {endurance.get(k, 1.0)}x / 흐트러짐 {stagger.get(k, 1.0)}x")

    print("\n[보유 패시브]")
    passives = data.get("passives", [])
    if not passives:
        print("없음")
    else:
        for p_id in passives:
            p_info = load_passive_data(p_id)
            print(f"- {p_info.get('name', p_id) if p_info else p_id}")

    print("\n[보유 가젯]")
    gadgets = data.get("gadgets", {})
    if not gadgets:
        print("없음")
    else:
        for g_id, count in gadgets.items():
            g_data = load_gadget_data(g_id)
            print(f"- {g_data.get('name', g_id) if g_data else g_id} x{count}")

    print("\n[최종 덱]")
    deck = data.get("deck", {})
    if not deck:
        print("없음")
    else:
        for card_id, count in deck.items():
            try:
                print(f"- {load_card(card_id).name} (x{count})")
            except Exception:
                print(f"- {card_id} (x{count})")
    print("=" * 50)
    pause()


# ==================================================
# 메뉴 및 사용자 인터페이스
# ==================================================

def show_card_encyclopedia():
    while True:
        clear_screen()
        print("=" * 50)
        print("카드 도감")
        print("=" * 50)

        unlocked = game.profile.get("unlocked_cards", [])
        if not unlocked:
            print("기록된 카드가 없습니다.")
            pause()
            return

        for i, card_id in enumerate(unlocked, 1):
            try:
                card = load_card(card_id)
                print(f"{i}. {card.name}")
            except Exception:
                print(f"{i}. {card_id} (정보 없음)")

        print("\n[번호] 상세 정보 (0: 돌아가기)")
        try:
            choice = int(input("\n> ")) - 1
            if choice == -1:
                break
            if 0 <= choice < len(unlocked):
                card = load_card(unlocked[choice])
                show_card_info(card)
        except (ValueError, IndexError):
            continue


def show_enemy_encyclopedia():
    while True:
        clear_screen()
        print("=" * 50)
        print("적 정보 도감")
        print("=" * 50)

        unlocked = game.profile.get("unlocked_enemies", [])
        if not unlocked:
            print("처치 기록이 있는 적이 없습니다.")
            pause()
            return

        for i, enemy_id in enumerate(unlocked, 1):
            try:
                data = load_enemy(enemy_id)
                name = data["status"].get("name", enemy_id)
                kill_count = game.profile.get("enemy_kills", {}).get(enemy_id, 0)
                print(f"{i}. {name} (처치: {kill_count}회)")
            except Exception:
                print(f"{i}. {enemy_id} (정보 없음)")

        print("\n[번호] 상세 정보 (0: 돌아가기)")
        try:
            choice = int(input("\n> ")) - 1
            if choice == -1:
                break
            if 0 <= choice < len(unlocked):
                show_enemy_encyclopedia_detail(unlocked[choice])
        except (ValueError, IndexError):
            continue


def show_enemy_encyclopedia_detail(enemy_id):
    try:
        data = load_enemy(enemy_id)
        status = data["status"]
        clear_screen()
        print("=" * 50)
        print(f"<{status.get('name', enemy_id)} 상세 정보>")
        kill_count = game.profile.get("enemy_kills", {}).get(enemy_id, 0)
        print(f"총 처치 횟수: {kill_count}회\n" + "-" * 50)
        print(f"최대 체력: {status.get('hp', 0)}")
        print(f"최대 정신력: {status.get('sanity', 0)}")
        print(f"흐트러짐 저항: {status.get('stagger_resist', 20)}")

        print("\n[내성 정보]")
        endurance = status.get("endurance", {})
        stagger = status.get("stagger_endurance", {})
        for k in ["slash", "pierce", "blunt"]:
            print(f"- {DICE_TYPE_MAP.get(k, k)}: 피해 {endurance.get(k, 1.0)}x / 흐트러짐 {stagger.get(k, 1.0)}x")

        print("\n[보유 패시브]")
        passives = status.get("passives", [])
        if not passives:
            print("없음")
        else:
            for p_id in passives:
                p_info = load_passive_data(p_id)
                print(f"- {p_info.get('name', p_id) if p_info else p_id}")

        print("\n[사용 카드 목록]")
        deck = status.get("deck", {})
        for card_id, count in deck.items():
            try:
                print(f"- {load_card(card_id).name} (x{count})")
            except Exception:
                print(f"- {card_id} (x{count})")
        print("=" * 50)
        pause()
    except Exception:
        print("정보를 불러오는데 실패했습니다.")
        pause()


def show_gadget_encyclopedia():
    while True:
        unlocked = game.profile.get("unlocked_gadgets", [])
        if not unlocked:
            clear_screen()
            print("=" * 50)
            print("가젯 도감\n" + "-" * 50)
            print("획득한 기록이 있는 가젯이 없습니다.\n" + "=" * 50)
            pause()
            return

        cat_map = {}
        for g_id in unlocked:
            data = load_gadget_data(g_id)
            cats = data.get("category", ["기타"]) if data else ["알 수 없음"]
            for c in cats:
                cat_map.setdefault(c, []).append(g_id)

        sorted_cats = sorted(list(cat_map.keys()))

        clear_screen()
        print("=" * 50)
        print("가젯 도감 - 카테고리 선택\n" + "-" * 50)
        for i, cat in enumerate(sorted_cats, 1):
            print(f"{i}. {cat} ({len(cat_map[cat])}종)")
        print("0. 돌아가기\n" + "=" * 50)

        try:
            c_idx = int(input("\n> ")) - 1
            if c_idx == -1:
                break
            if 0 <= c_idx < len(sorted_cats):
                selected_cat = sorted_cats[c_idx]
                show_gadget_list_in_category(selected_cat, cat_map[selected_cat])
        except (ValueError, IndexError):
            continue


def show_gadget_list_in_category(category_name, gadget_ids):
    while True:
        clear_screen()
        print("=" * 50)
        print(f"가젯 도감 - [{category_name}]\n" + "-" * 50)

        for i, g_id in enumerate(gadget_ids, 1):
            data = load_gadget_data(g_id)
            name = data.get("name", g_id) if data else g_id
            print(f"{i}. {name}")
        print("0. 돌아가기\n" + "=" * 50)

        try:
            choice = int(input("\n> ")) - 1
            if choice == -1:
                break
            if 0 <= choice < len(gadget_ids):
                show_gadget_info(gadget_ids[choice])
        except (ValueError, IndexError):
            continue


def show_gadget_info(gadget_id):
    data = load_gadget_data(gadget_id)
    if not data:
        print("\n가젯 정보를 불러올 수 없습니다.")
        pause()
        return

    clear_screen()
    print("=" * 50)
    print(f"[{data.get('name', gadget_id)}]")
    print(f"카테고리: {', '.join(data.get('category', []))}\n" + "-" * 50)
    print(f"\n{data.get('desc', '설명이 없습니다.')}\n\n" + "=" * 50)
    pause()


def encyclopedia_menu():
    while True:
        clear_screen()
        print("=" * 50)
        print("도감\n" + "-" * 50)
        print("1. 카드")
        print("2. 적 정보")
        print("3. 가젯")
        print("0. 돌아가기")

        cmd = input("\n> ").strip()
        if cmd == "1":
            show_card_encyclopedia()
        elif cmd == "2":
            show_enemy_encyclopedia()
        elif cmd == "3":
            show_gadget_encyclopedia()
        elif cmd == "0":
            break


def library_menu():
    while True:
        clear_screen()
        print("=" * 50)
        print("서재\n" + "-" * 50)
        print("1. 공동묘지 (사망 기록)")
        print("2. 명예의 전당 (클리어 기록)")
        print("3. 도감")
        print("4. 크레딧")
        print("0. 돌아가기")

        cmd = input("\n> ").strip()
        if cmd == "1":
            show_graves()
        elif cmd == "2":
            show_clears()
        elif cmd == "3":
            encyclopedia_menu()
        elif cmd == "4":
            clear_screen()
            print("=" * 50 + "\nCREDITS\n" + "-" * 50)
            print("개발자: 30102 권순형 (2026년 코딩 크래프트 동아리 제출용)")
            print("(본 게임은 '프로젝트 문'의 '도시' 세계관을 바탕으로 하는 2차 창작물입니다.)\n" + "=" * 50)
            pause()
        elif cmd == "0":
            break


def pick_character():
    clear_screen()
    print("캐릭터 선택 소스\n" + "-" * 20)
    print("1. 기본 캐릭터 (player/char)")
    print("2. 클리어 기록 (clears)")

    src = input("\n> ").strip()
    if src == "2":
        path = CLEARS_DIR
        if not path.exists() or not list(path.glob("*.json")):
            print("\n클리어 기록이 없습니다. 기본 폴더에서 로드합니다.")
            path = BASE_DIR / "player" / "char"
            pause()
    else:
        path = BASE_DIR / "player" / "char"

    chars = list(path.glob("*.json"))
    if not chars:
        print("\n사용 가능한 캐릭터가 없습니다.")
        return False

    print("\n캐릭터 선택\n")
    for i, f in enumerate(chars, 1):
        if src == "2":
            try:
                d = load_json(f)
                print(f"{i}. {d['name']} (LV.{d['level']}) - {d['date']}")
            except Exception:
                print(f"{i}. {f.name} (데이터 손상)")
        else:
            print(f"{i}. {f.stem}")

    while True:
        cmd = input("\n> ").strip()
        if not cmd:
            continue
        try:
            choice = int(cmd) - 1
            if 0 <= choice < len(chars):
                if load_and_set_player(chars[choice]):
                    return True
        except ValueError:
            continue


def pick_enemy():
    path = BASE_DIR / "enemy"
    enemies = list(path.glob("*.json"))
    if not enemies:
        print("\n사용 가능한 적이 없습니다.")
        return None

    print("\n적 선택\n")
    for i, f in enumerate(enemies, 1):
        print(f"{i}. {f.stem}")

    while True:
        try:
            choice = int(input("\n> ")) - 1
            if 0 <= choice < len(enemies):
                return enemies[choice].stem
        except (ValueError, IndexError):
            pass


def suppression_mode():
    clear_screen()
    if not pick_character():
        pause()
        return

    clear_screen()
    enemy_id = pick_enemy()
    if not enemy_id:
        pause()
        return

    game.ended = False
    game.ending_name = None
    game.allies = []
    start_battle([enemy_id])

    if game.ended:
        show_ending()

    game.ended = False
    game.ending_name = None


def load_player_char_file(char_id):
    path = BASE_DIR / "player" / "char" / f"{char_id}.json"
    if not path.exists():
        raise Exception(f"캐릭터 없음: {char_id}")
    return load_json(path)


def load_and_set_player(full_path):
    data = load_json(full_path)
    if not data:
        return False
    game.player_char = PlayerChar(data)
    return True


def create_player_char(char_id):
    data = load_player_char_file(char_id)
    if not data:
        return f"오류: {char_id} 캐릭터 데이터를 불러올 수 없습니다."
    game.player_char = PlayerChar(data)
    return f"{game.player_char.name} 로 플레이 시작!"


def start_game_menu():
    while True:
        clear_screen()
        print("=" * 50)
        print("모드 선택\n" + "-" * 50)
        print("1. 스토리 모드 (메인 시나리오 진행)")
        print("2. 제압 모드 (단판 승부)")
        print("0. 돌아가기")

        cmd = input("\n> ").strip()
        if cmd == "1":
            return "story"
        elif cmd == "2":
            suppression_mode()
            return None
        elif cmd == "0":
            return None


def show_main_menu():
    play_bgm("title_theme.mp3", loop=-1, fade_ms=1000)
    while True:
        clear_screen()
        print("\n" + "=" * 50)
        print("CITY")
        print("=" * 50)
        print("1. 게임 시작")
        print("2. 서재")
        print("3. 상점")
        print("4. 내 정보")
        print("5. 게임 종료")

        try:
            choice = input("\n> ").strip()
            if choice == "1":
                mode = start_game_menu()
                if mode:
                    stop_bgm(fade_ms=500)
                    return mode
            elif choice == "2":
                library_menu()
            elif choice == "3":
                print("\n상점 준비중")
                pause()
            elif choice == "4":
                show_profile()
            elif choice == "5":
                quit()
        except Exception as e:
            print(f"\n[시스템 오류] {e}")
            pause()
            continue


# ==================================================
# 카드 객체 및 덱 유틸리티
# ==================================================

class Card:
    def __init__(self, data):
        self.id = data["id"]
        self.name = data["name"]
        self.type = data.get("type", "melee")
        self.cost = data["cost"]
        self.grade = data.get("grade", "paperback")
        self.dice = data["dice"]
        self.on_use_dialogue = data.get("on_use_dialogue", "")
        self.on_use_effect = data.get("on_use_effect", [])
        self.mode_change = data.get("mode_change", {})


def load_card(card_id):
    data = get_card_data_internal(card_id)
    if not data:
        print(f"경고: {card_id} 카드 데이터가 유효하지 않습니다.")
        return Card({"id": card_id, "name": "유효하지 않은 카드", "cost": 0, "dice": []})
    return Card(data)


def build_deck_list(deck_dict):
    result = []
    for card_id, amount in deck_dict.items():
        for _ in range(amount):
            result.append(card_id)
    random.shuffle(result)
    return result


def draw_cards(unit, amount):
    for _ in range(amount):
        if not unit.draw_pile:
            if not unit.discard_pile:
                return
            unit.draw_pile = unit.discard_pile.copy()
            random.shuffle(unit.draw_pile)
            unit.discard_pile.clear()

        card_ref = unit.draw_pile.pop()
        card = card_ref if isinstance(card_ref, Card) else load_card(card_ref)
        unit.hand.append(card)


def print_hand(unit):
    print("\n" + "=" * 50 + "\n패\n")
    if not unit.hand:
        print("없음")
    else:
        for i, card in enumerate(unit.hand, start=1):
            print(f"{i}. {card.name} (코스트 {card.cost})")
    print("=" * 50)


# ==================================================
# 초기화 및 진입점
# ==================================================

def initialize_game():
    game.profile = load_profile()
    story = choose_story()
    game.main_encounters = load_main_story(story)
    game.common_encounters = load_common_encounters()
    game.common_deck = game.common_encounters.copy()
    random.shuffle(game.common_deck)
    game.special_encounters = load_special_encounters()

    print(f"\n[{story}] 로드 완료")
    update_encyclopedia(player=game.player_char)


def main():
    game.profile = load_profile()

    while True:
        mode = show_main_menu()

        game.ended = False
        game.ending_name = None
        game.scheduled = []
        game.seen_encounters = set()
        game.player_char = None
        game.allies = []

        if mode == "story":
            initialize_game()
            game_loop()


if __name__ == "__main__":
    main()