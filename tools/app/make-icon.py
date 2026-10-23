"""NeoV8 app icon: "V8" in red LED segments and panel buttons on the module's black, in the macOS icon grid.

python3 tools/app/make-icon.py  ->  tools/app/NeoV8.png (1024 px) and tools/app/NeoV8.icns (needs numpy, opencv;
iconutil and sips on macOS). The output is committed; rerun only to change the design.
"""
import os
import subprocess
import tempfile

import cv2
import numpy as np

S = 2  # supersampling
N = 1024 * S
HERE = os.path.dirname(os.path.abspath(__file__))


def P(x, y):
    return [int(round(x * S)), int(round(y * S))]


def rrect_mask(x, y, w, h, r):
    m = np.zeros((N, N), np.uint8)
    x0, y0, x1, y1, rr = x * S, y * S, (x + w) * S, (y + h) * S, r * S
    cv2.rectangle(m, (int(x0 + rr), int(y0)), (int(x1 - rr), int(y1)), 255, -1)
    cv2.rectangle(m, (int(x0), int(y0 + rr)), (int(x1), int(y1 - rr)), 255, -1)
    for cx, cy in ((x0 + rr, y0 + rr), (x1 - rr, y0 + rr), (x0 + rr, y1 - rr), (x1 - rr, y1 - rr)):
        cv2.circle(m, (int(cx), int(cy)), int(rr), 255, -1, cv2.LINE_AA)
    return m.astype(np.float32) / 255.0


def over(img, color, alpha):
    """Composite a flat colour (RGB 0..1) with per-pixel alpha onto img (H, W, 4 float)."""
    a = alpha[..., None]
    img[..., :3] = img[..., :3] * (1 - a) + np.array(color, np.float32) * a
    img[..., 3:] = img[..., 3:] * (1 - a) + a


def rgb(h):
    return [int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]


img = np.zeros((N, N, 4), np.float32)

# drop shadow and body (Big Sur grid: 824 px body, radius 185)
body = rrect_mask(100, 100, 824, 824, 185)
shadow = cv2.GaussianBlur(np.roll(body, 14 * S, axis=0), (0, 0), 18 * S)
over(img, [0, 0, 0], shadow * 0.45)
grad = np.linspace(0, 1, N, dtype=np.float32)[:, None]
top, bottom = np.array(rgb("#303033")), np.array(rgb("#0e0e10"))
fill = top * (1 - grad[..., None]) + bottom * grad[..., None]
a = body[..., None]
img[..., :3] = img[..., :3] * (1 - a) + fill * a
img[..., 3:] = img[..., 3:] * (1 - a) + a
# rim light on the top edge
rim = body - rrect_mask(102, 104, 820, 820, 183)
over(img, [1, 1, 1], np.clip(rim, 0, 1) * 0.18)

# the panel's thin section outline
outline = rrect_mask(178, 160, 668, 704, 54) - rrect_mask(184, 166, 656, 692, 48)
over(img, rgb("#b9b9b9"), np.clip(outline, 0, 1) * 0.75)

# LED window and "V8": the 8 as a 7-segment digit, the V from two diagonal segments in the same style
window = rrect_mask(232, 214, 560, 470, 26)
over(img, rgb("#1e0404"), window)
y0, W, H, t, g = 252, 182, 392, 46, 7
shear = 0.08
cy = y0 + H / 2


def seg(p1, p2, g1=None, g2=None):
    p1, p2 = np.array(p1, float), np.array(p2, float)
    d = (p2 - p1) / np.linalg.norm(p2 - p1)
    n = np.array([-d[1], d[0]])
    p1, p2 = p1 + d * (g if g1 is None else g1), p2 - d * (g if g2 is None else g2)
    pts = [p1, p1 + d * t / 2 + n * t / 2, p2 - d * t / 2 + n * t / 2, p2, p2 - d * t / 2 - n * t / 2, p1 + d * t / 2 - n * t / 2]
    return np.array([P(x - (y - cy) * shear, y) for x, y in pts], np.int32)


