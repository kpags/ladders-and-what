"""Make edge-connected GIF backdrops transparent without erasing enclosed artwork.

The script intentionally only removes pixels that match the dominant border colour
of an individual frame.  This protects black outlines, shadows, and bright details
that are not connected to the backdrop.
"""
from collections import Counter, deque
from pathlib import Path
import sys
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]


def close(a, b, tolerance=34):
    return max(abs(a[i] - b[i]) for i in range(3)) <= tolerance


def transparent(frame):
    rgba = frame.convert("RGBA")
    px = rgba.load()
    border = []
    for x in range(rgba.width):
        border.extend((px[x, 0][:3], px[x, rgba.height - 1][:3]))
    for y in range(1, rgba.height - 1):
        border.extend((px[0, y][:3], px[rgba.width - 1, y][:3]))
    background, count = Counter(border).most_common(1)[0]
    # A non-dominant border is normally real artwork, not a flat backdrop.
    if count < max(8, len(border) // 8):
        return rgba
    candidates = {(x, y) for y in range(rgba.height) for x in range(rgba.width)
                  if px[x, y][3] and close(px[x, y][:3], background)}
    queue = deque(point for point in candidates if point[0] in (0, rgba.width - 1) or point[1] in (0, rgba.height - 1))
    connected = set(queue)
    while queue:
        x, y = queue.popleft()
        for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if point in candidates and point not in connected:
                connected.add(point)
                queue.append(point)
    alpha = rgba.getchannel("A")
    for x, y in connected:
        alpha.putpixel((x, y), 0)
    rgba.putalpha(alpha)
    return rgba


def convert(path):
    with Image.open(path) as image:
        frames, durations = [], []
        for source in ImageSequence.Iterator(image):
            rgba = transparent(source)
            palette = rgba.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
            mask = rgba.getchannel("A").point(lambda value: 255 if value < 128 else 0)
            palette.paste(255, mask=mask)
            palette.info["transparency"] = 255
            frames.append(palette)
            durations.append(source.info.get("duration", image.info.get("duration", 100)))
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations,
                      loop=image.info.get("loop", 0), disposal=2, transparency=255, optimize=False)
    # Pillow may retain a legacy GCE without the transparency bit on a disposal
    # frame. All frames share palette index 255 as their transparent entry.
    data = bytearray(path.read_bytes())
    for index in range(len(data) - 7):
        if data[index:index + 3] == b"\x21\xf9\x04":
            data[index + 3] |= 1
    path.write_bytes(data)


targets = [ROOT / path for path in sys.argv[1:]] if len(sys.argv) > 1 else ROOT.joinpath("assets", "gifs").rglob("*.gif")
for gif in targets:
    with Image.open(gif) as probe:
        # Existing alpha-aware GIFs have already been normalized by the prior
        # asset pipeline; avoid needless lossy re-encoding on subsequent runs.
        if probe.info.get("transparency") is not None and len(sys.argv) <= 1:
            continue
    convert(gif)
    print(gif.relative_to(ROOT))
