#!/usr/bin/env python3
"""
Regenerate the app icons from the omg mark.

WHY THIS EXISTS. Every icon in assets/ shipped as the Expo template's
placeholder — the blue chevron with the construction guides — so TestFlight
build 1.0.1 (5) and every install before it wore a stock icon. The mark the
product actually uses lives in the vibes repo as a 512px PWA icon; iOS wants
1024, and upscaling a 512 disc softens the one edge the icon is made of.

So this measures the real icon (disc centre, disc radius, bite centre, bite
radius, and the background gradient) and re-renders it at any size, drawing
the two circles analytically with 4x supersampled coverage. The gradient is
resampled bilinearly, which loses nothing: it is smooth to begin with.

No Pillow on this box, and no ImageMagick — hence the hand-rolled PNG reader
and writer. They handle exactly what is needed: 8-bit RGB/RGBA, non-interlaced.

    python3 scripts/make-icons.py

Source of truth: apps/web/public/icons/pwa-512x512.png in BennyKok/vibes, whose
geometry matches favicon.svg (`circle cx=50 cy=50 r=44`, bite `cx=71 cy=29
r=14` in a 100x100 viewBox), padded for an app icon's margins.
"""

import struct
import zlib
from pathlib import Path

SOURCE = Path(
    "/home/dev/lfg-worktrees/lfg-4bb119/apps/web/public/icons/pwa-512x512.png"
)
ASSETS = Path(__file__).resolve().parent.parent / "assets"


