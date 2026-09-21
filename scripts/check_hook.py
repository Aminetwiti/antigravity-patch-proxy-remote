with open(r'C:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\src\rendererHook.js', 'r', encoding='utf-8') as f:
    text = f.read()

print('old_click found:', 'if (text.includes(\'Local\') && !text.includes(\'Remote\'))' in text)
print('syncRemoteStateToProxy found:', 'function syncRemoteStateToProxy' in text)
