from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    page_files = sorted(args.source.glob("page-*.jpg"))

    for index, source in enumerate(page_files, start=1):
        match = re.search(r"page-(\d{4})", source.name)
        if not match:
            continue
        page_number = int(match.group(1))
        crop_left = 70 if page_number % 2 == 0 else 102
        with Image.open(source) as image:
            strip = image.crop((crop_left, 45, crop_left + 52, 980)).convert("L")
            strip = ImageOps.autocontrast(strip).resize((208, 3740), Image.Resampling.LANCZOS)
            strip.save(args.output / f"page-{page_number:04d}-x{crop_left}.png", optimize=True)

        if index == 1 or index % 50 == 0 or index == len(page_files):
            print(f"{index}/{len(page_files)}", flush=True)


if __name__ == "__main__":
    main()
