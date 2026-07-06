from collections import deque
from pathlib import Path

from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "gifs" / "escape_from"
PICKUPS = [
    ASSETS / "medkit.gif",
    ASSETS / "quiet_mansion" / "light_source.gif",
    ASSETS / "dead_forest" / "light_source.gif",
]


def connected_background(frame):
    rgba = frame.convert("RGBA")
    pixels = rgba.load()
    candidates = set()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, _ = pixels[x, y]
            if min(red, green, blue) >= 220 and max(red, green, blue) - min(red, green, blue) <= 18:
                candidates.add((x, y))

    queue = deque(
        (x, y)
        for x, y in candidates
        if x in (0, rgba.width - 1) or y in (0, rgba.height - 1)
    )
    connected = set(queue)
    while queue:
        x, y = queue.popleft()
        for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if neighbor in candidates and neighbor not in connected:
                connected.add(neighbor)
                queue.append(neighbor)

    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    for x, y in connected:
        alpha_pixels[x, y] = 0
    rgba.putalpha(alpha)
    return rgba


def convert(path):
    with Image.open(path) as image:
        durations = []
        frames = []
        for frame in ImageSequence.Iterator(image):
            durations.append(frame.info.get("duration", image.info.get("duration", 100)))
            rgba = connected_background(frame)
            paletted = rgba.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
            transparent = rgba.getchannel("A").point(lambda value: 255 if value < 128 else 0)
            paletted.paste(255, mask=transparent)
            paletted.info["transparency"] = 255
            frames.append(paletted)
        frames[0].save(
            path,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=image.info.get("loop", 0),
            disposal=2,
            transparency=255,
            optimize=False,
        )
    print(path.relative_to(ROOT))


for pickup in PICKUPS:
    convert(pickup)
