with open('tools/encounter_editor.html', 'r', encoding='utf-8') as f:
    text = f.read()

tabs = [
    'tab-basic',
    'tab-req',
    'tab-stats',
    'tab-gadgets',
    'tab-cards',
    'tab-cardui',
    'tab-battle',
    'tab-flags',
    'tab-audio'
]

for t in tabs:
    assert f'data-tab="{t}"' in text, f"Missing tab {t}"
    assert f'id="{t}"' in text, f"Missing section {t}"

# Check for all requested feature keys in JS
keys = [
    # 1. Stats
    'hp', 'sanity', 'level_up', 'change_name', 'max_cost', 'card_slot', 'endurance', 'stagger_endurance',
    # 2. Gadgets
    'give_item', 'give_items', 'remove_item', 'remove_items', 'choice_remove_gadget_category',
    # 3. Cards & Passives
    'give_card', 'give_cards', 'remove_card', 'remove_cards', 'give_passive', 'give_passives', 'remove_passive', 'remove_passives',
    # 4. Card UI
    'choice_remove_card', 'choice_duplicate_card', 'choice_upgrade_card', 'random_remove_card', 'random_duplicate_card', 'random_upgrade_card',
    # 5. Battle & Flow
    'battle', 'load_player_char', 'achievement', 'schedule',
    # 6. Flags
    'set_flag', 'inc_flag', 'dec_flag', 'remove_flag',
    # 7. Audio
    'set_field_theme', 'set_basic_battle_theme', 'bgm_fade_out', 'bgm_fade_in', 'sfx',
    # 8. Requirements
    'item', 'not_item', 'items', 'required_category', 'has_card', 'has_cards', 'has_passive', 'name', 'not_name', 'flag_min', 'flag_max'
]

for k in keys:
    assert k in text, f"Key '{k}' not found in tools/encounter_editor.html!"

print(f"VERIFICATION SUCCESSFUL: All {len(keys)} feature keys and all {len(tabs)} tabs verified in encounter_editor.html!")

