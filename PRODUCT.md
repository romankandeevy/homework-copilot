# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students who want to copy school homework, currently represented by an 8th-grade use case. They expect the shortest possible path from a task number to a finished solution that can be rewritten into a notebook.

## Product Purpose

Homework Copilot turns a textbook and task number into a complete notebook-ready solution, with an expected wait of about five minutes when the shared base has no ready answer. Geometry is the approved rendering reference, not the product boundary.

## Positioning

The product is a copying service, not a productivity tracker. Its primary promise is a ready answer formatted the way the student must submit it.

## Operating Context

On the primary path the student uses a saved textbook and enters only the task number. The product checks the shared solution base first. A ready match opens immediately; only a missing task starts a new solution. Processing stages are system-owned status information and are never user-selectable.

## Capabilities and Constraints

- The existing `GeometryNotebookLayoutV1` renderer, its semantic input model, fixed SVG coordinate system, pagination, and approved visual snapshots must remain functional and unchanged.
- Geometry task data may provide semantic content only. It may not control page layout or absolute coordinates.
- The product must not request, import, store, or process МЭШ cookies or session data.
- The account has a visible solution balance and a top-up action. Exact pricing and purchase policy are not settled.
- Every task belongs to an explicit textbook identity: subject, class, title, authors, edition, and where applicable part or ISBN. A number alone is never enough.
- Textbook selection is saved to the account and the most recently used textbook becomes the default Home context.
- `База решений` is the shared catalogue of every already-solved task. A matching entry is available immediately.
- `Мои решения` is the student's personal history of solutions they opened or requested.
- `Расписание` is a free editable weekly timetable. Students can enter lessons manually or run Russian/English OCR on a photo, review the extracted rows, and keep the confirmed result on their device.
- Product navigation, monetization, and textbook-catalogue coverage are not settled product policy.
- The current Home page is a visual-only prototype. Product logic comes later.

## Brand Commitments

The product name is Homework Copilot. The visual identity is intentionally being replaced from scratch; no prior interface styling is a brand commitment.

## Evidence on Hand

- Approved geometry reference: `docs/references/geometry-notebook-layout-v1.png`.
- Renderer contract: `docs/GEOMETRY_NOTEBOOK_LAYOUT_V1.md`.
- Local semantic fixtures and visual snapshots exist for the geometry renderer.
- Confirmed product data categories are textbook identities, task numbers, shared ready solutions, personal solution history, and solution balance.
- No customer claims, performance benchmarks, pricing, testimonials, or production content are available and none should be fabricated.

## Product Principles

- Put “Списать задачу” first on Home. Keep the saved textbook visible and require only the task number after that context is chosen.
- Check the shared solution base before starting any new work.
- Make the finished solution complete and easy to copy into a notebook.
- Preserve personal work for later review.
- Do not add streaks, productivity scoring, completion percentages, or educational gamification without a concrete product reason and a real data source.
- Treat subject-specific renderers as output formats inside a multi-subject product.
- Keep unapproved product policy visibly undecided.

## Accessibility & Inclusion

The web interface must remain keyboard accessible, responsive, legible at browser zoom, and usable with reduced motion.
