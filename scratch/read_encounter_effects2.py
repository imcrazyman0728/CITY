with open('web/js/encounter.js', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find('case "set_flag":')
if idx != -1:
    print(text[idx:idx+3500])
else:
    print("Not found")

