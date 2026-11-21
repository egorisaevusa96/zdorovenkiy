"""Вырезает картинки Codex из пурпурного фона (#FF00FF) и сохраняет в img/ui/*.webp.
Запуск: python design/assets/cut.py (из папки проекта)."""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'img', 'ui')
os.makedirs(OUT, exist_ok=True)

NAMES = [
    'glass-full', 'glass-empty', 'salad', 'camera',
    'sneaker', 'dumbbell', 'moon', 'scale',
    'calendar', 'bulb', 'fire', 'star',
    'egg', 'soup', 'fish', 'apple',
]


def key(im, glass=False):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    # «пурпурность»: красный и синий высокие и похожи, зелёный низкий
    mag = np.minimum(r, b) - g
    similar = 1 - np.clip(np.abs(r - b) / 90.0, 0, 1)          # R≈B → оттенок пурпурный
    alpha = 1 - np.clip((mag - 60) / 150.0, 0, 1) * similar
    # почти прозрачный «туман» от шума картинки — в ноль
    alpha = np.clip((alpha - 0.1) / 0.9, 0, 1)
    # убираем пурпурную примесь с краёв: F = (P - (1-a)·M) / a
    M = np.array([255, 0, 255], np.float32)
    ae = np.maximum(alpha, 0.05)[..., None]
    f = (a - (1 - alpha)[..., None] * M) / ae
    f = np.clip(f, 0, 255)
    # остаток пурпура на полупрозрачных краях
    spill = np.clip(np.minimum(f[..., 0], f[..., 2]) - f[..., 1], 0, None) * similar
    f[..., 0] -= spill * 0.8
    f[..., 2] -= spill * 0.5
    if glass:
        # стекло просвечивало розовым — делаем его голубоватым
        tint = np.clip(np.minimum(f[..., 0], f[..., 2]) - f[..., 1], 0, None)
        f[..., 0] -= tint
        f[..., 2] = np.clip(f[..., 2] + tint * 0.2, 0, 255)
    f = np.clip(f, 0, 255)
    out = np.dstack([f, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def trim(im, pad=4):
    bb = im.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
    im = im.crop(bb)
    w, h = im.size
    c = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    c.paste(im, (pad, pad))
    return c


def square(im, size):
    w, h = im.size
    s = max(w, h)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    c.paste(im, ((s - w) // 2, (s - h) // 2))
    return c.resize((size, size), Image.LANCZOS)


sheet = Image.open(os.path.join(HERE, 'icons_raw.png'))
W, H = sheet.size
cw, ch = W / 4, H / 4
cells = {}
for i, name in enumerate(NAMES):
    x, y = i % 4, i // 4
    cell = sheet.crop((round(x * cw), round(y * ch), round((x + 1) * cw), round((y + 1) * ch)))
    cells[name] = key(cell, glass=name.startswith('glass'))
# оба стакана режем одной рамкой, чтобы были одного размера
boxes = [cells[n].getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox() for n in ('glass-full', 'glass-empty')]
gbox = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
for name in NAMES:
    im = cells[name]
    ic = square(im.crop(gbox) if name.startswith('glass') else trim(im), 160)
    ic.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)

for src, name, width in [('family_raw.png', 'family', 640), ('tip_raw.png', 'park', 480)]:
    im = trim(key(Image.open(os.path.join(HERE, src))), 0)
    h = round(im.size[1] * width / im.size[0])
    im.resize((width, h), Image.LANCZOS).save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=86, method=6)

print('ok', sorted(os.listdir(OUT)))
