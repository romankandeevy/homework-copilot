with corrected(task, diagram_regions) as (
  values
    ('20', '[{"figure":23,"page":12,"x":552,"y":365,"width":196,"height":225,"sourceWidth":828,"sourceHeight":1100}]'::jsonb),
    ('23', '[{"figure":30,"page":14,"x":555,"y":835,"width":190,"height":95,"sourceWidth":828,"sourceHeight":1094}]'::jsonb),
    ('44', '[{"figure":37,"page":20,"x":545,"y":75,"width":215,"height":155,"sourceWidth":828,"sourceHeight":1099}]'::jsonb),
    ('50', '[{"figure":43,"page":23,"x":515,"y":135,"width":250,"height":200,"sourceWidth":828,"sourceHeight":1096}]'::jsonb),
    ('55', '[{"figure":44,"page":23,"x":515,"y":345,"width":225,"height":200,"sourceWidth":828,"sourceHeight":1096}]'::jsonb),
    ('56', '[{"figure":45,"page":23,"x":515,"y":545,"width":225,"height":210,"sourceWidth":828,"sourceHeight":1096}]'::jsonb),
    ('117', '[{"figure":73,"page":39,"x":590,"y":70,"width":195,"height":490,"sourceWidth":828,"sourceHeight":1100}]'::jsonb),
    ('122', '[{"figure":73,"page":39,"x":590,"y":70,"width":195,"height":490,"sourceWidth":828,"sourceHeight":1100}]'::jsonb),
    ('390', '[{"figure":181,"page":113,"x":500,"y":80,"width":290,"height":560,"sourceWidth":828,"sourceHeight":1102}]'::jsonb),
    ('663', '[{"figure":225,"page":171,"x":590,"y":280,"width":185,"height":165,"sourceWidth":828,"sourceHeight":1100}]'::jsonb),
    ('901', '[{"figure":276,"page":222,"x":70,"y":805,"width":375,"height":185,"sourceWidth":828,"sourceHeight":1099}]'::jsonb),
    ('1036', '[{"figure":316,"page":259,"x":145,"y":150,"width":520,"height":335,"sourceWidth":828,"sourceHeight":1099}]'::jsonb),
    ('1037', '[{"figure":317,"page":259,"x":145,"y":590,"width":520,"height":405,"sourceWidth":828,"sourceHeight":1099}]'::jsonb),
    ('1346', '[{"figure":415,"page":356,"x":470,"y":592,"width":300,"height":188,"sourceWidth":828,"sourceHeight":1094}]'::jsonb),
    ('1350', '[{"figure":417,"page":356,"x":115,"y":950,"width":650,"height":45,"sourceWidth":828,"sourceHeight":1094}]'::jsonb)
)
update public.verified_homework_tasks as task
set diagram_regions = corrected.diagram_regions,
    has_diagram = true
from corrected
where task.textbook_id = 'geometry'
  and task.textbook_edition = '14-е издание, Просвещение, 2023'
  and task.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task.task = corrected.task;
