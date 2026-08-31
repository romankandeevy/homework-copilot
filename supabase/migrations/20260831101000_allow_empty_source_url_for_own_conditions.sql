-- Задача из текста и фото не имеет адреса источника.
--
-- `homework_solutions_identity_fields_length` требовал `source_url` длиной
-- не меньше одного символа. Пока условие бралось из размеченного учебника,
-- адрес был всегда. Когда индекс учебников убрали и перестали подставлять
-- строку-заглушку «photo», в колонку начала приходить пустая строка —
-- и вставка отклонялась на каждой задаче по фото и по вписанному условию.
--
-- Требование адреса остаётся там, где источник действительно есть: у задачи
-- по номеру. Для своих условий адрес необязателен, а верхняя граница длины
-- сохраняется для всех источников.

alter table public.homework_solutions
  drop constraint if exists homework_solutions_identity_fields_length;

alter table public.homework_solutions
  add constraint homework_solutions_identity_fields_length check (
    char_length(textbook_edition) between 1 and 200
    and char_length(source_url) <= 500
    and (source <> 'number' or char_length(source_url) >= 1)
    and char_length(condition_normalized) between 1 and 5000
  );