def read_png(path):
    """-> (width, height, [(r,g,b,a), ...]) for 8-bit RGB/RGBA, no interlace."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos, idat, meta = 8, b"", None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            w, h, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and interlace == 0 and color in (2, 6), (depth, color)
            meta = (w, h, 3 if color == 2 else 4)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length

    w, h, channels = meta
    raw = zlib.decompress(idat)
    stride = w * channels
    out, prev = [], bytearray(stride)
    pos = 0
    for _ in range(h):
        filt = raw[pos]
        line = bytearray(raw[pos + 1 : pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if filt == 1:
                line[i] = (line[i] + a) & 0xFF
            elif filt == 2:
                line[i] = (line[i] + b) & 0xFF
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        for x in range(w):
            px = line[x * channels : x * channels + channels]
            out.append((px[0], px[1], px[2], px[3] if channels == 4 else 255))
        prev = line
    return w, h, out


def write_png(path, width, height, pixels, alpha):
    """pixels: flat [(r,g,b,a)]. `alpha` False writes RGB, which iOS requires
    for an app icon — an alpha channel there is a submission rejection."""
    channels = 4 if alpha else 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none. These are small files; simplicity wins.
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            raw += bytes((r, g, b, a)[:channels])

    def chunk(kind, body):
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6 if alpha else 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def measure(w, h, px):
    """Find the cream disc and its bite in the reference icon."""

    def luma(p):
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]

    cream = [(x, y) for y in range(h) for x in range(w) if luma(px[y * w + x]) > 200]
    xs, ys = [p[0] for p in cream], [p[1] for p in cream]
    disc = ((min(xs) + max(xs) + 1) / 2, (min(ys) + max(ys) + 1) / 2)
    disc_r = (max(xs) - min(xs) + 1) / 2

    # The bite is the dark hole INSIDE that bounding box.
    dark = [
        (x, y)
        for (x, y) in [
            (x, y)
            for y in range(int(min(ys)), int(max(ys)) + 1)
            for x in range(int(min(xs)), int(max(xs)) + 1)
        ]
        if luma(px[y * w + x]) < 120
        and (x - disc[0]) ** 2 + (y - disc[1]) ** 2 < (disc_r - 2) ** 2
    ]
    bxs, bys = [p[0] for p in dark], [p[1] for p in dark]
    bite = ((min(bxs) + max(bxs) + 1) / 2, (min(bys) + max(bys) + 1) / 2)
    bite_r = (max(bxs) - min(bxs) + 1) / 2
    return disc, disc_r, bite, bite_r, cream[len(cream) // 2]


def render(size, disc, disc_r, bite, bite_r, cream_rgb, src, scale, *, mark_only,
           mark_rgb=None, inset=1.0):
    """One icon. `mark_only` drops the gradient for a transparent background,
    which is what an Android adaptive foreground and a splash need."""
    w, h, px = src
    samples = 4  # 4x4 per pixel: enough that a 1024px disc edge reads as clean.
    out = []
    cx, cy = size / 2, size / 2
    r_disc = disc_r * scale * inset
    # Keep the bite's offset from the disc centre proportional, so the mark is
    # the same mark at any size rather than drifting as it scales.
    off_x = (bite[0] - disc[0]) * scale * inset
    off_y = (bite[1] - disc[1]) * scale * inset
    r_bite = bite_r * scale * inset
    fill = mark_rgb or cream_rgb[:3]

    for y in range(size):
        for x in range(size):
            covered = 0
            for sy in range(samples):
                for sx in range(samples):
                    px_x = x + (sx + 0.5) / samples
                    px_y = y + (sy + 0.5) / samples
                    in_disc = (px_x - cx) ** 2 + (px_y - cy) ** 2 <= r_disc**2
                    in_bite = (px_x - (cx + off_x)) ** 2 + (
                        px_y - (cy + off_y)
                    ) ** 2 <= r_bite**2
                    if in_disc and not in_bite:
                        covered += 1
            alpha = covered / (samples * samples)

            if mark_only:
                out.append((fill[0], fill[1], fill[2], round(alpha * 255)))
                continue

            # Background: the reference gradient, sampled bilinearly.
            u, v = (x + 0.5) / size * w, (y + 0.5) / size * h
            x0, y0 = min(int(u), w - 1), min(int(v), h - 1)
            x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)
            fx, fy = u - x0, v - y0
            bg = tuple(
                round(
                    px[y0 * w + x0][i] * (1 - fx) * (1 - fy)
                    + px[y0 * w + x1][i] * fx * (1 - fy)
                    + px[y1 * w + x0][i] * (1 - fx) * fy
                    + px[y1 * w + x1][i] * fx * fy
                )
                for i in range(3)
            )
            # Sampling the reference INCLUDES its own disc, so anywhere near the
            # mark the "background" would be cream. Corners are pure gradient;
            # push the sample outward radially to stay in it.
            dx, dy = u - disc[0], v - disc[1]
            d = (dx * dx + dy * dy) ** 0.5
            if d < disc_r + 4:
                k = (disc_r + 6) / max(d, 1e-6)
                u2 = min(max(disc[0] + dx * k, 0), w - 1)
                v2 = min(max(disc[1] + dy * k, 0), h - 1)
                bg = px[int(v2) * w + int(u2)][:3]
            out.append(
                tuple(
                    round(fill[i] * alpha + bg[i] * (1 - alpha)) for i in range(3)
                )
                + (255,)
            )
    return out


def main():
    w, h, px = read_png(SOURCE)
    disc, disc_r, bite, bite_r, cream_at = measure(w, h, px)
    cream = px[cream_at[1] * w + cream_at[0]]
    print(
        f"measured: disc c={disc} r={disc_r}, bite c={bite} r={bite_r}, "
        f"cream={cream[:3]}"
    )
    src = (w, h, px)

    jobs = [
        # iOS + the store listing. Opaque: an app icon with alpha is rejected.
        ("icon.png", 1024, dict(mark_only=False), False),
        # Splash: the mark alone, so it sits on the configured background.
        ("splash-icon.png", 1024, dict(mark_only=True), True),
        # Android adaptive. The foreground is inset to the 66% safe zone the
        # launcher masks to, or the mark loses its edge on a round mask.
        (
            "android-icon-foreground.png",
            1024,
            dict(mark_only=True, inset=0.66),
            True,
        ),
        (
            "android-icon-monochrome.png",
            1024,
            dict(mark_only=True, inset=0.66, mark_rgb=(255, 255, 255)),
            True,
        ),
        ("favicon.png", 96, dict(mark_only=True), True),
    ]
    for name, size, kwargs, alpha in jobs:
        scale = size / w
        pixels = render(size, disc, disc_r, bite, bite_r, cream, src, scale, **kwargs)
        write_png(ASSETS / name, size, size, pixels, alpha)
        print(f"wrote assets/{name} ({size}x{size})")


if __name__ == "__main__":
    main()
