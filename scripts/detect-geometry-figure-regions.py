from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image


SOURCE_DIRECTORY = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/textbook-pages/geometry")
CAPTION_FILE = Path(sys.argv[2] if len(sys.argv) > 2 else "tmp/pdfs/geometry-figure-captions.json")
OUTPUT_FILE = Path(sys.argv[3] if len(sys.argv) > 3 else "tmp/pdfs/geometry-figure-regions.json")
CAPTION_PATTERN = re.compile(r"^(?:рис|puc|pic|рие)\.?\s*(\d{1,3})(?:\D|$)", re.IGNORECASE)
MANUAL_REGIONS = {
    37: {"page": 20, "x": 545, "y": 75, "width": 215, "height": 155, "sourceWidth": 828, "sourceHeight": 1100},
    43: {"page": 23, "x": 510, "y": 140, "width": 250, "height": 200, "sourceWidth": 828, "sourceHeight": 1096},
    44: {"page": 23, "x": 510, "y": 340, "width": 225, "height": 200, "sourceWidth": 828, "sourceHeight": 1096},
    45: {"page": 23, "x": 510, "y": 560, "width": 225, "height": 190, "sourceWidth": 828, "sourceHeight": 1096},
    73: {"page": 39, "x": 566, "y": 68, "width": 216, "height": 492, "sourceWidth": 828, "sourceHeight": 1100},
    98: {"page": 51, "x": 585, "y": 750, "width": 195, "height": 235, "sourceWidth": 828, "sourceHeight": 1102},
    112: {"page": 58, "x": 555, "y": 300, "width": 225, "height": 225, "sourceWidth": 828, "sourceHeight": 1097},
    113: {"page": 58, "x": 555, "y": 535, "width": 225, "height": 175, "sourceWidth": 828, "sourceHeight": 1097},
    123: {"page": 67, "x": 86, "y": 62, "width": 224, "height": 212, "sourceWidth": 828, "sourceHeight": 1091},
    152: {"page": 90, "x": 555, "y": 265, "width": 225, "height": 240, "sourceWidth": 828, "sourceHeight": 1099},
    162: {"page": 100, "x": 555, "y": 360, "width": 235, "height": 275, "sourceWidth": 828, "sourceHeight": 1100},
    194: {"page": 128, "x": 485, "y": 865, "width": 295, "height": 135, "sourceWidth": 828, "sourceHeight": 1100},
    266: {"page": 206, "x": 64, "y": 215, "width": 708, "height": 155, "sourceWidth": 828, "sourceHeight": 1100},
    309: {"page": 252, "x": 560, "y": 295, "width": 180, "height": 690, "sourceWidth": 828, "sourceHeight": 1100},
    314: {"page": 257, "x": 450, "y": 70, "width": 320, "height": 310, "sourceWidth": 828, "sourceHeight": 1096},
    315: {"page": 257, "x": 582, "y": 365, "width": 198, "height": 202, "sourceWidth": 828, "sourceHeight": 1096},
    316: {"page": 259, "x": 145, "y": 150, "width": 520, "height": 350, "sourceWidth": 828, "sourceHeight": 1099},
    317: {"page": 259, "x": 145, "y": 570, "width": 520, "height": 425, "sourceWidth": 828, "sourceHeight": 1099},
    353: {"page": 309, "x": 608, "y": 382, "width": 184, "height": 196, "sourceWidth": 828, "sourceHeight": 1099},
    377: {"page": 330, "x": 530, "y": 735, "width": 235, "height": 255, "sourceWidth": 828, "sourceHeight": 1099},
    378: {"page": 331, "x": 585, "y": 385, "width": 205, "height": 250, "sourceWidth": 828, "sourceHeight": 1099},
    379: {"page": 331, "x": 585, "y": 805, "width": 210, "height": 190, "sourceWidth": 828, "sourceHeight": 1099},
    389: {"page": 339, "x": 140, "y": 720, "width": 640, "height": 275, "sourceWidth": 828, "sourceHeight": 1097},
    390: {"page": 340, "x": 510, "y": 55, "width": 245, "height": 430, "sourceWidth": 828, "sourceHeight": 1094},
    403: {"page": 347, "x": 535, "y": 55, "width": 255, "height": 445, "sourceWidth": 828, "sourceHeight": 1099},
    404: {"page": 347, "x": 445, "y": 760, "width": 345, "height": 235, "sourceWidth": 828, "sourceHeight": 1099},
    408: {"page": 350, "x": 554, "y": 296, "width": 228, "height": 294, "sourceWidth": 828, "sourceHeight": 1096},
    411: {"page": 353, "x": 90, "y": 75, "width": 680, "height": 245, "sourceWidth": 828, "sourceHeight": 1099},
    414: {"page": 356, "x": 470, "y": 55, "width": 300, "height": 535, "sourceWidth": 828, "sourceHeight": 1094},
    415: {"page": 356, "x": 470, "y": 580, "width": 300, "height": 210, "sourceWidth": 828, "sourceHeight": 1094},
    416: {"page": 356, "x": 470, "y": 775, "width": 300, "height": 180, "sourceWidth": 828, "sourceHeight": 1094},
    417: {"page": 356, "x": 115, "y": 955, "width": 650, "height": 50, "sourceWidth": 828, "sourceHeight": 1094},
    418: {"page": 358, "x": 470, "y": 55, "width": 300, "height": 205, "sourceWidth": 828, "sourceHeight": 1103},
    419: {"page": 358, "x": 470, "y": 265, "width": 300, "height": 220, "sourceWidth": 828, "sourceHeight": 1103},
    423: {"page": 363, "x": 435, "y": 345, "width": 300, "height": 190, "sourceWidth": 828, "sourceHeight": 1097},
    424: {"page": 364, "x": 540, "y": 60, "width": 220, "height": 400, "sourceWidth": 828, "sourceHeight": 1097},
    425: {"page": 364, "x": 545, "y": 465, "width": 210, "height": 180, "sourceWidth": 828, "sourceHeight": 1097},
}


