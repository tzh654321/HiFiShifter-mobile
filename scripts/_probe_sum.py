import json, sys

d = json.load(sys.stdin)
print('vp', d['vp'])
print('bar', d['bar'], '（原 45 高）')
for it in d['items']:
    v = it.get('visual')
    print('  %-12s btn=%s 视觉=%s bg=%s color=%s' % (
        it['label'], it['rect'], (v['rect'] if v else None),
        (v['bg'] if v else '-'), (v['color'] if v else '-')))
print('gestureTargets:')
for g in d['gestureTargets']:
    print('  ', g['tag'], g['rect'], g['cls'])
print('paramScroller', d['paramScroller'])
print('hooks', d['hooks'])
print('ticks', d['ticks'][:5])
print('popovers', json.dumps(d.get('popovers'), ensure_ascii=False))
