"""Contact sheet: a labelled grid of stills for a review round.

    work/venv/bin/python scripts/sheet.py out.jpg --cols 3 --width 900 "Label one=path/a.png" "Label two=path/b.jpg" ...
    work/venv/bin/python scripts/sheet.py out.jpg --list cells.txt   (one label=path per line)

Each cell keeps its image's aspect ratio inside a fixed-width column; the label sits in a bar under the image so it
never covers the picture. An optional --title prints above the grid. An optional --crop draws 2.39:1 frame lines.
"""
import argparse

from PIL import Image, ImageDraw, ImageFont

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("cells", nargs="*")
p.add_argument("--list", help="file with one label=path per line")
p.add_argument("--cols", type=int, default=3)
p.add_argument("--width", type=int, default=800)
p.add_argument("--title", default="")
p.add_argument("--crop", action="store_true", help="draw 2.39:1 extraction lines")
a = p.parse_args()

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
font = ImageFont.truetype(FONT, 22)
title_font = ImageFont.truetype(FONT, 30)
cells = []
entries = a.cells + ([l.strip() for l in open(a.list) if l.strip()] if a.list else [])
for c in entries:
    label, path = c.split("=", 1)
    im = Image.open(path).convert("RGB")
    im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
    if a.crop:
        d = ImageDraw.Draw(im)
        h = round(a.width / 2.39)
        top = (im.height - h) // 2
        for y in (top, top + h):
            d.line([(0, y), (a.width, y)], fill=(255, 60, 60), width=2)
    cells.append((label, im))

bar = 40
pad = 12
cell_h = max(im.height for _, im in cells) + bar
rows = (len(cells) + a.cols - 1) // a.cols
head = 56 if a.title else 0
sheet = Image.new("RGB", (a.cols * (a.width + pad) + pad, head + rows * (cell_h + pad) + pad), (24, 24, 24))
d = ImageDraw.Draw(sheet)
if a.title:
    d.text((pad, 14), a.title, font=title_font, fill=(240, 240, 240))
for i, (label, im) in enumerate(cells):
    x = pad + (i % a.cols) * (a.width + pad)
    y = head + pad + (i // a.cols) * (cell_h + pad)
    sheet.paste(im, (x, y))
    d.text((x + 4, y + im.height + 8), label, font=font, fill=(235, 235, 235))
sheet.save(a.out, quality=88)
print(a.out, sheet.size)
