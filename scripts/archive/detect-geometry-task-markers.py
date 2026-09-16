from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def row_runs(rows: np.ndarray, max_gap: int = 2) -> list[tuple[int, int]]:
    indexes = np.flatnonzero(rows)
    if indexes.size == 0:
        return []
    runs: list[tuple[int, int]] = []
    start = int(indexes[0])
    previous = start
    for raw_index in indexes[1:]:
        index = int(raw_index)
        if index - previous > max_gap + 1:
            runs.append((start, previous + 1))
            start = index
        previous = index
    runs.append((start, previous + 1))
    return runs


def main() -> None:
    args = parse_args()
    pages = []
    page_files = sorted(args.source.glob("page-*.jpg"))

    for index, source in enumerate(page_files, start=1):
        match = re.search(r"page-(\d{4})", source.name)
        if not match:
            continue
        page_number = int(match.group(1))
        left, right = (70, 116) if page_number % 2 == 0 else (102, 146)
        with Image.open(source) as image:
            grayscale = np.asarray(image.convert("L"), dtype=np.uint8)
        top, bottom = 60, min(980, grayscale.shape[0])
        mask = grayscale[top:bottom, left:right] < 145
        rows = mask.sum(axis=1) >= 2
        candidates = []
        for start, end in row_runs(rows):
            height = end - start
            if height < 8 or height > 22:
                continue
            region = mask[start:end]
            columns = np.flatnonzero(region.any(axis=0))
            if columns.size == 0:
                continue
            x0 = int(columns[0]) + left
            x1 = int(columns[-1]) + left + 1
            candidates.append({
                "x": x0,
                "y": start + top,
                "width": x1 - x0,
                "height": height,
                "ink": int(region.sum()),
            })

        pages.append({"pageNumber": page_number, "candidates": candidates})
        if index == 1 or index % 50 == 0 or index == len(page_files):
            print(f"{index}/{len(page_files)}", flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"pages": pages}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
