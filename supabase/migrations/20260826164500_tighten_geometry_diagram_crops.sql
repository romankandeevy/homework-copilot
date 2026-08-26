with corrected(task, diagram_regions) as (
  values
    ('44', '[{"figure":37,"page":20,"x":545,"y":75,"width":215,"height":155,"sourceWidth":828,"sourceHeight":1100}]'::jsonb),
    ('50', '[{"figure":43,"page":23,"x":510,"y":140,"width":250,"height":200,"sourceWidth":828,"sourceHeight":1096}]'::jsonb),
    ('55', '[{"figure":44,"page":23,"x":510,"y":340,"width":225,"height":200,"sourceWidth":828,"sourceHeight":1096}]'::jsonb),
    ('56', '[{"figure":45,"page":23,"x":510,"y":560,"width":225,"height":190,"sourceWidth":828,"sourceHeight":1096}]'::jsonb)
)
update public.verified_homework_tasks as task
set diagram_regions = corrected.diagram_regions,
    has_diagram = true
from corrected
where task.textbook_id = 'geometry'
  and task.textbook_edition = '14-е издание, Просвещение, 2023'
  and task.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task.task = corrected.task;
