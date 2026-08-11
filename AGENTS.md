# Geometry notebook contract

`docs/references/geometry-notebook-layout-v1.png` is the approved visual source of truth for every 8th-grade geometry page. When prior code, instructions, or generated task data conflict with it, the approved reference wins.

- Render geometry tasks through `GeometryNotebookLayoutV1`; task data may supply only semantic content, never page layout, JSX, HTML, CSS, or absolute page coordinates.
- Keep every geometry layout value in `src/notebook/layouts/geometryNotebookLayoutV1.ts`. Do not add component-local layout numbers.
- Keep the page in its fixed SVG coordinate system and scale the whole page on narrow screens. Do not reflow, independently resize, or reposition page zones.
- Do not change the paper, grid, red margin, ink colour, writing font, title/solution alignment, task-number position, divider joint, or diagram zone without an explicitly approved layout-version change.
- The approved fixture is task №123. Never update visual snapshot baselines without explicit manual design approval.
