with open(r'C:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\src\proxy.ts', 'r', encoding='utf-8') as f:
    text = f.read()

print('old_stream_start found:', 'function transformGoogleStreamForRemote(' in text)
print('Array.isArray(data.candidates) count:', text.count('Array.isArray(data.candidates)'))
