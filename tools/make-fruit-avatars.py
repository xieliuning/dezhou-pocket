# -*- coding: utf-8 -*-
"""生成 10 种水果头像 SVG（剪影风：纯色底 + 白色水果 + 底色镂空细节）。

输出: assets/avatars/apple.svg 等 10 个文件
用法: python tools/make-fruit-avatars.py
"""

OUT = __import__("pathlib").Path(__file__).resolve().parent.parent / "assets" / "avatars"

W = "#ffffff"   # 水果主体


def svg(bg, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
            f'<rect width="256" height="256" fill="{bg}"/>' + body + "</svg>")


AVATARS = {
    # 1 苹果 · 绯红底
    "apple": svg("#c03a52", (
        '<rect x="121" y="46" width="14" height="40" rx="7" fill="' + W + '"/>'
        '<ellipse cx="156" cy="62" rx="26" ry="12" fill="' + W + '" transform="rotate(-24 156 62)"/>'
        '<circle cx="128" cy="148" r="76" fill="' + W + '"/>'
        '<circle cx="128" cy="70" r="20" fill="#c03a52"/>'
        '<ellipse cx="102" cy="140" rx="16" ry="24" fill="#c03a52" opacity="0.18"/>')),
    # 2 葡萄 · 深紫底
    "grape": svg("#4b2a6e", (
        '<rect x="122" y="34" width="12" height="34" rx="6" fill="' + W + '"/>'
        '<ellipse cx="152" cy="48" rx="24" ry="11" fill="' + W + '" transform="rotate(-20 152 48)"/>'
        + "".join(f'<circle cx="{cx}" cy="{cy}" r="23" fill="{W}"/>' for cx, cy in [
            (100, 104), (156, 104), (76, 140), (128, 140), (180, 140),
            (102, 176), (154, 176), (128, 210)]))),
    # 3 西瓜 · 瓜皮绿底
    "watermelon": svg("#2e7d54", (
        '<path d="M36 128 A92 92 0 0 0 220 128 Z" fill="' + W + '"/>'
        '<path d="M56 128 A72 72 0 0 0 200 128 Z" fill="#2e7d54"/>'
        '<path d="M76 128 A52 52 0 0 0 180 128 Z" fill="' + W + '"/>'
        + "".join(f'<ellipse cx="{cx}" cy="{cy}" rx="6" ry="9" fill="#2e7d54" transform="rotate({a} {cx} {cy})"/>'
                  for cx, cy, a in [(104, 148, 18), (128, 158, 0), (152, 148, -18)]))),
    # 4 草莓 · 墨绿底
    "strawberry": svg("#1f6e5c", (
        '<rect x="121" y="52" width="14" height="26" rx="7" fill="' + W + '"/>'
        '<path d="M92 78 L164 78 L146 104 L110 104 Z" fill="' + W + '"/>'
        '<path d="M128 96 Q196 118 168 186 Q148 226 128 230 Q108 226 88 186 Q60 118 128 96 Z" fill="' + W + '"/>'
        + "".join(f'<ellipse cx="{cx}" cy="{cy}" rx="5.5" ry="8" fill="#1f6e5c" transform="rotate({a} {cx} {cy})"/>'
                  for cx, cy, a in [(106, 138, 22), (150, 138, -22), (128, 164, 0), (110, 190, 18), (146, 190, -18)]))),
    # 5 柠檬 · 湖蓝底
    "lemon": svg("#2f6f9f", (
        '<ellipse cx="128" cy="138" rx="82" ry="56" fill="' + W + '"/>'
        '<circle cx="44" cy="138" r="14" fill="' + W + '"/>'
        '<circle cx="212" cy="138" r="14" fill="' + W + '"/>'
        '<path d="M84 122 Q128 104 172 122" stroke="#2f6f9f" stroke-width="8" fill="none" stroke-linecap="round"/>'
        '<path d="M84 156 Q128 172 172 156" stroke="#2f6f9f" stroke-width="8" fill="none" stroke-linecap="round"/>')),
    # 6 橙子 · 暖橙棕底
    "orange": svg("#9c5a2e", (
        '<rect x="121" y="52" width="14" height="30" rx="7" fill="' + W + '"/>'
        '<ellipse cx="156" cy="64" rx="26" ry="12" fill="' + W + '" transform="rotate(-22 156 64)"/>'
        '<circle cx="128" cy="150" r="76" fill="' + W + '"/>'
        '<circle cx="128" cy="72" r="18" fill="#9c5a2e"/>'
        '<circle cx="94" cy="118" r="7" fill="#9c5a2e" opacity="0.35"/>'
        '<circle cx="152" cy="140" r="7" fill="#9c5a2e" opacity="0.35"/>'
        '<circle cx="112" cy="176" r="7" fill="#9c5a2e" opacity="0.35"/>')),
    # 7 菠萝 · 椰棕底
    "pineapple": svg("#7a4e2d", (
        '<path d="M128 30 L112 78 L144 78 Z" fill="' + W + '"/>'
        '<path d="M96 40 L104 84 L134 74 Z" fill="' + W + '"/>'
        '<path d="M160 40 L150 84 L122 74 Z" fill="' + W + '"/>'
        '<ellipse cx="128" cy="158" rx="64" ry="80" fill="' + W + '"/>'
        '<path d="M84 118 L172 198 M172 118 L84 198 M128 84 L128 236" stroke="#7a4e2d" stroke-width="7"/>'
        '<ellipse cx="128" cy="158" rx="64" ry="80" fill="none" stroke="#7a4e2d" stroke-width="7"/>')),
    # 8 桃子 · 苔绿底
    "peach": svg("#6b8f5a", (
        '<rect x="121" y="54" width="14" height="30" rx="7" fill="' + W + '"/>'
        '<ellipse cx="158" cy="66" rx="26" ry="12" fill="' + W + '" transform="rotate(-22 158 66)"/>'
        '<circle cx="128" cy="150" r="76" fill="' + W + '"/>'
        '<path d="M128 78 Q118 120 128 214" stroke="#6b8f5a" stroke-width="8" fill="none" stroke-linecap="round"/>'
        '<ellipse cx="98" cy="142" rx="16" ry="24" fill="#6b8f5a" opacity="0.18"/>')),
    # 9 梨 · 橄榄底
    "pear": svg("#5e7a3a", (
        '<rect x="121" y="42" width="14" height="38" rx="7" fill="' + W + '"/>'
        '<ellipse cx="154" cy="56" rx="24" ry="11" fill="' + W + '" transform="rotate(-22 154 56)"/>'
        '<circle cx="128" cy="88" r="42" fill="' + W + '"/>'
        '<circle cx="128" cy="168" r="72" fill="' + W + '"/>'
        '<ellipse cx="100" cy="160" rx="15" ry="26" fill="#5e7a3a" opacity="0.18"/>')),
    # 10 樱桃 · 酒红底
    "cherry": svg("#7c2438", (
        '<path d="M92 158 Q98 96 130 66" stroke="' + W + '" stroke-width="11" fill="none" stroke-linecap="round"/>'
        '<path d="M164 158 Q164 100 130 66" stroke="' + W + '" stroke-width="11" fill="none" stroke-linecap="round"/>'
        '<ellipse cx="150" cy="58" rx="26" ry="12" fill="' + W + '" transform="rotate(-18 150 58)"/>'
        '<circle cx="92" cy="182" r="42" fill="' + W + '"/>'
        '<circle cx="166" cy="176" r="40" fill="' + W + '"/>')),
}

OUT.mkdir(parents=True, exist_ok=True)
for name, body in AVATARS.items():
    (OUT / (name + ".svg")).write_text(body, encoding="utf-8")
    print("written", name + ".svg")
