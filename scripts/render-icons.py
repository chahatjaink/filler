#!/usr/bin/env python3
"""Draw the Filler toolbar icons. No third-party image libraries."""

import struct
import zlib
from pathlib import Path

INK = (28, 25, 23, 255)
PAPER = (243, 239, 230, 255)
AMBER = (224, 161, 46, 255)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, width, height, pixels):
    raw = b"".join(b"\x00" + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def blend(buf, width, x, y, color, coverage):
    if coverage <= 0 or not (0 <= x < width and 0 <= y < width):
        return
    index = (y * width + x) * 4
    src_a = color[3] / 255 * coverage
    dst_a = buf[index + 3] / 255
    out_a = src_a + dst_a * (1 - src_a)
    if out_a <= 0:
        return
    for channel in range(3):
        buf[index + channel] = int((color[channel] * src_a + buf[index + channel] * dst_a * (1 - src_a)) / out_a)
    buf[index + 3] = int(out_a * 255)


def inside_round(px, py, size, radius):
    cx = min(max(px, radius), size - radius)
    cy = min(max(py, radius), size - radius)
    dx = px - cx
    dy = py - cy
    return dx * dx + dy * dy <= radius * radius


def coverage(x, y, size, radius):
    hits = 0
    for sy in (0.25, 0.75):
        for sx in (0.25, 0.75):
            if inside_round(x + sx, y + sy, size, radius):
                hits += 1
    return hits / 4


def rect_coverage(x, y, left, top, right, bottom):
    hits = 0
    for sy in (0.25, 0.75):
        for sx in (0.25, 0.75):
            px = x + sx
            py = y + sy
            if left <= px <= right and top <= py <= bottom:
                hits += 1
    return hits / 4


def draw(size):
    buf = bytearray(size * size * 4)
    radius = max(2, size * 0.22)
    for y in range(size):
        for x in range(size):
            blend(buf, size, x, y, INK, coverage(x, y, size, radius))

    margin = size * 0.27
    right = size - margin
    thickness = max(1, size * 0.062)
    gaps = (0.30, 0.46, 0.62)
    widths = (1, 1, 0.58)
    for gap, width_ratio in zip(gaps, widths):
        top = size * gap
        line_right = margin + (right - margin) * width_ratio
        for y in range(size):
            for x in range(size):
                blend(buf, size, x, y, PAPER, rect_coverage(x, y, margin, top, line_right, top + thickness))

    dot = size * 0.11
    cx = size * 0.78
    cy = size * 0.78
    for y in range(size):
        for x in range(size):
            px = x + 0.5
            py = y + 0.5
            if (px - cx) ** 2 + (py - cy) ** 2 <= dot * dot:
                blend(buf, size, x, y, AMBER, 1)
    return bytes(buf)


def main():
    root = Path(__file__).resolve().parents[1] / "icons"
    root.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(root / f"icon{size}.png", size, size, draw(size))


if __name__ == "__main__":
    main()
