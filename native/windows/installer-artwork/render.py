"""Regenerate the committed NSIS bitmaps: python render.py (requires Pillow).

Artwork uses the same five-bar mark and neutral palette as app-icon.svg.
No build-time image generation or third-party images are needed on CI.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
SCALE = 4


def wave(draw, center, heights, color, width=4, gap=9):
    cx, cy = center
    for index, height in enumerate(heights):
        x = cx + (index - 2) * gap
        draw.rounded_rectangle(
            tuple(round(v * SCALE) for v in (x - width/2, cy - height/2, x + width/2, cy + height/2)),
            radius=round(width / 2 * SCALE), fill=color,
        )


image = Image.new('RGB', (164*SCALE, 314*SCALE), '#181818')
draw = ImageDraw.Draw(image)
wave(draw, (47, 61), (13, 36, 52, 29, 13), '#d5e4db', 5, 11)
font = ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf', 19*SCALE)
draw.text((23*SCALE, 106*SCALE), 'VoxBridge', font=font, fill='#ececee')
draw.line((24*SCALE, 150*SCALE, 140*SCALE, 150*SCALE), fill='#383838', width=SCALE)
# A quiet waveform carries the brand through the lower half of the wizard.
for index in range(19):
    height = [6, 10, 18, 32, 22, 12, 8, 16, 26, 44, 32, 20, 12, 8, 16, 24, 18, 10, 6][index]
    x = (24 + index * 6.4) * SCALE
    draw.rounded_rectangle((int(x), (255-height/2)*SCALE, int(x+2*SCALE), (255+height/2)*SCALE), radius=SCALE, fill='#414a45')
image.resize((164, 314), Image.Resampling.LANCZOS).save(OUT / 'sidebar.bmp')

image = Image.new('RGB', (150*SCALE, 57*SCALE), '#1e1e1e')
wave(ImageDraw.Draw(image), (120, 28), (8, 22, 32, 18, 8), '#d5e4db', 3, 7)
image.resize((150, 57), Image.Resampling.LANCZOS).save(OUT / 'header.bmp')
