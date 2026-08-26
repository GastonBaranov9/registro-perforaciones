# ETAPA RSP-09A-R5 — Revalidación web, build mobile y retención de tickets

Fecha: 2026-08-26
Rama: `feature/rsp-09-android-auth`
Base: `main`
HEAD inicial auditado: `a77400af99796ca8f20d3f50ded84daa42a3ca75`

## 1. Alcance y resultado

Se corrigieron exclusivamente tres P2 documentales:

1. el registry WebSocket web no conservaba la `version_sesion` de la credencial autenticada;
2. el minimum-version mobile dependía de metadata stale/ambigua del login;
3. la tabla futura de tickets no tenía retención ni cleanup obligatorios.

R5 no modifica runtime, migraciones, dependencias, builds ni decisiones base de cookie/Bearer, HMAC, logout, ticket single-use, parent validation, registry o fail-closed.

## 2. Revalidación del WebSocket web

La auditoría real confirmó:

- `/ws` ejecuta `fastify.authenticate` durante el upgrade;
- la cookie JWT validada contiene `sub` y `version_sesion`;
- el resolver compara esa versión con `usuario.version_sesion`;
- la ruta registra únicamente `id_usuario` e `isAdmin`;
- el heartbeat actual sólo mantiene ping/pong, sin revalidar DB.

RSP-09D conservará en la conexión `version_sesion_emitida` copiada desde el JWT validado, además de `connectionId`, `id_usuario`, mecanismo web, expiración relevante y autorización mínima. No se sustituye por una lectura del valor actual.

En heartbeat —máximo recomendado ~30 s, configurable— y antes de delivery si corresponde, exige usuario existente/activo/con acceso y versión actual igual a la emitida. Si el direct close se pierde, una conexión autenticada con versión 7 cierra al comparar contra versión actual 8. Error de revalidación es fail-closed. Cookie, JWT, CSRF y `PUBLIC_ORIGIN` exacto no cambian.

## 3. Build mobile actual

Se separan:

- `app_version`: texto humano como `1.4.2`, sólo display/soporte;
- `app_build`: entero monotónico por plataforma, Android `versionCode` e iOS build number entero equivalente.

Login y cada request native normal transportan:

```text
X-Native-Platform: android|ios
X-Native-App-Build: <entero positivo actual>
X-Native-App-Version: <opcional>
```

No se infiere por User-Agent u Origin. La plataforma debe coincidir con la guardada en la sesión para impedir elegir el mínimo del otro OS. Ausencia/formato/plataforma inválidos producen error tipado de metadata; build inferior al mínimo produce upgrade required —preferentemente 426—, no 401.

La configuración es independiente:

- `MIN_NATIVE_ANDROID_BUILD`;
- `MIN_NATIVE_IOS_BUILD`.

La sesión puede guardar `platform`, `app_build_at_login` y `app_version_at_login` para soporte, pero no se actualiza por request ni gobierna acceso posterior.

## 4. Upgrade, retiro y excepciones reductoras

Upgrade-in-place: token emitido con build 100, app actualizada a 120 y mínimo 110; la siguiente request declara 120 y se permite sin re-login.

Forced retirement: sesión válida en build 120, mínimo elevado a 130; la siguiente request recibe upgrade required. Tras instalar build 135, el mismo token vuelve a ser admisible si no expiró ni fue revocado.

- logout-device no exige metadata ni mínimo: preserva lookup exacto, anti-oracle y 204 idempotente para permitir limpieza desde clientes obsoletos;
- logout-all exige sesión activa y metadata válida, pero omite el umbral mínimo como operación reductora de privilegio;
- negocio, `/session` y `ws-ticket` exigen build admitido;
- `ws-ticket` guarda plataforma y build actuales de la emisión;
- RSP-09D conserva esa metadata en el socket y lo cierra si el mínimo sube.

El build es declarado y una app modificada puede falsearlo. Es control operativo para clientes oficiales, no anti-tamper ni reemplazo de Bearer, TLS, autorización o firma de artefactos.

## 5. CORS native

La allowlist futura permanece exacta y sin credentials/wildcards:

- Android: `https://localhost`;
- iOS: `capacitor://localhost`;
- headers: `Authorization`, `Content-Type`, `X-Native-Platform`, `X-Native-App-Build` y, si se usa, `X-Native-App-Version`.

No se modificó la allowlist productiva.

## 6. Retención y cleanup obligatorio

Defaults recomendados/configurables:

```text
NATIVE_WS_TICKET_TTL_SECONDS=30
NATIVE_WS_TICKET_RETENTION_MINUTES=60
NATIVE_WS_TICKET_CLEANUP_INTERVAL_SECONDS=300
NATIVE_WS_TICKET_CLEANUP_BATCH_SIZE=500
```

La política borra tickets usados o no usados cuando `expires_at < now() - retention`. RSP-09B implementará un janitor backend obligatorio al startup y periódico —~5 min—. Cada transacción elimina un lote ordenado/limitado por el índice `expires_at`; si queda backlog agenda otra tanda con yield. No ejecuta un DELETE gigante por request ni depende de `pg_cron`, Redis o actividad de emisión. Readiness/emisión sólo se habilitan después de un sweep inicial correcto y se suspende nueva emisión si el backlog supera el umbral operativo configurado por fallos persistentes.

El cleanup es idempotente y seguro ante futuras instancias concurrentes. La migración 008 incluirá índices sobre `ticket_hash`, `id_sesion_nativa`/FK y `expires_at`. Raw/HMAC nunca se registran.

## 7. Tests y roadmap

RSP-09B incorpora:

- 14 casos de headers/minimum-build HTTP, mínimos por plataforma, upgrade-in-place, forced retirement, logout/logout-all y emisión de ticket;
- 11 casos de retención: reciente, dentro/fuera de retention, usado viejo, idempotencia, aislamiento, índice, batch, startup/timer, redaction y emisión continua acotada.

RSP-09D incorpora:

- 4 casos de build en socket native y forced upgrade;
- 9 casos de `version_sesion_emitida` web, versión igual/cambiada, direct close perdido, usuario inactivo, fail-closed, pre-delivery, aislamiento y coexistencia web/native.

Roadmap final:

- RSP-09B: backend auth, migración 008, minimum-build HTTP, emisión/persistencia y cleanup obligatorio de tickets;
- RSP-09C: secure storage, headers platform/build, transport y UX upgrade required Android/iOS;
- RSP-09D: redemption, registry/fan-out, revalidación web/native y forced upgrade de sockets;
- RSP-09E: piloto Android, preparación iOS y GPS real;
- RSP-09F: resiliencia/offline.

## 8. Archivos y validación

R5 modifica únicamente:

- `docs/CODEX_ARQUITECTURA_RSP_09A_ANDROID_AUTH.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A.md`;
- `docs/CODEX_PROGRESS_ETAPA_RSP_09A_R5.md`.

Validación docs-only ejecutada:

- `git diff --check`: correcto; sólo avisos de normalización LF/CRLF, sin errores de whitespace;
- secret scan de los tres documentos: sin coincidencias de claves privadas, credenciales asignadas ni patrones conocidos de tokens;
- comparación contra HEAD inicial `a77400af99796ca8f20d3f50ded84daa42a3ca75`: exactamente los tres Markdown declarados;
- `api/src` y `front/src`: sin cambios;
- packages/locks: sin cambios y ninguna dependencia instalada;
- `api/db/migrations`: sin cambios; no se creó 008 ni se modificó 000..007;
- ningún APK/AAB/IPA/xcarchive ni build native productivo nuevo.

No corresponde repetir suites pesadas mientras el diff sea exclusivamente Markdown.
