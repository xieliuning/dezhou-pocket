# -*- coding: utf-8 -*-
"""生成微信分享缩略图 assets/share-thumb.png（300×300，皇家绒毡风格）。

用法: python tools/make-share-thumb.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "share-thumb.png"

SIZE = 300
GOLD = (201, 162, 78)
GOLD_DIM = (201, 162, 78, 110)
INK = (236, 231, 216)

FELT_HI = (18, 58, 43)   # 中心台呢
FELT_LO = (6, 15, 11)    # 边缘台呢


def find_font(candidates, size, index=0):
    for name in candidates:
        try:
            return ImageFont.truetype(str(name), size, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


def load_fonts():
    win = Path("C:/Windows/Fonts")
    cn_bold = [win / "msyhbd.ttc", win / "msyh.ttc", win / "simhei.ttf"]
    serif_bold = [win / "timesbd.ttf", win / "times.ttf", win / "georgiab.ttf", win / "arialbd.ttf"]
    return {
        "cn20": find_font(cn_bold, 20),
        "cn30": find_font(cn_bold, 30),
        "rank": find_font(serif_bold, 58),
        "suit16": find_font([win / "seguisym.ttf"], 16),
        "suit34": find_font([win / "seguisym.ttf"], 34),
    }


SUIT_GLYPH = {"spade": "\u2660", "heart": "\u2665", "diamond": "\u2666", "club": "\u2663"}


def felt_base():
    """径向渐变台呢 + 细噪点 + 四角压暗。"""
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    cx = cy = SIZE / 2
    maxd = math.hypot(cx, cy)
    for y in range(SIZE):
        for x in range(SIZE):
            t = min(1.0, math.hypot(x - cx, y - cy) / maxd)
            t = t ** 1.6
            px[x, y] = tuple(round(hi + (lo - hi) * t) for hi, lo in zip(FELT_HI, FELT_LO))
    noise = Image.effect_noise((SIZE, SIZE), 14).convert("L")
    img = Image.composite(img.point(lambda v: min(255, v + 3)), img, noise.point(lambda v: 255 if v > 128 else 0))
    return img.convert("RGBA")


def card_layer(rank, suit, color, angle):
    """一张牌：米白圆角矩形 + 角标 rank + 中央花色，整体旋转。"""
    w, h, r = 118, 164, 10
    layer = Image.new("RGBA", (w + 24, h + 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((12, 12, 12 + w, 12 + h), radius=r, fill=(248, 245, 236, 255),
                        outline=(214, 207, 190, 255), width=1)
    font = FONTS["rank"]
    d.text((22, 14), rank, font=font, fill=color)
    draw_suit(d, 34, 74, FONTS["suit16"], color, suit)
    draw_suit(d, 12 + w // 2, 12 + h // 2 + 12, FONTS["suit34"], color, suit)
    return layer.rotate(angle, resample=Image.BICUBIC, expand=True)


def draw_suit(d, cx, cy, font, color, suit):
    """花色优先用系统符号字体字形，缺字形时退回多边形。"""
    glyph = SUIT_GLYPH.get(suit)
    if font and glyph:
        try:
            bb = d.textbbox((0, 0), glyph, font=font)
            gw, gh = bb[2] - bb[0], bb[3] - bb[1]
            if gw > 4:
                d.text((cx - gw / 2 - bb[0], cy - gh / 2 - bb[1]), glyph, font=font, fill=color)
                return
        except OSError:
            pass
    s = 15 if font is None or font.size < 30 else 30
    if suit == "heart":
        r = s * 0.52
        d.ellipse((cx - s * 0.98, cy - s * 0.82, cx - s * 0.98 + 2 * r, cy - s * 0.82 + 2 * r), fill=color)
        d.ellipse((cx + s * 0.98 - 2 * r, cy - s * 0.82, cx + s * 0.98, cy - s * 0.82 + 2 * r), fill=color)
        d.polygon([(cx - s * 0.95, cy - s * 0.12), (cx + s * 0.95, cy - s * 0.12), (cx, cy + s * 0.9)], fill=color)
    elif suit == "spade":
        d.polygon([(cx, cy - s * 0.95), (cx - s * 0.78, cy + s * 0.32), (cx + s * 0.78, cy + s * 0.32)], fill=color)
        r = s * 0.5
        d.ellipse((cx - s * 0.46 - r, cy - s * 0.05 - r, cx - s * 0.46 + r, cy - s * 0.05 + r), fill=color)
        d.ellipse((cx + s * 0.46 - r, cy - s * 0.05 - r, cx + s * 0.46 + r, cy - s * 0.05 + r), fill=color)
        d.polygon([(cx - s * 0.2, cy + s * 0.28), (cx + s * 0.2, cy + s * 0.28),
                   (cx + s * 0.3, cy + s * 0.78), (cx - s * 0.3, cy + s * 0.78)], fill=color)
    elif suit == "diamond":
        d.polygon([(cx, cy - s * 0.95), (cx + s * 0.7, cy), (cx, cy + s * 0.95), (cx - s * 0.7, cy)], fill=color)
    else:  # club
        r = s * 0.42
        for dx, dy in ((-s * 0.42, s * 0.12), (s * 0.42, s * 0.12), (0, -s * 0.5)):
            d.ellipse((cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r), fill=color)
        d.polygon([(cx - s * 0.18, cy + s * 0.2), (cx + s * 0.18, cy + s * 0.2),
                   (cx + s * 0.28, cy + s * 0.78), (cx - s * 0.28, cy + s * 0.78)], fill=color)


def centered_text(d, y, text, font, fill):
    tw = d.textlength(text, font=font)
    d.text(((SIZE - tw) / 2, y), text, font=font, fill=fill)


def main():
    global FONTS
    FONTS = load_fonts()
    random.seed(7)

    img = felt_base()
    d = ImageDraw.Draw(img)

    # 金色双线边框
    d.rectangle((8, 8, SIZE - 9, SIZE - 9), outline=GOLD, width=2)
    d.rectangle((14, 14, SIZE - 15, SIZE - 15), outline=GOLD_DIM, width=1)

    # 标题与底部文字
    centered_text(d, 28, "夜 航 俱 乐 部", FONTS["cn20"], GOLD)
    centered_text(d, 252, "德州扑克", FONTS["cn30"], INK)

    # 卡片投影 + 两张牌（A♠ / K♥）
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((70, 92, 70 + 142, 92 + 188), radius=14, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))
    img.alpha_composite(shadow)

    card_a = card_layer("A", "spade", (26, 30, 34, 255), -8)
    card_k = card_layer("K", "heart", (192, 57, 43, 255), 7)
    img.alpha_composite(card_a, (112 - card_a.width // 2, 160 - card_a.height // 2))
    img.alpha_composite(card_k, (186 - card_k.width // 2, 164 - card_k.height // 2))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print("written", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
