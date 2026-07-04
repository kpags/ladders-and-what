from pathlib import Path
from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "gifs" / "escape_from" / "dead_forest"
TARGET = SOURCE / "transparent"


def background_mask(frame, mode):
    pixels = frame.load()
    mask = Image.new("1", frame.size)
    output = mask.load()
    for y in range(frame.height):
        for x in range(frame.width):
            r, g, b, _ = pixels[x, y]
            if mode == "light":
                high = max(r, g, b)
                low = min(r, g, b)
                output[x, y] = high >= 224 and high - low <= 22
            else:
                output[x, y] = max(r, g, b) <= 42
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


def convert(relative_path, mode):
    source = SOURCE / relative_path
    destination = TARGET / relative_path
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