def eight(x0):
    a_, b_ = (x0, y0), (x0 + W, y0)
    c_, d_ = (x0, y0 + H / 2), (x0 + W, y0 + H / 2)
    e_, f_ = (x0, y0 + H), (x0 + W, y0 + H)
    return [seg(a_, b_), seg(b_, d_), seg(d_, f_), seg(e_, f_), seg(c_, e_), seg(a_, c_), seg(c_, d_)]


def vee(x0):
    # one outline: pointed tops like the segments, a flat narrow tip
    xl, xr, bx, by = x0 - 4, x0 + W + 4, x0 + W / 2, y0 + H
    pts = [
        (xl, y0 - t * 0.6), (xl + t * 0.6, y0), (bx, by - t * 1.45), (xr - t * 0.6, y0), (xr, y0 - t * 0.6),
        (xr + t * 0.6, y0), (bx + t * 0.36, by), (bx - t * 0.36, by), (xl - t * 0.6, y0),
    ]
    return [np.array([P(x - (y - cy) * shear, y) for x, y in pts], np.int32)]


lit = np.zeros((N, N), np.uint8)
for sg in vee(300) + eight(566):
    cv2.fillPoly(lit, [sg], 255, cv2.LINE_AA)
litf = lit.astype(np.float32) / 255.0
glow = cv2.GaussianBlur(litf, (0, 0), 26 * S) * window
over(img, rgb("#ff3020"), np.clip(glow * 0.9, 0, 1))
over(img, rgb("#ff2a22"), litf)
core = cv2.GaussianBlur(cv2.erode(litf, np.ones((9 * S, 9 * S), np.uint8)), (0, 0), 4 * S)
over(img, rgb("#ff9a80"), core * 0.55)

# a row of panel buttons with their LEDs
for i, (bx, col) in enumerate(((262, "#e7e1cf"), (452, "#e7e1cf"), (642, "#c82834"))):
    shade = rrect_mask(bx + 4, 734, 120, 76, 12)
    over(img, [0, 0, 0], cv2.GaussianBlur(shade, (0, 0), 6 * S) * 0.6)
    btn = rrect_mask(bx, 728, 120, 76, 12)
    over(img, rgb(col), btn)
    over(img, [1, 1, 1], rrect_mask(bx + 6, 732, 108, 18, 8) * 0.22)
    over(img, [0, 0, 0], (btn - rrect_mask(bx + 3, 731, 114, 70, 10)).clip(0, 1) * 0.35)
    led = np.zeros((N, N), np.uint8)
    cv2.circle(led, tuple(P(bx + 138, 728)), 9 * S, 255, -1, cv2.LINE_AA)
    on = i == 2
    over(img, rgb("#ff2424") if on else rgb("#4a1010"), led.astype(np.float32) / 255.0)
    if on:
        over(img, rgb("#ff3020"), cv2.GaussianBlur(led.astype(np.float32) / 255.0, (0, 0), 10 * S) * 0.8)

out = cv2.resize(img, (1024, 1024), interpolation=cv2.INTER_AREA)
bgra = np.dstack([out[..., 2], out[..., 1], out[..., 0], out[..., 3]])
png = os.path.join(HERE, "NeoV8.png")
cv2.imwrite(png, np.clip(bgra * 255 + 0.5, 0, 255).astype(np.uint8))

# .icns
with tempfile.TemporaryDirectory() as tmp:
    iconset = os.path.join(tmp, "NeoV8.iconset")
    os.mkdir(iconset)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = size * scale
            name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
            subprocess.run(["sips", "-z", str(px), str(px), png, "--out", os.path.join(iconset, name)], check=True, capture_output=True)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(HERE, "NeoV8.icns")], check=True)
print("wrote", png, "and NeoV8.icns")