def runs(indexes: np.ndarray, max_gap: int) -> list[tuple[int, int]]:
    if indexes.size == 0:
        return []
    groups: list[tuple[int, int]] = []
    start = int(indexes[0])
    previous = start
    for raw_index in indexes[1:]:
        index = int(raw_index)
        if index - previous > max_gap:
            groups.append((start, previous + 1))
            start = index
        previous = index
    groups.append((start, previous + 1))
    return groups


def caption_candidates() -> list[dict]:
    scan = json.loads(CAPTION_FILE.read_text(encoding="utf-8"))
    candidates: list[dict] = []
    for page in scan["pages"]:
        for caption in page["captions"]:
            match = CAPTION_PATTERN.search(caption["text"].strip())
            if not match:
                continue
            candidates.append({
                **caption,
                "figure": int(match.group(1)),
                "page": int(page["pageNumber"]),
            })
    return candidates


def choose_captions(candidates: list[dict]) -> list[dict]:
    grouped: dict[int, list[dict]] = defaultdict(list)
    for candidate in candidates:
        grouped[candidate["figure"]].append(candidate)

    selected = []
    for figure, options in grouped.items():
        selected.append(max(options, key=lambda item: (
            item["confidence"],
            -abs(len(item["text"].strip()) - len(f"Рис. {figure}")),
        )))
    return sorted(selected, key=lambda item: item["figure"])


def magenta_mask(image: Image.Image) -> np.ndarray:
    pixels = np.asarray(image.convert("RGB"), dtype=np.int16)
    red = pixels[:, :, 0]
    green = pixels[:, :, 1]
    blue = pixels[:, :, 2]
    return (red >= 120) & ((red - green) >= 24) & ((blue - green) >= 4)


def detect_region(mask: np.ndarray, caption: dict) -> dict:
    image_height, image_width = mask.shape
    caption_x = int(round(caption["x"]))
    caption_y = int(round(caption["y"]))
    caption_right = int(round(caption["right"]))
    caption_bottom = int(round(caption["bottom"]))

    search_top = max(35, caption_y - 330)
    search_bottom = max(search_top + 1, caption_y - 3)
    search = mask[search_top:search_bottom, 45:min(800, image_width)]
    active_rows = np.flatnonzero(search.sum(axis=1) >= 2)
    row_groups = runs(active_rows, max_gap=38)
    usable_groups = [group for group in row_groups if search_bottom - (search_top + group[1]) <= 72]

    if usable_groups:
        row_start, row_end = usable_groups[-1]
        diagram_top = search_top + row_start
        diagram_bottom = search_top + row_end
        row_mask = mask[diagram_top:diagram_bottom, 45:min(800, image_width)]
        active_columns = np.flatnonzero(row_mask.sum(axis=0) >= 1)
        column_groups = runs(active_columns, max_gap=42)
        if column_groups:
            def horizontal_distance(group: tuple[int, int]) -> int:
                left = 45 + group[0]
                right = 45 + group[1]
                if left <= caption_x <= right:
                    return 0
                return min(abs(caption_x - left), abs(caption_x - right))

            column_start, column_end = min(column_groups, key=horizontal_distance)
            diagram_left = 45 + column_start
            diagram_right = 45 + column_end
        else:
            diagram_left = caption_x - 35
            diagram_right = caption_right + 210
    else:
        diagram_top = caption_y - 220
        diagram_bottom = caption_y
        diagram_left = caption_x - 35
        diagram_right = caption_right + 210

    left = max(45, min(diagram_left, caption_x) - 18)
    top = max(35, diagram_top - 18)
    right = min(image_width - 35, max(diagram_right, caption_right) + 18)
    bottom = min(image_height - 35, max(diagram_bottom, caption_bottom) + 12)

    if caption_x > 500:
        left = max(left, caption_x - 78)

    if right - left < 150:
        right = min(image_width - 35, left + 240)
    if bottom - top < 90:
        top = max(35, bottom - 150)

    return {
        "page": caption["page"],
        "x": int(left),
        "y": int(top),
        "width": int(right - left),
        "height": int(bottom - top),
        "sourceWidth": int(image_width),
        "sourceHeight": int(image_height),
    }


def main() -> None:
    selected = choose_captions(caption_candidates())
    by_page: dict[int, list[dict]] = defaultdict(list)
    for caption in selected:
        by_page[caption["page"]].append(caption)

    regions = []
    for index, page_number in enumerate(sorted(by_page), start=1):
        source = SOURCE_DIRECTORY / f"page-{page_number:04d}.jpg"
        with Image.open(source) as image:
            mask = magenta_mask(image)
        for caption in by_page[page_number]:
            regions.append({
                "figure": caption["figure"],
                "caption": caption["text"],
                "confidence": caption["confidence"],
                "region": MANUAL_REGIONS.get(caption["figure"], detect_region(mask, caption)),
            })
        if index == 1 or index % 40 == 0 or index == len(by_page):
            print(f"{index}/{len(by_page)}\tpage {page_number}", flush=True)

    regions.sort(key=lambda item: item["figure"])
    known_figures = {item["figure"] for item in regions}
    for figure, region in MANUAL_REGIONS.items():
        if figure not in known_figures:
            regions.append({
                "figure": figure,
                "caption": f"Рис. {figure}",
                "confidence": 100,
                "region": region,
            })
    regions.sort(key=lambda item: item["figure"])
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps({"figures": regions}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"figures={len(regions)}", flush=True)


if __name__ == "__main__":
    main()
