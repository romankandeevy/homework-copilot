from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


SOURCE_DIRECTORY = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/textbook-pages/geometry")
MARKER_FILE = Path(sys.argv[2] if len(sys.argv) > 2 else "tmp/pdfs/geometry-task-markers.json")
OUTPUT_DIRECTORY = Path(sys.argv[3] if len(sys.argv) > 3 else "tmp/textbook-pages/geometry-text-2x")
SCALE = 2


def main() -> None:
    marker_index = json.loads(MARKER_FILE.read_text(encoding="utf-8"))
    page_numbers = sorted({int(task["pageNumber"]) for task in marker_index["tasks"]})
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)

    for index, page_number in enumerate(page_numbers, start=1):
        source = SOURCE_DIRECTORY / f"page-{page_number:04d}.jpg"
        output = OUTPUT_DIRECTORY / f"page-{page_number:04d}.jpg"
        if not output.exists():
            with Image.open(source) as image:
                gray = ImageOps.grayscale(image)
                gray = ImageOps.autocontrast(gray, cutoff=(0.3, 0.3))
                gray = ImageEnhance.Sharpness(gray).enhance(1.35)
                resized = gray.resize((image.width * SCALE, image.height * SCALE), Image.Resampling.LANCZOS)
                resized.save(output, "JPEG", quality=94, optimize=True)

        if index == 1 or index % 20 == 0 or index == len(page_numbers):
            print(f"{index}/{len(page_numbers)}\tpage {page_number}", flush=True)


if __name__ == "__main__":
    main()
