"""Render the host controller's menu to one opaque 320x180 RGBA frame."""
import argparse
import json
import sys
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--font', default='')
args = parser.parse_args()
data = sys.stdin.buffer.read(65537)
if len(data) > 65536:
    raise ValueError('Menu model too large')
model = json.loads(data)
image = Image.new('RGBA', (320, 180), (13, 17, 27, 255))
draw = ImageDraw.Draw(image)

def font(size):
    return ImageFont.truetype(args.font, size) if args.font else ImageFont.load_default(size=size)

heading, body, tiny = font(12), font(11), font(9)

def fit(value, face, width):
    value = str(value or '').replace('\n', ' ')[:600]
    if draw.textlength(value, font=face) <= width:
        return value
    while value and draw.textlength(value + '…', font=face) > width:
        value = value[:-1]
    return value + '…'

draw.rectangle((0, 0, 319, 34), fill=(25, 33, 48, 255))
draw.text((7, 3), fit(model.get('title'), heading, 306), font=heading, fill=(235, 241, 250, 255))
draw.text((7, 19), fit(model.get('subtitle'), tiny, 306), font=tiny, fill=(154, 180, 205, 255))

rows = model.get('rows', [])[:8]
selected = model.get('selected', 0)
for index, row in enumerate(rows):
    y = 36 + index * 14
    active = index == selected
    if active:
        draw.rounded_rectangle((4, y - 1, 315, y + 13), radius=3, fill=(25, 105, 109, 255))
    label = str(row.get('label', ''))
    detail = str(row.get('detail', ''))
    detail_width = min(100, int(draw.textlength(detail, font=tiny))) if detail else 0
    color = (147, 151, 161, 255) if row.get('disabled') else (244, 246, 250, 255)
    draw.text((9, y), fit(label, body, 301 - (detail_width + 8 if detail else 0)), font=body, fill=color)
    if detail:
        draw.text((310 - detail_width, y + 1), fit(detail, tiny, detail_width), font=tiny, fill=(181, 197, 211, 255))

if model.get('description') and len(rows) <= 2:
    words = str(model['description']).split()
    lines, current = [], ''
    for word in words:
        candidate = (current + ' ' + word).strip()
        if current and draw.textlength(candidate, font=tiny) > 300:
            lines.append(current)
            current = word
        else:
            current = candidate
        if len(lines) == 6:
            break
    if current and len(lines) < 6:
        lines.append(current)
    for index, line in enumerate(lines):
        draw.text((9, 75 + index * 11), fit(line, tiny, 300), font=tiny, fill=(162, 180, 201, 255))

message = model.get('message')
if message:
    draw.rectangle((0, 149, 319, 164), fill=(70, 48, 27, 255))
    draw.text((7, 151), fit(message, tiny, 306), font=tiny, fill=(255, 222, 167, 255))
draw.rectangle((0, 165, 319, 179), fill=(25, 33, 48, 255))
draw.text((5, 167), fit(model.get('footer'), tiny, 310), font=tiny, fill=(181, 197, 211, 255))
sys.stdout.buffer.write(image.tobytes())
