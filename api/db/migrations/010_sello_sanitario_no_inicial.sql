-- Corrección forward-only: el baseline mantiene sus 29 litologías iniciales.
-- Sello sanitario sigue en el catálogo; sólo se corrige esta clasificación.
-- El runner existente aporta la transacción y registra el checksum en el ledger.
UPDATE catalogo_litologia
SET es_inicial = FALSE
WHERE codigo = 'sello_sanitario'
  AND es_inicial = TRUE;
