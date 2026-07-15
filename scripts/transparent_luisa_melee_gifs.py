from collections import deque
from pathlib import Path

from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
MELEE_DIR = ROOT / "assets" / "gifs" / "clash_with" / "characters" / "luisa" / "melee"
DIRECTIONS = ("north", "south", "east", "west")
CANVAS_SIZE = (512, 512)
MODEL_BOUNDS = (12, 8, 500, 504)


def remove_connected_checkerboard(frame):
    """Remove only the light neutral checkerboard connected to a frame edge."""
    rgba = frame.convert("RGBA")
    pixels = rgba.load()
    candidates = set()

    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                candidates.add((x, y))
                continue
            high = max(red, green, blue)
            low = min(red, green, blue)
            if low >= 225 and high - low <= 18:
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


def paletted_frame(frame):
    paletted = frame.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    transparent = frame.getchannel("A").point(lambda value: 255 if value < 128 else 0)
    paletted.paste(255, mask=transparent)
    paletted.info["transparency"] = 255
    return paletted


def union_bbox(frames):
    boxes = [frame.getchannel("A").getbbox() for frame in frames]
    boxes = [box for box in boxes if box]
    if not boxes:
        return None
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def place_on_melee_canvas(frames):
    source_bbox = union_bbox(frames)
    if not source_bbox:
        raise ValueError("No visible Luisa artwork remained after background removal")

    source_width = source_bbox[2] - source_bbox[0]
    source_height = source_bbox[3] - source_bbox[1]
    target_width = MODEL_BOUNDS[2] - MODEL_BOUNDS[0]
    target_height = MODEL_BOUNDS[3] - MODEL_BOUNDS[1]
    scale = min(target_width / source_width, target_height / source_height)
    resized_size = (
        max(1, round(source_width * scale)),
        max(1, round(source_height * scale)),
    )
    left = round((MODEL_BOUNDS[0] + MODEL_BOUNDS[2] - resized_size[0]) / 2)
    top = MODEL_BOUNDS[3] - resized_size[1]

    output = []
    for frame in frames:
        cropped = frame.crop(source_bbox).resize(resized_size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
        canvas.alpha_composite(cropped, (left, top))
        output.append(canvas)
    return output


def process(path):
    with Image.open(path) as image:
        durations = []
        frames = []
        for frame in ImageSequence.Iterator(image):
            durations.append(frame.info.get("duration", image.info.get("duration", 100)))
            frames.append(remove_connected_checkerboard(frame))

    frames = [paletted_frame(frame) for frame in place_on_melee_canvas(frames)]

    temp_path = path.with_suffix(".transparent.tmp.gif")
    frames[0].save(
        temp_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        disposal=2,
        transparency=255,
        optimize=False,
    )
    temp_path.replace(path)
    print(path.relative_to(ROOT))


if __name__ == "__main__":
    for direction in DIRECTIONS:
        process(MELEE_DIR / f"{direction}.gif")
