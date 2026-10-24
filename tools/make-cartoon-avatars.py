# -*- coding: utf-8 -*-
"""生成 10 张卡通头像 SVG（5 男 5 女，风格各异）。

输出: assets/avatars/c1.svg … c10.svg
用法: python tools/make-cartoon-avatars.py
"""

OUT = __import__("pathlib").Path(__file__).resolve().parent.parent / "assets" / "avatars"

SKIN = "#f2c9a4"
SKIN2 = "#e0b088"
LINE = "#2b2530"

HEAD = '<ellipse cx="128" cy="112" rx="50" ry="56" fill="{skin}"/>'
EARS = '<circle cx="78" cy="118" r="10" fill="{skin}"/><circle cx="178" cy="118" r="10" fill="{skin}"/>'
NECK = '<rect x="112" y="148" width="32" height="54" rx="12" fill="{skin2}"/>'
SHOULDERS = '<path d="M38 262 Q46 202 94 190 L162 190 Q210 202 218 262 Z" fill="{cloth}"/>'
BLUSH = ('<ellipse cx="100" cy="128" rx="11" ry="7" fill="{blush}" opacity="0.55"/>'
         '<ellipse cx="156" cy="128" rx="11" ry="7" fill="{blush}" opacity="0.55"/>')
EYES = ('<circle cx="108" cy="112" r="7" fill="{ink}"/>'
        '<circle cx="148" cy="112" r="7" fill="{ink}"/>'
        '<circle cx="110.5" cy="109.5" r="2.4" fill="#fff"/>'
        '<circle cx="150.5" cy="109.5" r="2.4" fill="#fff"/>')
BROWS = ('<rect x="98" y="94" width="22" height="5" rx="2.5" fill="{ink}"/>'
         '<rect x="136" y="94" width="22" height="5" rx="2.5" fill="{ink}"/>')
SMILE = '<path d="M116 142 Q128 152 140 142" stroke="{ink}" stroke-width="5" fill="none" stroke-linecap="round"/>'
GRIN = ('<path d="M112 140 Q128 158 144 140 Z" fill="{ink}"/>'
        '<path d="M118 145 Q128 138 138 145 Z" fill="#fff"/>')
BAND = '<rect x="0" y="196" width="256" height="60" fill="{band}" opacity="0.25"/>'


def svg(bg, bg2, cloth, body, extra=""):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
            f'<rect width="256" height="256" fill="{bg}"/>'
            f'<circle cx="128" cy="118" r="116" fill="{bg2}" opacity="0.5"/>'
            + body + extra +
            '</svg>')


def wrap(cloth, inner, band=None):
    b = SHOULDERS.format(cloth=cloth)
    return b + inner + (BAND.format(band=band) if band else "")


