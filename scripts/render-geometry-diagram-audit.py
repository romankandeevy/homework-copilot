from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SOURCE_DIRECTORY = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/textbook-pages/geometry")
INDEX_FILE = Path(sys.argv[2] if len(sys.argv) > 2 else "tmp/pdfs/geometry-task-index.json")
OUTPUT_DIRECTORY = Path(sys.argv[3] if len(sys.argv) > 3 else "tmp/pdfs/geometry-diagram-audit")
TILE_WIDTH = 360
TILE_HEIGHT = 280
COLUMNS = 4
ROWS = 4


def main() -> None:
    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    entries = [
        (task["task"], region)
        for task in index["tasks"]
        for region in task["diagram_regions"]
    ]
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=18)

    for sheet_index in range(math.ceil(len(entries) / (COLUMNS * ROWS))):
        sheet = Image.new("RGB", (COLUMNS * TILE_WIDTH, ROWS * TILE_HEIGHT), "#e8e8e8")
        draw = ImageDraw.Draw(sheet)
        page_cache: dict[int, Image.Image] = {}
        start = sheet_index * COLUMNS * ROWS
        for tile_index, (task, region) in enumerate(entries[start:start + COLUMNS * ROWS]):
            page_number = int(region["page"])
            page = page_cache.get(page_number)
            if page is None:
                source = SOURCE_DIRECTORY / f"page-{page_number:04d}.jpg"
                page = Image.open(source).convert("RGB")
                page_cache[page_number] = page
            left = int(region["x"])
            top = int(region["y"])
            right = left + int(region["width"])
            bottom = top + int(region["height"])
            crop = page.crop((left, top, right, bottom))
            crop.thumbnail((TILE_WIDTH - 20, TILE_HEIGHT - 46), Image.Resampling.LANCZOS)

            column = tile_index % COLUMNS
            row = tile_index // COLUMNS
            tile_x = column * TILE_WIDTH
            tile_y = row * TILE_HEIGHT
            image_x = tile_x + (TILE_WIDTH - crop.width) // 2
            image_y = tile_y + 34 + (TILE_HEIGHT - 40 - crop.height) // 2
            sheet.paste(crop, (image_x, image_y))
            draw.text((tile_x + 10, tile_y + 8), f"Task {task} / Fig. {region['figure']} / p. {page_number}", fill="#111", font=font)
            draw.rectangle((tile_x, tile_y, tile_x + TILE_WIDTH - 1, tile_y + TILE_HEIGHT - 1), outline="#999")

        for page in page_cache.values():
            page.close()
        sheet.save(OUTPUT_DIRECTORY / f"sheet-{sheet_index + 1:02d}.jpg", quality=92)

    print(f"entries={len(entries)}\tsheets={math.ceil(len(entries) / (COLUMNS * ROWS))}", flush=True)


if __name__ == "__main__":
    main()
