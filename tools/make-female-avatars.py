# -*- coding: utf-8 -*-
"""生成 4 张女头像（256×256 webp），与现有写实头像共用深色摄影棚背景。

风格：无面部细节的扁平人像（faceless portrait），金耳环呼应牌桌金色。
用法: python tools/make-female-avatars.py
"""
from pathlib import Path

import math

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "avatars"

SIZE = 256
CX = 128
SKIN = (233, 199, 170)
SKIN_SHADE = (209, 171, 141)
BLUSH = (224, 158, 136)

# key, 发型, 发色, 发色高光, 衣色, 耳饰色
AVATARS = [
    ("ning", "bob",  (26, 24, 30),   (66, 62, 72),   (40, 66, 56),  (212, 175, 55)),
    ("luo",  "long", (58, 38, 26),   (128, 92, 60),  (92, 34, 44),  (212, 175, 55)),
    ("tang", "bun",  (88, 54, 30),   (168, 118, 70), (26, 26, 34),  (240, 214, 150)),
    ("xue",  "long", (142, 134, 124),(226, 220, 210), (40, 54, 82), (235, 228, 214)),
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def backdrop():
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    cx, cy = SIZE * 0.5, SIZE * 0.4
    maxd = 260
    for y in range(SIZE):
        for x in range(SIZE):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = min(1.0, d / maxd) ** 1.5
            px[x, y] = lerp((58, 54, 38), (15, 14, 11), t)
    return img


def draw_portrait(key, style, hair, hair_hi, cloth, metal):
    img = backdrop()
    d = ImageDraw.Draw(img, "RGBA")

    # 肩膀与衣服
    d.rounded_rectangle((CX - 92, 198, CX + 92, 300), radius=46, fill=cloth + (255,))
    d.rounded_rectangle((CX - 92, 198, CX + 92, 222), radius=30, fill=lerp(cloth, (255, 255, 255), 0.08) + (255,))

    # 后发垂缕（画在脸后面，只出现在脸两侧，不会盖到下巴中间）
    if style in ("long",):
        d.rounded_rectangle((CX - 58, 92, CX - 20, 216), radius=19, fill=hair + (255,))
        d.rounded_rectangle((CX + 20, 92, CX + 58, 216), radius=19, fill=hair + (255,))
        d.arc((CX - 58, 118, CX - 20, 168), 20, 160, fill=hair_hi + (90,), width=4)
        d.arc((CX + 20, 118, CX + 58, 168), 20, 160, fill=hair_hi + (90,), width=4)

    # 脖子与投影
    d.rectangle((CX - 17, 148, CX + 17, 210), fill=SKIN_SHADE + (255,))
    d.rectangle((CX - 17, 148, CX + 17, 164), fill=SKIN + (255,))

    # 发环（整块头发，包住头顶与两侧）
    d.ellipse((CX - 62, 30, CX + 62, 172), fill=hair + (255,))

    # 脸（压在发环上，露出下半部分）
    d.ellipse((CX - 47, 62, CX + 47, 176), fill=SKIN + (255,))
    d.ellipse((CX - 47, 100, CX + 47, 176), fill=SKIN + (255,))
    # 下颌两侧的柔和阴影
    d.ellipse((CX - 47, 128, CX + 47, 176), fill=lerp(SKIN, SKIN_SHADE, 0.28) + (60,))
    d.ellipse((CX - 45, 106, CX + 45, 174), fill=SKIN + (255,))
    # 腮红
    d.ellipse((CX - 36, 122, CX - 20, 134), fill=BLUSH + (66,))
    d.ellipse((CX + 20, 122, CX + 36, 134), fill=BLUSH + (66,))

    # 刘海：齐眉平刘海（上半椭圆，直发缘）
    d.chord((CX - 54, 26, CX + 54, 134), 180, 360, fill=hair + (255,))
    # 发环顶部高光
    d.arc((CX - 62, 30, CX + 62, 172), 200, 320, fill=hair_hi + (150,), width=5)

    if style == "bob":
        # 及颌短发：两侧发缕贴脸
        d.rounded_rectangle((CX - 58, 96, CX - 36, 178), radius=13, fill=hair + (255,))
        d.rounded_rectangle((CX + 36, 96, CX + 58, 178), radius=13, fill=hair + (255,))
    elif style == "bun":
        # 高丸子头
        d.ellipse((CX - 22, 12, CX + 22, 52), fill=lerp(hair, (0, 0, 0), 0.12) + (255,))
        d.arc((CX - 22, 12, CX + 22, 52), 200, 320, fill=hair_hi + (140,), width=4)
        d.rounded_rectangle((CX - 56, 96, CX - 38, 150), radius=11, fill=hair + (255,))
        d.rounded_rectangle((CX + 38, 96, CX + 56, 150), radius=11, fill=hair + (255,))

    # 金耳饰
    d.ellipse((CX - 49, 138, CX - 41, 146), fill=metal + (255,))
    d.ellipse((CX + 41, 138, CX + 49, 146), fill=metal + (255,))

    # 轻晕影收拢视觉
    vig = Image.new("L", (SIZE, SIZE), 0)
    dv = ImageDraw.Draw(vig)
    dv.rectangle((0, 0, SIZE, SIZE), fill=64)
    dv.ellipse((-36, -36, SIZE + 36, SIZE + 36), fill=0)
    vig = vig.filter(ImageFilter.GaussianBlur(30))
    dark = Image.new("RGB", (SIZE, SIZE), (8, 8, 8))
    img = Image.composite(dark, img, vig.point(lambda v: v))

    img.save(OUT / (key + ".webp"), "WEBP", quality=88)
    print("written", key + ".webp")


def main():
    for row in AVATARS:
        draw_portrait(*row)


if __name__ == "__main__":
    main()
