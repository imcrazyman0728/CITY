with open('web/js/encounter.js', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find('case "set_basic_battle_theme":')
if idx != -1:
    print(text[idx:idx+2500])

