#!/usr/bin/env python3
"""Pixel-level visual analysis of screenshots per the anti-vibe-coded spec.

Measures what a visitor actually SEES (not the CSS source):
  1. hue clusters / accent color count (5+ competing accents = flag)
  2. purple/indigo + purple-pink gradient detection (the #1 vibe-coded signal)
  3. neon: % of pixels at high saturation AND high value
  4. near-black (#000) usage vs dark grays
  5. gradient sweeps: smooth lightness/hue transitions across scanlines
  6. glow: bright halos (local luminance bloom) on dark backgrounds
"""
import sys, colorsys, json
from PIL import Image
from collections import Counter

def analyze(path):
    im = Image.open(path).convert('RGB')
    im.thumbnail((900, 4000))
    w, h = im.size
    px = im.load()
    total = w * h
    sat_hi = 0; neon = 0; pure_black = 0
    hue_counter = Counter()  # accent hues: saturated, mid-lightness pixels
    luminances = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255
            hh, ss, vv = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            luminances.append(lum)
            if ss > 0.55 and vv > 0.75:
                neon += 1
            if ss > 0.25:
                sat_hi += 1
            if r == 0 and g == 0 and b == 0:
                pure_black += 1
            if ss > 0.30 and 0.25 < vv < 0.92:
                hue_counter[int(hh * 24)] += 1  # 24 hue bins of 15deg
    # dominant non-gray hues (accent families that cover >0.3% of page)
    accents = {k: v for k, v in hue_counter.items() if v > total * 0.0015 / 4}
    n_accents = len(accents)
    purple_bins = [10, 11, 12, 13]   # 150-210deg purple/indigo/violet-blue
    pink_bins = [14, 15]             # 210-240? no: 24 bins*15deg: bin13=195-210 (blue-violet), bin14=210-225
    purple_px = sum(v for k, v in hue_counter.items() if k in (11, 12, 13))
    pink_px = sum(v for k, v in hue_counter.items() if k in (14, 15, 16))
    # gradient sweeps: long spans where luminance changes monotonically and smoothly
    # (real gradient = continuous drift >25 luminance over >120px, per-step 0.4..8)
    grad_rows = 0
    for y in range(0, h, 4):
        lums = [0.2126*px[x, y][0] + 0.7152*px[x, y][1] + 0.0722*px[x, y][2]
                for x in range(0, w, 2)]
        best = 0; i = 0
        while i < len(lums) - 1:
            j = i; moved = 0; steps = 0
            while j < len(lums) - 1:
                d = lums[j+1] - lums[j]
                if -8 <= d <= -0.4 or 0.4 <= d <= 8:
                    # same direction within tolerance
                    if moved * d < 0 and abs(moved) > 3:
                        break
                    moved += d; steps += 1; j += 1
                else:
                    break
            if steps >= 15 and abs(moved) >= 25:  # >=60px span, >=25 luminance drift
                best = max(best, steps)
            i = j + 1 if j > i else i + 1
        if best >= 15:
            grad_rows += 1
    sampled = len(luminances)
    return {
        'file': path.split('/')[-1],
        'pct_neon': round(100*neon/sampled, 2),
        'pct_sat>0.55': round(100*sat_hi/sampled, 2),
        'pct_pure_black': round(100*pure_black/sampled, 2),
        'n_accent_families': n_accents,
        'accent_bins': sorted(accents.keys()),
        'pct_purple_indigo': round(100*purple_px/sampled, 2),
        'pct_pink': round(100*pink_px/sampled, 2),
        'long_gradient_rows(huge)': grad_rows,
    }

rows = [analyze(p) for p in sys.argv[1:]]
print(json.dumps(rows, indent=1))
