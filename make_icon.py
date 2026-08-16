# -*- coding: utf-8 -*-
"""Generate PWA icons for 灵感图库 (PoseBook) — 取景框主题（深色底 + 金色取景框）"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (16, 19, 26, 255)       # 深色背景
GOLD = (255, 209, 102, 255)  # 金色
WHITE = (240, 244, 250, 255)  # 白色
GREY = (120, 130, 148, 255)   # 灰色


def draw_viewfinder(d, size, rounded_bg=True):
    """取景框图形：四角 L 形 + 中央金色框 + 十字线"""
    if rounded_bg:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.19, fill=BG)
    m = size * 0.2305      # 距边
    L = size * 0.1875      # L 形臂长
    t = size * 0.0586      # 线宽
    # 四角 L 形
    d.rectangle([m, m, m + t, m + L], fill=WHITE)
    d.rectangle([m, m, m + L, m + t], fill=WHITE)
    d.rectangle([size - m - t, m, size - m, m + L], fill=WHITE)
    d.rectangle([size - m - L, m, size - m, m + t], fill=WHITE)
    d.rectangle([m, size - m - L, m + t, size - m], fill=WHITE)
    d.rectangle([m, size - m - t, m + L, size - m], fill=WHITE)
    d.rectangle([size - m - t, size - m - L, size - m, size - m], fill=WHITE)
    d.rectangle([size - m - L, size - m - t, size - m, size - m], fill=WHITE)
    # 中央金色取景框
    half = size * 0.1016
    d.rectangle([size / 2 - half, size / 2 - half, size / 2 + half, size / 2 + half],
                outline=GOLD, width=int(size * 0.0195))
    # 十字线
    w = max(1, int(size * 0.0098))
    d.line([size / 2 - size * 0.1875, size / 2, size / 2 + size * 0.1875, size / 2], fill=GREY, width=w)
    d.line([size / 2, size / 2 - size * 0.1875, size / 2, size / 2 + size * 0.1875], fill=GREY, width=w)


def main():
    size = 512
    # 普通图标：圆角深色背景
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_viewfinder(ImageDraw.Draw(img), size, rounded_bg=True)
    img.save(os.path.join(OUT, "icon-512.png"))
    img.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))
    # maskable 图标：满幅背景（系统安全区内裁剪）
    mask = Image.new("RGBA", (size, size), BG)
    draw_viewfinder(ImageDraw.Draw(mask), size, rounded_bg=False)
    mask.save(os.path.join(OUT, "icon-maskable-512.png"))
    print("icons generated:", os.listdir(OUT))


if __name__ == "__main__":
    main()
