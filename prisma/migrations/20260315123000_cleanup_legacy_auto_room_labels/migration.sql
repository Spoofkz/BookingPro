-- Normalize legacy auto-generated room labels to a single operational name.
UPDATE Room
SET name = 'Operational Room'
WHERE lower(name) LIKE '%auto room%';
