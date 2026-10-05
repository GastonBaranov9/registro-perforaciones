-- Tombstones: a closed operation can never create a well, even from a delayed
-- request. Closing and creating use the same actor/UUID transaction lock.
CREATE TABLE public.clave_offline_cerrada (
  actor BIGINT NOT NULL REFERENCES public.usuario(id_usuario),
  clave UUID NOT NULL,
  cerrado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor, clave)
);
COMMENT ON TABLE public.clave_offline_cerrada IS
  'Permanent cancellation receipts. One row per explicitly closed uncommitted operation; no photos or passwords. Never expire keys while clients may retry.';
