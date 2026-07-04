from pathlib import Path
from collections import deque
from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "gifs" / "escape_from" / "dead_forest"
TARGET = SOURCE / "transparent"


def background_mask(frame, mode):
    pixels = frame.load()
    mask = Image.new("1", frame.size)
    output = mask.load()
    candidates = set()
    for y in range(frame.height):
        for x in range(frame.width):
            r, g, b, _ = pixels[x, y]
            if mode == "light":
                high = max(r, g, b)
                low = min(r, g, b)
                output[x, y] = high >= 224 and high - low <= 22
            else:
                if max(r, g, b) <= 42:
                    candidates.add((x, y))

    if mode == "dark_connected":
        queue = deque(
            (x, y)
            for x, y in candidates
            if x in (0, frame.width - 1) or y in (0, frame.height - 1)
        )
        connected = set(queue)
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in candidates and neighbor not in connected:
                    connected.add(neighbor)
                    queue.append(neighbor)
        for x, y in connected:
            output[x, y] = 1
    return mask


def transparent_frame(frame, mode):
    rgba = frame.convert("RGBA")
    mask = background_mask(rgba, mode)
    alpha = rgba.getchannel("A")
    alpha.paste(0, mask=mask)
    rgba.putalpha(alpha)

    paletted = rgba.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    transparent = rgba.getchannel("A").point(lambda value: 255 if value < 128 else 0)
    paletted.paste(255, mask=transparent)
    paletted.info["transparency"] = 255
    return paletted


def convert(relative_path, mode, destination=None):
    source = SOURCE / relative_path
    destination = destination or TARGET / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        durations = []
        frames = []
        for frame in ImageSequence.Iterator(image):
            durations.append(frame.info.get("duration", image.info.get("duration", 100)))
            frames.append(transparent_frame(frame, mode))
        frames[0].save(
            destination,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=image.info.get("loop", 0),
            disposal=2,
            transparency=255,
            optimize=False,
        )
    print(destination.relative_to(ROOT))


convert(Path("keys.gif"), "light")
convert(Path("entity_board_model.gif"), "dark_connected", SOURCE / "entity_board_model.gif")


def extract_last_frame(relative_path, destination):
    with Image.open(SOURCE / relative_path) as image:
        image.seek(image.n_frames - 1)
        image.convert("RGBA").save(SOURCE / destination)
    print((SOURCE / destination).relative_to(ROOT))


extract_last_frame(Path("exit.gif"), Path("exit_last_frame.png"))
