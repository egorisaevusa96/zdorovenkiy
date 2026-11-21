"""Режет 4 варианта иконки из appicon_raw.png.
python design/assets/appicons.py            — сделать логотипы и превью
python design/assets/appicons.py sun        — поставить вариант иконкой приложения (sun / drop / apple / family)"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
NAMES = ['sun', 'drop', 'apple', 'family']

src = Image.open(os.path.join(HERE, 'appicon_raw.png')).convert('RGB')
W, H = src.size
tiles = {}
for i, name in enumerate(NAMES):
    x, y = i % 2, i // 2
    cell = src.crop((x * W // 2, y * H // 2, (x + 1) * W // 2, (y + 1) * H // 2))
    a = np.asarray(cell).astype(int)
    colored = (a.max(-1) - a.min(-1) > 40) | (a.max(-1) < 200)
    ys, xs = np.where(colored)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    t = cell.crop(box)
    s = min(t.size)
    t = t.crop(((t.size[0] - s) // 2, (t.size[1] - s) // 2, (t.size[0] - s) // 2 + s, (t.size[1] - s) // 2 + s))
    k = round(s * 0.015)  # срезать тонкую белую кромку
    tiles[name] = t.crop((k, k, s - k, s - k))


def full_square(t):
    """Закрашивает белые скруглённые углы цветом фона (iOS сам скруглит иконку)."""
    im = t.copy()
    s = im.size[0]
    k = int(s * 0.12)
    for cx, cy, sx, sy in [(0, 0, k, k), (s - 1, 0, s - 1 - k, k), (0, s - 1, k, s - 1 - k), (s - 1, s - 1, s - 1 - k, s - 1 - k)]:
        ImageDraw.floodfill(im, (cx, cy), im.getpixel((sx, sy)), thresh=60)
    return im


def rounded(t, size):
    im = t.resize((size, size), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.23), fill=255)
    im.putalpha(m.resize((size, size), Image.LANCZOS))
    return im


os.makedirs(os.path.join(ROOT, 'img', 'ui'), exist_ok=True)
for name, t in tiles.items():
    rounded(t, 128).save(os.path.join(ROOT, 'img', 'ui', f'logo-{name}.webp'), 'WEBP', quality=90)

if len(sys.argv) > 1:
    name = sys.argv[1]
    sq = full_square(tiles[name])
    icons = os.path.join(ROOT, 'icons')
    sq.resize((192, 192), Image.LANCZOS).save(os.path.join(icons, 'icon-192.png'))
    sq.resize((512, 512), Image.LANCZOS).save(os.path.join(icons, 'icon-512.png'))
    sq.resize((180, 180), Image.LANCZOS).save(os.path.join(icons, 'apple-touch-icon.png'))
    # для Android: рисунок поменьше в центре, вокруг цвет фона
    bg = sq.getpixel((int(sq.size[0] * 0.12), int(sq.size[1] * 0.5)))
    m = Image.new('RGB', (512, 512), bg)
    m.paste(sq.resize((410, 410), Image.LANCZOS), (51, 51))
    m.save(os.path.join(icons, 'icon-512-maskable.png'))
    rounded(tiles[name], 128).save(os.path.join(ROOT, 'img', 'ui', 'logo.webp'), 'WEBP', quality=90)
    print('иконка приложения:', name)
print('ok')
