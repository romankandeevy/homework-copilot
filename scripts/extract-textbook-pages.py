from __future__ import annotations

import argparse
from pathlib import Path

from pypdf import PdfReader


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(args.source)

    for page_number, page in enumerate(reader.pages, start=1):
        images = list(page.images)
        if not images:
            raise RuntimeError(f"PDF page {page_number} has no raster source")

        image = max(images, key=lambda candidate: len(candidate.data))
        suffix = Path(image.name).suffix.lower() or ".bin"
        target = args.output / f"page-{page_number:04d}{suffix}"
        if not target.exists() or target.stat().st_size != len(image.data):
            target.write_bytes(image.data)

        if page_number == 1 or page_number % 25 == 0 or page_number == len(reader.pages):
            print(f"{page_number}/{len(reader.pages)}\t{target}", flush=True)


if __name__ == "__main__":
    main()
