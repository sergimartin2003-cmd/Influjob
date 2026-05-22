-- Arregla los salarios "EUR/anio" → "€/año" en Supabase
-- Ejecutar en Supabase Dashboard → SQL Editor

-- 1. Actualiza "12345 - 67890 EUR/anio" → "12345 – 67890 €/año"
UPDATE public.jobs
SET salario = REPLACE(REPLACE(salario, ' - ', ' – '), 'EUR/anio', '€/año')
WHERE salario LIKE '%EUR/anio%';

-- 2. Comprueba cuántos se actualizaron
SELECT COUNT(*) AS actualizados FROM public.jobs WHERE salario LIKE '%€/año%';

-- 3. Verifica que no queda ninguno con el formato incorrecto
SELECT COUNT(*) AS pendientes FROM public.jobs WHERE salario LIKE '%EUR/anio%';