AVATARS = [
    # 1 圆脸暖男 · 芥末黄
    svg("#e8b64c", "#f3d27e", "#4a6b52", wrap(
        "#4a6b52",
        NECK.format(skin2=SKIN2) + EARS.format(skin=SKIN)
        + '<path d="M78 104 Q76 54 128 52 Q180 54 178 104 Q178 76 128 74 Q78 76 78 104 Z" fill="#3a3230"/>'
        + HEAD.format(skin=SKIN)
        + '<path d="M80 96 Q88 62 128 60 Q168 62 176 96 Q160 70 128 70 Q96 70 80 96 Z" fill="#3a3230"/>'
        + BROWS.format(ink=LINE) + EYES.format(ink=LINE) + BLUSH.format(blush="#e59a86")
        + SMILE.format(ink=LINE))),

    # 2 墨镜酷男 · 青碧
    svg("#2f8f83", "#57b3a4", "#22252c", wrap(
        "#22252c",
        NECK.format(skin2=SKIN2) + EARS.format(skin=SKIN)
        + '<path d="M76 108 Q74 50 128 48 Q182 50 180 108 L180 88 Q170 58 128 56 Q86 58 76 88 Z" fill="#171a20"/>'
        + HEAD.format(skin=SKIN)
        + '<path d="M78 92 Q128 44 178 92 Q172 66 128 62 Q84 66 78 92 Z" fill="#171a20"/>'
        + '<rect x="92" y="102" width="30" height="18" rx="8" fill="#101216"/>'
        + '<rect x="134" y="102" width="30" height="18" rx="8" fill="#101216"/>'
        + '<rect x="120" y="106" width="16" height="5" fill="#101216"/>'
        + '<path d="M118 146 Q128 138 138 146" stroke="{ink}" stroke-width="5" fill="none" stroke-linecap="round"/>'.replace("{ink}", LINE)
        + '<path d="M156 132 q14 -4 18 -18" stroke="#171a20" stroke-width="7" fill="none" stroke-linecap="round"/>')),

    # 3 胡子大叔 · 砖红
    svg("#b05a41", "#cd7a5c", "#3d4a63", wrap(
        "#3d4a63",
        NECK.format(skin2="#d6a37c") + EARS.format(skin="#eebf95")
        + '<path d="M78 100 Q78 56 128 54 Q178 56 178 100 L178 92 Q170 60 128 58 Q86 60 78 92 Z" fill="#5a5148"/>'
        + HEAD.format(skin="#eebf95")
        + '<path d="M80 92 Q92 66 128 64 Q164 66 176 92 Q156 72 128 72 Q100 72 80 92 Z" fill="#5a5148"/>'
        + '<path d="M96 138 Q128 156 160 138 L160 150 Q128 168 96 150 Z" fill="#5a5148"/>'
        + '<path d="M114 144 Q128 136 142 144" stroke="{ink}" stroke-width="4" fill="none" stroke-linecap="round"/>'.replace("{ink}", LINE)
        + '<circle cx="108" cy="114" r="6" fill="{ink}"/><circle cx="148" cy="114" r="6" fill="{ink}"/>'.replace("{ink}", LINE))),

    # 4 眼镜书生 · 黛蓝
    svg("#48639c", "#6f8cc4", "#e8e2d2", wrap(
        "#e8e2d2",
        NECK.format(skin2=SKIN2) + EARS.format(skin=SKIN)
        + '<path d="M78 106 Q78 52 128 50 Q178 52 178 106 L178 90 Q168 58 128 56 Q88 58 78 90 Z" fill="#2c2620"/>'
        + HEAD.format(skin=SKIN)
        + '<path d="M80 92 Q92 66 128 64 Q164 66 176 92 Q156 72 128 72 Q100 72 80 92 Z" fill="#2c2620"/>'
        + '<circle cx="108" cy="114" r="13" fill="none" stroke="#2c2620" stroke-width="4"/>'
        + '<circle cx="148" cy="114" r="13" fill="none" stroke="#2c2620" stroke-width="4"/>'
        + '<rect x="120" y="110" width="16" height="4" fill="#2c2620"/>'
        + '<circle cx="108" cy="115" r="4.5" fill="{ink}"/><circle cx="148" cy="115" r="4.5" fill="{ink}"/>'.replace("{ink}", LINE)
        + SMILE.format(ink=LINE))),

    # 5 潮男 · 耳机少年 · 紫罗兰
    svg("#7a5aa8", "#9a7cc6", "#2c2c34", wrap(
            "#2c2c34",
            NECK.format(skin2=SKIN2) + EARS.format(skin=SKIN)
            + '<path d="M74 112 Q70 48 128 46 Q186 48 182 112 L182 96 Q172 54 128 52 Q84 54 74 96 Z" fill="#20242c"/>'
            + HEAD.format(skin=SKIN)
            + '<path d="M76 96 Q90 60 128 58 Q166 60 180 96 Q158 68 128 68 Q98 68 76 96 Z" fill="#20242c"/>'
            + '<path d="M70 112 q-8 0 -8 16 q0 16 8 16 l6 0 0 -32 z" fill="#e8b64c"/>'
            + '<path d="M186 112 q8 0 8 16 q0 16 -8 16 l-6 0 0 -32 z" fill="#e8b64c"/>'
            + '<path d="M70 112 q0 -34 58 -34 q58 0 58 34" stroke="#e8b64c" stroke-width="9" fill="none"/>'
            + BROWS.format(ink=LINE) + EYES.format(ink=LINE)
            + '<path d="M118 142 h20 l-10 12 z" fill="{ink}"/>'.replace("{ink}", LINE))),

    # 6 波波头女生 · 玫瑰
    svg("#c96a8a", "#e192ac", "#8a4a62", wrap(
        "#8a4a62",
        '<rect x="112" y="148" width="32" height="54" rx="12" fill="{skin2}"/>'.replace("{skin2}", SKIN2)
        + '<path d="M74 128 Q66 52 128 50 Q190 52 182 128 L182 176 L150 176 L150 120 L106 120 L106 176 L74 176 Z" fill="#332629"/>'
        + HEAD.format(skin=SKIN)
        + '<path d="M80 100 Q86 62 128 60 Q170 62 176 100 Q164 74 128 72 Q92 74 80 100 Z" fill="#332629"/>'
        + '<path d="M84 92 Q128 58 172 92" stroke="#4d3a3e" stroke-width="6" fill="none" stroke-linecap="round"/>'
        + BROWS.format(ink=LINE) + EYES.format(ink=LINE) + BLUSH.format(blush="#ef9aa2")
        + '<path d="M120 142 Q128 150 136 142" stroke="{ink}" stroke-width="5" fill="none" stroke-linecap="round"/>'.replace("{ink}", LINE)
        + '<circle cx="78" cy="132" r="5" fill="#f2d16b"/><circle cx="178" cy="132" r="5" fill="#f2d16b"/>')),

    # 7 长发女生 · 松绿
    svg("#3f7d6d", "#65a189", "#c96a8a", wrap(
        "#c96a8a",
        '<path d="M70 120 Q62 48 128 46 Q194 48 186 120 L190 214 L156 214 L156 128 L100 128 L100 214 L66 214 Z" fill="#4a3234"/>'
        + NECK.format(skin2=SKIN2)
        + EARS.format(skin=SKIN)
        + HEAD.format(skin=SKIN)
        + '<path d="M80 98 Q88 62 128 60 Q168 62 176 98 Q164 72 128 70 Q92 72 80 98 Z" fill="#4a3234"/>'
        + '<path d="M84 90 Q128 54 172 90" stroke="#6a4a4c" stroke-width="6" fill="none" stroke-linecap="round"/>'
        + BROWS.format(ink=LINE) + EYES.format(ink=LINE) + BLUSH.format(blush="#ef9aa2")
        + '<circle cx="104" cy="141" r="4" fill="{ink}"/><circle cx="152" cy="141" r="4" fill="{ink}"/>'.replace("{ink}", LINE)
        + '<circle cx="78" cy="136" r="5" fill="#f2d16b"/><circle cx="178" cy="136" r="5" fill="#f2d16b"/>')),

    # 8 丸子头女生 · 杏色
    svg("#d9a05b", "#e8bd83", "#4a4a58", wrap(
        "#4a4a58",
        '<circle cx="128" cy="40" r="26" fill="#3a2c28"/>'
        + '<path d="M74 122 Q70 56 128 54 Q186 56 182 122 L182 150 Q170 158 158 150 L158 118 L98 118 L98 150 Q86 158 74 150 Z" fill="#3a2c28"/>'
        + NECK.format(skin2=SKIN2)
        + EARS.format(skin=SKIN)
        + HEAD.format(skin=SKIN)
        + '<path d="M80 98 Q90 64 128 62 Q166 64 176 98 Q158 74 128 72 Q98 74 80 98 Z" fill="#3a2c28"/>'
        + '<path d="M86 88 Q128 58 170 88" stroke="#57423c" stroke-width="5" fill="none" stroke-linecap="round"/>'
        + BROWS.format(ink=LINE) + EYES.format(ink=LINE) + BLUSH.format(blush="#ef9aa2")
        + '<path d="M118 144 Q128 152 138 144" stroke="{ink}" stroke-width="5" fill="none" stroke-linecap="round"/>'.replace("{ink}", LINE)
        + '<circle cx="79" cy="132" r="5" fill="#f2d16b"/><circle cx="177" cy="132" r="5" fill="#f2d16b"/>')),

    # 9 双马尾女生 · 天蓝
    svg("#5b9bd5", "#84b9e8", "#e0596b", wrap(
        "#e0596b",
        '<path d="M66 110 Q54 190 78 226 L104 226 Q92 170 96 118 Z" fill="#332629"/>'
        + '<path d="M190 110 Q202 190 178 226 L152 226 Q164 170 160 118 Z" fill="#332629"/>'
        + '<circle cx="88" cy="112" r="12" fill="#f2d16b"/><circle cx="168" cy="112" r="12" fill="#f2d16b"/>'
        + '<path d="M74 118 Q70 54 128 52 Q186 54 182 118 L182 128 Q168 66 128 64 Q88 66 74 128 Z" fill="#332629"/>'
        + NECK.format(skin2=SKIN2)
        + EARS.format(skin=SKIN)
        + HEAD.format(skin=SKIN)
        + '<path d="M80 98 Q90 62 128 60 Q166 62 176 98 Q158 74 128 72 Q98 74 80 98 Z" fill="#332629"/>'
        + BROWS.format(ink=LINE) + EYES.format(ink=LINE) + BLUSH.format(blush="#ef9aa2")
        + '<path d="M114 144 Q128 154 142 144" stroke="{ink}" stroke-width="5" fill="none" stroke-linecap="round"/>'.replace("{ink}", LINE))),

    # 10 短发酷姐 · 炭灰
    svg("#4a4a52", "#6a6a74", "#b0563f", wrap(
        "#b0563f",
        '<path d="M72 118 Q66 50 128 48 Q190 50 184 118 L184 96 Q172 56 128 54 Q84 56 72 96 Z" fill="#1e1c22"/>'
        + '<path d="M70 120 Q64 176 84 196 L104 196 Q90 160 96 122 Z" fill="#1e1c22"/>'
        + '<path d="M186 120 Q192 176 172 196 L152 196 Q166 160 160 122 Z" fill="#1e1c22"/>'
        + NECK.format(skin2=SKIN2)
        + EARS.format(skin=SKIN)
        + HEAD.format(skin=SKIN)
        + '<path d="M78 100 Q90 60 128 58 Q166 60 178 100 Q160 70 128 68 Q96 70 78 100 Z" fill="#1e1c22"/>'
        + '<path d="M88 88 L122 78" stroke="#3c3844" stroke-width="6" stroke-linecap="round"/>'
        + '<circle cx="108" cy="114" r="6.5" fill="{ink}"/><circle cx="148" cy="114" r="6.5" fill="{ink}"/>'.replace("{ink}", LINE)
        + '<path d="M116 144 L140 144" stroke="#b0563f" stroke-width="6" stroke-linecap="round"/>'
        + '<circle cx="79" cy="134" r="5" fill="#f2d16b"/><circle cx="177" cy="134" r="5" fill="#f2d16b"/>')),
]

OUT.mkdir(parents=True, exist_ok=True)
for i, body in enumerate(AVATARS, 1):
    (OUT / f"c{i}.svg").write_text(body, encoding="utf-8")
    print("written", f"c{i}.svg")
