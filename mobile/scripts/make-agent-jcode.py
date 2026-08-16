#!/usr/bin/env python3
"""
Regenerate the Jcode agent mark at the sizes the app actually draws it.

WHY THIS EXISTS. The mark is a dot-matrix torus: 105 separate circles. That is
an APP ICON design — upstream draws it at 180px on the apple-touch-icon and
1024px in the .icns — and it was carried into `mobile/assets/agents/` unchanged,
where the session list draws it at 22pt. Measured off the previous asset:

  - the torus filled only 70% of the canvas width, because it had been inset to
    sit inside the squircle plate that our SVG added (upstream's own favicon and
    touch icon are full-bleed and carry no plate at all), and
  - mean dot diameter came out at 1.34px at 22pt @1x.

105 sub-pixel dots in mid-grey (#7e7e7e) on near-black is not a logo at that
size, it is noise. Next to Claude's asterisk and Grok's G it read as a smudge —
the one mark in the row you could not name.

Nothing here redesigns the mark. The 105 dot positions are read straight out of
web/public/agent-jcode.svg and kept exactly as they are. Three things change,
all of them size-adaptation rather than art direction:

  FILL      the torus is scaled and re-centred to use the whole plate instead of
            70% of it (its bbox was also 10px off-centre horizontally), which is
            what upstream's own small-size asset does.
  DOT_GAIN  left at 1.0, and it should stay there. Measured off the source, the
            minimum centre-to-centre spacing is 30.69 and the mean dot diameter
            is 31.09 — the dots are authored to just touch, so 1.0 IS the
            drawn geometry. Anything above it (1.22 was tried) melts the ring
            into a solid white blob; anything below it shrinks the dots away
            from the design and reads noisier at 22pt, not cleaner.
  DOT_RGB   near-white rather than #7e7e7e, for contrast parity with the marks
            it sits beside. Still monochrome: do NOT reintroduce a blue tint,
            the upstream brand is grey (see the SVG's own header comment).
            0xED was blown out against the plate; 0xD8 keeps the dot edges.

No Pillow and no ImageMagick on this box, and `sharp` (scripts/generate-icons.ts)
is not installed here either — so, exactly as mobile/scripts/make-icons.py does
for the app icon, the circles are drawn analytically with supersampled coverage
and the PNG is written by hand.

    python3 mobile/scripts/make-agent-jcode.py

Source of truth for geometry: web/public/agent-jcode.svg.
"""

import math
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SVG = ROOT / "web/public/agent-jcode.svg"
ASSETS = ROOT / "mobile/assets/agents"

# The plate, unchanged: #05070B with the squircle's rx=96 in a 512 box.
PLATE_RGB = (0x05, 0x07, 0x0B)
CORNER_FRACTION = 96 / 512

# See the module docstring. These three are the whole change.
FILL = 0.92
DOT_GAIN = 1.00
DOT_RGB = (0xD8, 0xD8, 0xD8)

SIZES = {"agent-jcode.png": 32, "agent-jcode@2x.png": 64, "agent-jcode@3x.png": 96}
SUPERSAMPLE = 4


def read_circles():
    """-> [(cx, cy, r), ...] in the SVG's own 512x512 user space."""
    svg = SVG.read_text()
    match = re.search(r"translate\(([\d.]+)\s+([\d.]+)\)\s*scale\(([\d.]+)\)", svg)
    if not match:
        raise SystemExit(f"no transform found in {SVG}")
    tx, ty, scale = (float(v) for v in match.groups())
    circles = re.findall(r'<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\s*/>', svg)
    if not circles:
        raise SystemExit(f"no circles found in {SVG}")
    return [
        (tx + float(cx) * scale, ty + float(cy) * scale, float(r) * scale)
        for cx, cy, r in circles
    ]


def refit(circles, size):
    """Scale + centre the torus to fill `FILL` of a `size` box, and grow dots."""
    xs0 = min(cx - r for cx, _, r in circles)
    xs1 = max(cx + r for cx, _, r in circles)
    ys0 = min(cy - r for _, cy, r in circles)
    ys1 = max(cy + r for _, cy, r in circles)
    span = max(xs1 - xs0, ys1 - ys0)
    scale = (size * FILL) / span
    # Centre the mark's true bbox in the box, not the box it was authored in.
    ox = (size - (xs1 - xs0) * scale) / 2 - xs0 * scale
    oy = (size - (ys1 - ys0) * scale) / 2 - ys0 * scale
    return [(cx * scale + ox, cy * scale + oy, r * scale * DOT_GAIN) for cx, cy, r in circles]


def rounded_rect_coverage(px, py, size, radius):
    """1 inside the squircle, 0 outside — evaluated per supersample."""
    x = min(px, size - px)
    y = min(py, size - py)
    if x >= radius or y >= radius:
        return 1.0 if (x >= 0 and y >= 0) else 0.0
    dx, dy = radius - x, radius - y
    return 1.0 if dx * dx + dy * dy <= radius * radius else 0.0


def render(circles, size):
    """-> RGBA bytes, plate + dots, SUPERSAMPLE^2 coverage per pixel."""
    fitted = refit(circles, size)
    radius = size * CORNER_FRACTION
    step = 1.0 / SUPERSAMPLE
    offset = step / 2.0
    samples = SUPERSAMPLE * SUPERSAMPLE

    plate = [0.0] * (size * size)
    dots = [0.0] * (size * size)

    # Plate coverage: every pixel, but it is a cheap test.
    for py in range(size):
        for px in range(size):
            hits = 0.0
            for sy in range(SUPERSAMPLE):
                fy = py + offset + sy * step
                for sx in range(SUPERSAMPLE):
                    fx = px + offset + sx * step
                    hits += rounded_rect_coverage(fx, fy, size, radius)
            plate[py * size + px] = hits / samples

    # Dot coverage: only the pixels each circle can possibly touch.
    for cx, cy, r in fitted:
        r2 = r * r
        x0 = max(0, int(math.floor(cx - r - 1)))
        x1 = min(size - 1, int(math.ceil(cx + r + 1)))
        y0 = max(0, int(math.floor(cy - r - 1)))
        y1 = min(size - 1, int(math.ceil(cy + r + 1)))
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                hits = 0.0
                for sy in range(SUPERSAMPLE):
                    dy = py + offset + sy * step - cy
                    for sx in range(SUPERSAMPLE):
                        dx = px + offset + sx * step - cx
                        if dx * dx + dy * dy <= r2:
                            hits += 1.0
                if hits:
                    # max, not sum: overlapping dots are opaque, not denser.
                    index = py * size + px
                    coverage = hits / samples
                    if coverage > dots[index]:
                        dots[index] = coverage

    out = bytearray()
    for index in range(size * size):
        a_plate = plate[index]
        a_dot = dots[index] * a_plate  # dots are clipped by the plate
        alpha = a_plate
        if alpha <= 0.0:
            out += b"\x00\x00\x00\x00"
            continue
        row = []
        for channel in range(3):
            colour = PLATE_RGB[channel] * (1.0 - a_dot) + DOT_RGB[channel] * a_dot
            row.append(int(round(max(0.0, min(255.0, colour)))))
        out += bytes(row) + bytes([int(round(alpha * 255))])
    return bytes(out)


def write_png(path, size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter: none
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    circles = read_circles()
    print(f"{len(circles)} circles from {SVG.relative_to(ROOT)}")
    for name, size in SIZES.items():
        write_png(ASSETS / name, size, render(circles, size))
        print(f"  wrote {name} ({size}x{size})")


if __name__ == "__main__":
    main()
