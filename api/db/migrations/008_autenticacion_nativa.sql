CREATE TABLE sesion_nativa (
  id_sesion_nativa BIGSERIAL PRIMARY KEY,
  id_usuario BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  installation_id UUID NOT NULL,
  version_sesion_emitida INTEGER NOT NULL,
  platform TEXT NOT NULL,
  app_build_at_login INTEGER NOT NULL,
  app_version_at_login VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(40),
  CONSTRAINT sesion_nativa_token_hash_32 CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sesion_nativa_version_positiva CHECK (version_sesion_emitida > 0),
  CONSTRAINT sesion_nativa_platform CHECK (platform IN ('android', 'ios')),
  CONSTRAINT sesion_nativa_build_positivo CHECK (app_build_at_login > 0),
  CONSTRAINT sesion_nativa_expiry CHECK (expires_at > created_at),
  CONSTRAINT sesion_nativa_revocacion_coherente CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revocation_reason IN (
      'user_logout', 'installation_replaced', 'session_limit_eviction'
    ))
  )
);

CREATE INDEX sesion_nativa_usuario_activas_eviction_idx
  ON sesion_nativa (
    id_usuario,
    version_sesion_emitida,
    created_at,
    id_sesion_nativa
  )
  INCLUDE (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX sesion_nativa_usuario_installation_activa_idx
  ON sesion_nativa (id_usuario, installation_id)
  WHERE revoked_at IS NULL;

CREATE INDEX sesion_nativa_revoked_cleanup_idx
  ON sesion_nativa (revoked_at, id_sesion_nativa)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX sesion_nativa_expired_cleanup_idx
  ON sesion_nativa (expires_at, id_sesion_nativa)
  WHERE revoked_at IS NULL;

CREATE TABLE ticket_ws_nativo (
  id_ticket_ws_nativo BIGSERIAL PRIMARY KEY,
  id_sesion_nativa BIGINT NOT NULL
    REFERENCES sesion_nativa(id_sesion_nativa) ON DELETE CASCADE,
  ticket_hash BYTEA NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  app_build_emitido INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CONSTRAINT ticket_ws_nativo_hash_32 CHECK (octet_length(ticket_hash) = 32),
  CONSTRAINT ticket_ws_nativo_platform CHECK (platform IN ('android', 'ios')),
  CONSTRAINT ticket_ws_nativo_build_positivo CHECK (app_build_emitido > 0),
  CONSTRAINT ticket_ws_nativo_expiry CHECK (expires_at > created_at),
  CONSTRAINT ticket_ws_nativo_used_coherente CHECK (
    used_at IS NULL OR used_at >= created_at
  )
);

CREATE INDEX ticket_ws_nativo_sesion_idx
  ON ticket_ws_nativo (id_sesion_nativa);

CREATE INDEX ticket_ws_nativo_expiry_cleanup_idx
  ON ticket_ws_nativo (expires_at, id_ticket_ws_nativo);
