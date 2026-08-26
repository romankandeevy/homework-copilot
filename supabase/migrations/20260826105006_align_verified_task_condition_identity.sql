update public.verified_homework_tasks
set
  condition_normalized = 'отметьте три точки а,в и с,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?',
  solution_payload = jsonb_set(
    solution_payload,
    '{conditionNormalized}',
    to_jsonb('отметьте три точки а,в и с,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?'::text)
  )
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '2';

update public.homework_solutions
set
  condition_normalized = 'отметьте три точки а,в и с,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?',
  solution = jsonb_set(
    solution,
    '{conditionNormalized}',
    to_jsonb('отметьте три точки а,в и с,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?'::text)
  )
where textbook_id = 'geometry'
  and textbook_edition = '14-е издание, Просвещение, 2023'
  and source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and task = '2'
  and source = 'number';

update public.homework_solution_catalog as catalog
set condition_normalized = solution.condition_normalized
from public.homework_solutions as solution
where catalog.solution_id = solution.id
  and solution.textbook_id = 'geometry'
  and solution.textbook_edition = '14-е издание, Просвещение, 2023'
  and solution.source_url = '/textbooks/geometry-7-9-atanasyan.pdf'
  and solution.task = '2'
  and solution.source = 'number';
