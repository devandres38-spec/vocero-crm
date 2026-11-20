import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  type AnyPgColumn,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { REGION_DEFAULTS } from "../region";

/**
 * Tiempo: todas las columnas son `timestamp without time zone` y el marco es
 * UTC. Drizzle lo respeta en ambas direcciones; `now()` de los `defaultNow()`
 * solo lo respeta porque la conexión fija `TimeZone: "UTC"`
 * (ver src/lib/db/index.ts). No cambies una columna a `timestamptz` de forma
 * aislada: al leerla Drizzle seguiría añadiéndole "+0000" salvo que también
 * lleve `{ withTimezone: true }`.
 */

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
  /**
   * 069 — `activa` | `suspendida`. Una suspendida no deja usar la app ni la
   * API, ni enviar ni despachar; la ingesta de webhooks sigue (no se pierde
   * nada). Better Auth ignora las columnas que no declara.
   */
  status: text("status", { enum: ["activa", "suspendida"] })
    .notNull()
    .default("activa"),
  suspendedAt: timestamp("suspended_at"),
  /**
   * 069 — Módulos de ESTA organización dentro del techo de la instancia
   * (`src/server/modulos/efectivos.ts`). `null` o clave ausente = hereda el
   * techo: lo que tienen todas las organizaciones de `single`.
   */
  modules: jsonb("modules").$type<{
    agenda?: boolean;
    atribucion?: boolean;
    channels?: string[];
    modules?: string[];
  }>(),
  /**
   * 070 — El despliegue de cerebro que atiende a ESTE negocio en `multi`
   * (`src/server/brains/deployment.ts`). `null` = bandeja manual. En `single`
   * no se lee: manda `BRAIN_DISPATCH_URL`.
   */
  brainDeploymentId: text("brain_deployment_id").references(
    (): AnyPgColumn => brainDeployment.id,
    { onDelete: "restrict" }
  ),
  /**
   * 072 (D2, D3) — El Vertical Pack de ESTE negocio (`src/verticals/`): cómo
   * se ve y qué plantilla sugiere. Uno desconocido se resuelve como
   * `default`. Solo la agencia lo cambia (Blueprint, `/platform`, MCP).
   */
  verticalPack: text("vertical_pack").notNull().default("default"),
  /** 072 (D5) — Ajustes por negocio, SOLO datos (vocabulario, menú, inicio). */
  verticalOverrides: jsonb("vertical_overrides").$type<Record<string, unknown>>(),
  /**
   * 072 (D9) — Los campos de la ficha de este negocio (`src/lib/ficha-campos.ts`).
   * Es el esquema; los valores siguen en `contact.ficha`. `null` = sin esquema.
   */
  fichaFields: jsonb("ficha_fields").$type<{ version: 1; fields: unknown[] }>(),
}, (t) => [
  // Auditoría 070 (M-3): la FK RESTRICT y los conteos de /platform/cerebros.
  index("organization_brain_deployment_idx")
    .on(t.brainDeploymentId)
    .where(sql`${t.brainDeploymentId} is not null`),
  check("organization_vertical_pack_ck", sql`${t.verticalPack} ~ '^[a-z][a-z0-9-]{1,39}$'`),
  check(
    "organization_vertical_overrides_tam_ck",
    sql`${t.verticalOverrides} is null or pg_column_size(${t.verticalOverrides}) < 8192`
  ),
  check(
    "organization_ficha_fields_tam_ck",
    sql`${t.fichaFields} is null or pg_column_size(${t.fichaFields}) < 16384`
  ),
]);

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** 069 — SHA-256 del token del enlace; el token en claro nunca se guarda. */
  tokenHash: text("token_hash").unique(),
  acceptedAt: timestamp("accepted_at"),
});

/* ============================================================
 * 069 — Plataforma (modo `multi`). Datos de la PLATAFORMA, no de un tenant:
 * no llevan `organization_id NOT NULL` (Complexity Tracking del plan).
 * ============================================================ */

/** Super-Admins. Separado de `member.role` a propósito (constitución I). */
export const platformAdmin = pgTable("platform_admin", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
});

/** Acceso de soporte de un Super-Admin a UNA organización, con caducidad. */
export const supportGrant = pgTable(
  "support_grant",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    platformUserId: text("platform_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["lectura", "configuracion"] }).notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by"),
  },
  (t) => [index("support_grant_org_idx").on(t.organizationId, t.expiresAt)]
);

/** Tokens personales `alp_…` de un Super-Admin (REST y MCP). Solo el hash. */
export const platformApiToken = pgTable("platform_api_token", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  last4: text("last4").notNull(),
  scopes: jsonb("scopes").$type<("read" | "provision")[]>().notNull(),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * 070 — Un despliegue de cerebro (una Nea `multiorg`) que atiende a N
 * negocios. Su secreto firma los despachos y deriva la credencial de cada
 * organización (`vocero:cerebro:v1`), así que se guarda CIFRADO (el CRM lo
 * necesita en claro), nunca hasheado. Solo `secretLast4` sale hacia afuera.
 */
export const brainDeployment = pgTable("brain_deployment", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dispatchUrl: text("dispatch_url").notNull(),
  /** `null` = `{origen de dispatchUrl}/health`. */
  healthUrl: text("health_url"),
  secretCipher: text("secret_cipher").notNull(),
  secretIv: text("secret_iv").notNull(),
  secretTag: text("secret_tag").notNull(),
  secretLast4: text("secret_last4").notNull(),
  status: text("status", { enum: ["activo", "pausado"] })
    .notNull()
    .default("activo"),
  lastHealthAt: timestamp("last_health_at"),
  lastHealthOk: boolean("last_health_ok"),
  /** Solo `{status, version, mode, llm, error}`: nada de URLs ni secretos. */
  lastHealthDetail: jsonb("last_health_detail").$type<Record<string, unknown>>(),
  createdBy: text("created_by").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Auditoría 070 (B-3): el estado lo garantiza también la base.
  check("brain_deployment_status_ck", sql`${t.status} in ('activo', 'pausado')`),
]);

/** Rastro de toda acción de plataforma (Ley 1581). */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    via: text("via", { enum: ["sesion", "api", "mcp"] }).notNull().default("sesion"),
    tokenId: text("token_id"),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("platform_audit_log_org_idx").on(t.organizationId, t.createdAt)]
);

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Llave de resolución WhatsApp (003): teléfono normalizado (521→52) o
     * `bsuid:<id>` cuando Meta no manda wa_id. Estable de por vida.
     */
    /**
     * 014: canal por el que vive este contacto. Aditivo y con default: toda
     * fila existente sigue significando exactamente lo mismo.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger", "tiktok"] })
      .notNull()
      .default("whatsapp"),
    /**
     * Llave de resolucion. WhatsApp: telefono normalizado (521 a 52) o
     * `bsuid:<id>`. Instagram (014): `ig:<IGSID>`. Estable de por vida.
     * El nombre `wa_identity` se conserva porque es contrato publicado:
     * `/api/bot/context?waIdentity=...` lo recibe y lo devuelve, y hay
     * cerebros externos que dependen de el.
     */
    waIdentity: text("wa_identity").notNull(),
    /** Teléfono como ATRIBUTO opcional (003): falta en contactos BSUID. */
    phone: text("phone"),
    /** Business-Scoped User ID si se conoce (003). */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    /**
     * Quién puso este nombre.
     *
     * `perfil` = lo trajo WhatsApp y puede seguir actualizandose solo;
     * `manual` = lo escribio una persona en el CRM y NADIE lo pisa.
     *
     * Existe porque las dos cosas se necesitan a la vez: un contacto que
     * cambia su nombre de WhatsApp tiene que reflejarse (#51), y el operador
     * que renombro a alguien como "Juan - obra Polanco" no puede perder ese
     * trabajo con el siguiente mensaje.
     */
    nameSource: text("name_source", { enum: ["perfil", "manual"] })
      .notNull()
      .default("perfil"),
    notes: text("notes"),
    /**
     * Ficha de calificación que levanta un cerebro externo por
     * `PUT /api/bot/ficha`. Es un objeto libre a propósito: los datos que
     * importan de un lead los define cada negocio (una clínica querrá
     * "tratamiento", una constructora "metros"), y cablearlos como columnas
     * obligaría a migrar el CRM cada vez que alguien cambia su cuestionario.
     * Merge campo a campo; `null` explícito borra la clave.
     */
    ficha: jsonb("ficha").$type<Record<string, unknown>>(),
    /**
     * De dónde salió el prospecto. NULL = nadie la capturó, y entonces la API
     * la deduce. Así no hace falta backfill ni marcar en falso los contactos
     * que ya existían.
     */
    source: text("source", {
      enum: ["anuncio", "organico", "referido", "conocido", "otro"],
    }),
    /**
     * 027 — El agente no le responde a esta persona: clientes, miembros,
     * proveedores — gente a la que el dueño quiere atender él mismo.
     *
     * Vive en el CONTACTO y no solo en la conversación porque un contacto
     * importado todavía no tiene conversación (no se crean hilos vacíos), y
     * porque al eliminar una conversación (026) la siguiente nacería con el
     * agente encendido. La conversación lo hereda al crearse
     * (`getOrCreateConversation`); después manda el interruptor de la Bandeja.
     */
    aiPaused: boolean("ai_paused").notNull().default(false),
    /**
     * 073-B (D6, Ley 1581) — La persona pidió no recibir más mensajes. Bloquea
     * la IA, las plantillas y los seguimientos; una persona del equipo aún
     * puede contestarle dentro de la ventana. No se revierte sola: solo con
     * la reactivación explícita de la Bandeja.
     */
    optOutAt: timestamp("opt_out_at"),
    /** Quién la registró: el detector del CRM, el agente o una persona. */
    optOutSource: text("opt_out_source", { enum: ["detector", "agente", "operador"] }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // 014: el canal entra en la llave. Sin el, un IGSID que coincidiera con
    // un telefono normalizado mezclaria dos personas en silencio.
    uniqueIndex("contact_org_channel_identity_uq").on(
      t.organizationId,
      t.channel,
      t.waIdentity
    ),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    /**
     * Monto de la negociación en CENTAVOS ENTEROS. NULL = nadie lo capturó, que
     * no es lo mismo que cero: un trato sin monto no vale $0, simplemente no se
     * sabe, y el tablero lo dice con palabras en vez de sumar un cero.
     */
    amountCents: integer("amount_cents"),
    /** Moneda del monto; la del negocio al capturarlo (Ajustes → Marca). */
    currency: text("currency"),
    /**
     * Prioridad de cierre. NULL = nadie la ha decidido, que NO es lo mismo que
     * "media": nada la escribe automáticamente, así que el dueño puede confiar
     * en que lo que ve es lo que él puso.
     */
    priority: text("priority", { enum: ["alta", "media", "baja"] }),
    priorityUpdatedAt: timestamp("priority_updated_at"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

/**
 * Bitácora de movimientos de etapa: append-only. Nada se actualiza ni se borra;
 * corregir un dato es agregar un movimiento nuevo.
 *
 * Es el cimiento de todo lo histórico: sin ella el CRM solo sabe dónde está
 * cada lead HOY, y "¿cuánto cerré en julio?" no tiene respuesta.
 *
 * Regla dura: la ÚNICA puerta que escribe aquí —y que escribe `lead.stage_id`—
 * es `src/server/leads/stage-history.ts`. Un unit test de vigilancia falla si
 * aparece otra escritura, porque un camino que mueva el lead sin registrar el
 * evento no truena: solo hace que las gráficas mientan meses después.
 */
export const leadStageEvent = pgTable(
  "lead_stage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    /** Denormalizado a propósito: casi toda agregación cruza con el contacto,
     *  y el join extra se pagaría en cada consulta. */
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** NULL = el lead nació en `toStage` (evento de creación). */
    fromStageId: text("from_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    fromStageName: text("from_stage_name"),
    toStageId: text("to_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    /** Snapshots: sobreviven al renombre y al borrado de la etapa, para que
     *  reorganizar el tablero de hoy no reescriba el embudo del pasado. */
    toStageName: text("to_stage_name").notNull(),
    toStageKind: text("to_stage_kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    /** Cuándo PASÓ (no cuándo se registró). */
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    /** NULL = no lo movió una persona (bot, sistema, migración). */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source", {
      enum: ["dueno", "bot", "sistema", "migracion"],
    })
      .notNull()
      .default("dueno"),
    /** true = fecha SEMBRADA en la migración, no observada. Cuenta para los
     *  totales pero jamás para promedios de tiempo. */
    approximate: boolean("approximate").notNull().default(false),
    lossReason: text("loss_reason", {
      enum: [
        "precio",
        "no_es_perfil",
        "sin_presupuesto",
        "eligio_otro",
        "nunca_contesto",
        "otro",
      ],
    }),
    lossNote: text("loss_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lse_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("lse_lead_occurred_idx").on(t.leadId, t.occurredAt),
    index("lse_org_kind_occurred_idx").on(
      t.organizationId,
      t.toStageKind,
      t.occurredAt
    ),
    // Perder un trato sin motivo es imposible a nivel de BASE, no por
    // disciplina de cada ruta. La excepción es la siembra de la migración: no
    // puede inventar un motivo que nadie capturó.
    check(
      "lse_loss_reason_ck",
      sql`${t.toStageKind} <> 'lost' OR ${t.approximate} = true OR ${t.lossReason} IS NOT NULL`
    ),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * 014: canal de la conversacion. Denormalizado del contacto a proposito:
     * el ruteo de salida y el filtro de la bandeja lo leen en cada mensaje.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger", "tiktok"] })
      .notNull()
      .default("whatsapp"),
    /**
     * 014: identificador del hilo en la plataforma de origen. Zernio entrega
     * un conversationId opaco ("no asumas su formato") que hace falta para
     * responder; WhatsApp no lo necesita y queda null.
     */
    channelThreadRef: text("channel_thread_ref"),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // 008: manual_reply = el dueño respondió desde la app del teléfono.
      // hostilidad = el lead se puso agresivo y el agente se retiró.
      enum: [
        "cliente",
        "modelo",
        "error",
        "ventana",
        "hostilidad",
        "manual_reply",
        // 073-A — los pone el sistema: llave de IA sin saldo, opt-out (Ley
        // 1581) y abuso/flood. Solo TS: la columna es texto libre.
        "sin_saldo",
        "opt_out",
        "abuso",
      ],
    }),
    /** 073-B (D1) — Desde cuándo la IA está apagada a mano (sin handoff). */
    aiPausedAt: timestamp("ai_paused_at"),
    /**
     * 073-B (D1) — El último tramo que atendió una persona: de la pausa a la
     * reanudación. El cerebro lo lee UNA vez (`humanGap` del contexto) para
     * no contestar como si nada hubiera pasado.
     */
    humanGapFrom: timestamp("human_gap_from"),
    humanGapTo: timestamp("human_gap_to"),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /**
     * 008 — Origen del saliente: IA (bot), operador del CRM, manual desde la
     * app de WhatsApp Business del teléfono (echo), o plantilla. En entrantes
     * queda el default y la UI lo ignora.
     */
    origin: text("origin", {
      enum: ["ai", "operator", "manual", "template"],
    })
      .notNull()
      .default("operator"),
    /** 008 — Adjunto del mensaje (imagen, doc, ubicación…), si lo hay. */
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    /**
     * 039 — `wamid` del mensaje al que responde (cita). Sin FK: el citado
     * puede no estar en el CRM; se resuelve al leer (`inbox/quotes.ts`).
     */
    replyToWaMessageId: text("reply_to_wa_message_id"),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
  ]
);

/**
 * 008 — Adjuntos: archivo (imagen/video/audio/documento/sticker) copiado al
 * volumen local (`MEDIA_DIR`) o contenido estructurado (location/contacts) en
 * `payload`. Meta expira sus archivos (~30 días): el disco propio es la
 * fuente durable (constitución II: sin S3/R2).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
      ],
    }).notNull(),
    /** media id de Graph (entrantes/salientes subidos); NULL en location/contacts. */
    waMediaId: text("wa_media_id"),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    caption: text("caption"),
    /** location {latitude, longitude, name?, address?} o contacts (subset). */
    payload: jsonb("payload"),
    /** Ruta relativa dentro de MEDIA_DIR; NULL si aún no descargado o no aplica. */
    storagePath: text("storage_path"),
    fetchStatus: text("fetch_status", {
      enum: ["available", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    /**
     * 065 — La Cuenta de mensajes del split de 2026: donde viven las
     * plantillas y el método de pago. `waba_id` sigue siendo la Cuenta de
     * WhatsApp (la del número). Nula = instancia de una sola ID, como antes.
     */
    messagingAccountId: text("messaging_account_id"),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

/**
 * 014 - Credenciales del canal de Instagram. Tabla explicita (no un jsonb
 * generico) porque unas credenciales tienen forma fija y conocida: asi
 * conservan tipado e indices. El token se cifra con los mismos helpers que el
 * de WhatsApp; un segundo mecanismo de cifrado seria un segundo mecanismo que
 * auditar.
 */
export const instagramCredentials = pgTable(
  "instagram_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] }).notNull(),
    /** IG_ID del perfil profesional: por el enruta el webhook. */
    igUserId: text("ig_user_id").notNull(),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    username: text("username"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * 030 — Obsoleta: el secreto iba en claro. Nada la escribe; el arranque
     * la cifra en las columnas de abajo y la deja en nulo. Se quita en una
     * versión mayor (spec 030, D6).
     */
    webhookSecret: text("webhook_secret"),
    /** 030 — Secreto HMAC de las entregas de Zernio, cifrado como el token. */
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instagram_credentials_org_uq").on(t.organizationId),
    uniqueIndex("instagram_credentials_ig_user_uq").on(t.igUserId),
    index("instagram_credentials_account_ref_idx").on(t.accountRef),
  ]
);

/**
 * 017 — Credenciales del canal de Messenger: la página de Facebook y su token
 * de acceso, cifrado con el mismo AES-256-GCM que los demás. Tabla propia y
 * explícita, como la de Instagram: unas credenciales tienen forma fija y
 * conocida, y esconderlas en un jsonb perdería el tipado y los índices.
 */
export const messengerCredentials = pgTable(
  "messenger_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] })
      .notNull()
      .default("meta"),
    /**
     * ID de la página de Facebook: por él enruta el webhook de Meta
     * (`entry[].id`). En modo Zernio puede no conocerse — ahí enruta
     * `account_ref` — así que es opcional.
     */
    pageId: text("page_id"),
    pageName: text("page_name"),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * 030 — Obsoleta: el secreto iba en claro. Nada la escribe; el arranque
     * la cifra en las columnas de abajo y la deja en nulo. Se quita en una
     * versión mayor (spec 030, D6).
     */
    webhookSecret: text("webhook_secret"),
    /** 030 — Secreto HMAC de las entregas de Zernio, cifrado como el token. */
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messenger_credentials_org_uq").on(t.organizationId),
    uniqueIndex("messenger_credentials_page_uq").on(t.pageId),
    index("messenger_credentials_account_ref_idx").on(t.accountRef),
  ]
);

/**
 * 022 — Credenciales del canal de TikTok.
 *
 * TikTok no abre su API de mensajes a una app propia como hace Meta: llega por
 * la API unificada de Zernio. `source` existe, con un solo valor, para que una
 * fuente futura no pida otra migración (mismo patrón que
 * `messenger_credentials`).
 */
export const tiktokCredentials = pgTable(
  "tiktok_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["zernio"] }).notNull().default("zernio"),
    /** `accountId` de la cuenta en Zernio: por él enruta el webhook. */
    accountRef: text("account_ref").notNull(),
    /** Usuario de TikTok, solo para enseñarlo en Ajustes. */
    username: text("username"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * 030 — Obsoleta: el secreto iba en claro. Nada la escribe; el arranque
     * la cifra en las columnas de abajo y la deja en nulo. Se quita en una
     * versión mayor (spec 030, D6).
     */
    webhookSecret: text("webhook_secret"),
    /** 030 — Secreto HMAC de las entregas de Zernio, cifrado como el token. */
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tiktok_credentials_org_uq").on(t.organizationId),
    uniqueIndex("tiktok_credentials_account_ref_uq").on(t.accountRef),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    /** 034 — El rol del agente (`src/lib/agent-roles.ts`). */
    role: text("role").notNull().default("calificador"),
    /**
     * 034 — Las herramientas encendidas, por clave del catálogo. `null` =
     * todas: lo que tiene una instalación que actualiza.
     */
    tools: jsonb("tools").$type<string[]>(),
    /** 071 — Cómo trata el agente a los clientes (`TRATOS` en `src/lib/agent-roles.ts`). */
    treatment: text("treatment").notNull().default("tu"),
    /** 071 — Cerrar con amabilidad las conversaciones sin rumbo (el cerebro decide cuándo). */
    stallEnabled: boolean("stall_enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_profile_org_uq").on(t.organizationId),
    check("agent_profile_treatment_ck", sql`${t.treatment} in ('tu', 'usted', 'neutro')`),
  ]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

/* ============================================================
 * 015 — Motor de agenda (detrás de la bandera AGENDA)
 *
 * Las tablas se crean SIEMPRE, encendida o apagada la bandera: una tabla
 * vacía es inerte, y a cambio todas las instancias del mundo comparten la
 * misma estructura y la misma cadena de migraciones (ADR-001).
 * ============================================================ */

/** Configuración de la agenda del negocio: una fila por organización. */
export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `{"mon":[{"start":"09:00","end":"18:00"}]}` — hora de PARED, no UTC. */
    weeklyHours: jsonb("weekly_hours").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(2),
    maxDaysAhead: integer("max_days_ahead").notNull().default(7),
    // 068 — Default de la región (Bogotá). La app siempre escribe la zona
    // explícita; esto solo cubre una fila insertada a mano.
    timezone: text("timezone").notNull().default(REGION_DEFAULTS.timezone),
    /**
     * Cómo se entrega la reunión. `enlace-fijo` no habla con nadie: es el
     * default y la razón de que encender la agenda no exija terceros.
     * Un fork agrega el suyo al catálogo del código sin tocar esta columna.
     */
    connector: text("connector").notNull().default("enlace-fijo"),
    /** Sala fija del conector `enlace-fijo`; null ⇒ citas sin link. */
    meetingLink: text("meeting_link"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_settings_org_uq").on(t.organizationId)]
);

/**
 * La cita. Una sola tabla para sesiones y bloqueos manuales: un bloqueo es
 * una cita sin contacto que ocupa agenda igual.
 */
export const booking = pgTable(
  "booking",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["session", "block"] })
      .notNull()
      .default("session"),
    status: text("status", {
      enum: ["agendada", "realizada", "no_show", "cancelada"],
    })
      .notNull()
      .default("agendada"),
    source: text("source", { enum: ["manual", "ai"] })
      .notNull()
      .default("manual"),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "cascade",
    }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    leadId: text("lead_id").references(() => lead.id, { onDelete: "set null" }),
    /** Instante UTC. El horario semanal es de pared; esto ya está resuelto. */
    scheduledAt: timestamp("scheduled_at").notNull(),
    /** Capturada al crear: cambiar la configuración no reescribe el pasado. */
    durationMinutes: integer("duration_minutes").notNull(),
    /**
     * Con qué conector nació la ENTREGA. Reprogramar y cancelar hablan con
     * ESTE, no con el activo: si el negocio cambia de proveedor, las citas ya
     * confirmadas siguen viviendo donde se crearon.
     */
    connector: text("connector"),
    /** Id de la reunión/evento en el proveedor; null en `enlace-fijo`. */
    externalRef: text("external_ref"),
    /**
     * El link que se le dio al cliente. Se COPIA, no se lee de la
     * configuración: la cita es un hecho histórico, no una vista del presente.
     */
    meetingLink: text("meeting_link"),
    /**
     * El proveedor falló al crear la reunión. La cita existe igual —un tercero
     * caído no cuesta la conversión— y el operador reintenta desde "Citas".
     */
    linkPending: boolean("link_pending").notNull().default(false),
    /** Conversación del Laboratorio: jamás llama a un conector real. */
    isTest: boolean("is_test").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("booking_org_when_idx").on(t.organizationId, t.scheduledAt),
    index("booking_org_status_idx").on(t.organizationId, t.status),
    /**
     * Anti doble-booking ATÓMICO. La re-validación al confirmar deja una
     * ventana entre leer y escribir; esto la cierra en la BASE: dos
     * confirmaciones simultáneas del mismo instante no pueden ganar las dos, y
     * la perdedora recibe un 23505 que el servicio traduce a `slot_taken` con
     * alternativas frescas. Las citas de prueba quedan fuera: no consumen la
     * agenda real.
     */
    uniqueIndex("booking_org_active_slot_uq")
      .on(t.organizationId, t.scheduledAt)
      .where(
        sql`${t.status} in ('agendada','realizada') and ${t.isTest} = false`
      ),
  ]
);

/**
 * La memoria de lo ofrecido. Es lo que hace verificable el requisito
 * innegociable: sin fila aquí, no hay reserva.
 *
 * Vive en el CRM y no en quien conduce la conversación porque Vocero promete
 * "conecta TU propio cerebro": con la garantía del lado del cliente, cualquier
 * cerebro podría reservar un instante que jamás se ofreció y el CRM lo
 * aceptaría.
 */
export const offeredSlot = pgTable(
  "offered_slot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    startUtc: timestamp("start_utc").notNull(),
    /** La etiqueta EXACTA que se le mostró al cliente. */
    label: text("label").notNull(),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
  },
  (t) => [index("offered_slot_conv_idx").on(t.conversationId, t.startUtc)]
);

/**
 * Credenciales del conector Zoom (app Server-to-Server del propio negocio).
 * Tabla explícita como las de WhatsApp e Instagram: unas credenciales tienen
 * forma fija y conocida, y así conservan tipado e índices. El secreto se cifra
 * con los mismos helpers; un segundo mecanismo sería otro que auditar.
 */
export const zoomCredentials = pgTable(
  "zoom_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    clientId: text("client_id").notNull(),
    secretCipher: text("secret_cipher").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    /** `error` SE ESCRIBE cuando el proveedor rechaza la autenticación. */
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("zoom_credentials_org_uq").on(t.organizationId)]
);

/**
 * Credenciales del conector Google (Calendar + Meet), de la app de Google
 * Cloud del propio negocio. DOS secretos cifrados: el client secret y el
 * refresh token pegado una sola vez.
 */
export const googleCredentials = pgTable(
  "google_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    clientSecretCipher: text("client_secret_cipher").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    clientSecretTag: text("client_secret_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_credentials_org_uq").on(t.organizationId)]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed", "agent_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * 016 — Atribución de anuncios y Conversions API
 * (detrás de la bandera ATRIBUCION)
 * ============================================================ */

/**
 * De qué anuncio vino una conversación. El primer referral gana: el UNIQUE de
 * abajo es lo que vuelve idempotente la captura ante los reintentos de Meta,
 * en vez de un "consulta y luego inserta" que dos webhooks simultáneos
 * ganarían los dos.
 */
export const adAttribution = pgTable(
  "ad_attribution",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /**
     * El identificador del clic en el anuncio. Es la llave de TODO: sin él no
     * hay nada que reportarle a Meta. Nullable porque hay referrals sin clid,
     * y porque sin la bandera ATRIBUCION no se guarda (018): el origen del
     * anuncio se ve siempre, el identificador de clic solo si se atribuye.
     */
    ctwaClid: text("ctwa_clid"),
    sourceId: text("source_id"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    body: text("body"),
    mediaType: text("media_type"),
    /**
     * 018 — La imagen del creativo, copiada del CDN de Meta (su URL caduca en
     * días). Compartida por todas las conversaciones del mismo `source_id`: se
     * descarga una vez por anuncio. Borrar el adjunto deja la fila sin imagen,
     * no apuntando a nada.
     */
    imageAssetId: text("image_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    /**
     * El referral recortado a sus claves conocidas (018: con cotas de tamaño,
     * y sin `ctwa_clid` si la bandera estaba apagada). Es la póliza contra
     * "Meta agregó un campo", y de aquí se vuelve a leer la URL de la imagen
     * cuando hay que reparar la copia.
     */
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_attribution_org_conversation_uq").on(
      t.organizationId,
      t.conversationId
    ),
    index("ad_attribution_org_contact_idx").on(t.organizationId, t.contactId),
    // 018 — la imagen ya guardada de un anuncio, y a qué filas asignarla.
    index("ad_attribution_org_source_idx").on(t.organizationId, t.sourceId),
  ]
);

/**
 * Cada intento de reportarle un desenlace a Meta. Las filas `skipped` no son
 * basura: son la respuesta a "¿por qué este lead no aparece en Meta?", que sin
 * ellas se contesta adivinando.
 */
export const conversionEvent = pgTable(
  "conversion_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    attributionId: text("attribution_id").references(() => adAttribution.id, {
      onDelete: "set null",
    }),
    /** Nombre del catálogo de Meta tal cual (`QualifiedLead`, `Purchase`). */
    eventName: text("event_name").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    /** Motivo legible: por qué se omitió, o qué contestó Meta. */
    error: text("error"),
    /**
     * Acuse del envío. Es la única referencia que Meta pide para rastrear un
     * evento de su lado; sin persistirla, un `sent` no se puede reclamar.
     */
    fbTraceId: text("fb_trace_id"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El dedup ES este índice: la fila se inserta ANTES de hablar con Meta y
    // con ON CONFLICT DO NOTHING. Dos movimientos simultáneos del mismo lead
    // no pueden mandar dos compras.
    uniqueIndex("conversion_event_org_conv_name_uq").on(
      t.organizationId,
      t.conversationId,
      t.eventName
    ),
    index("conversion_event_org_created_idx").on(
      t.organizationId,
      t.createdAt
    ),
  ]
);

/** Conexión del negocio con su dataset de Meta (token cifrado en reposo). */
export const capiSettings = pgTable(
  "capi_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id").notNull(),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * Qué etapa significa "lead calificado" PARA ESTE NEGOCIO. Las etapas
     * sembradas de Vocero no incluyen ninguna con ese nombre y cada quien
     * renombra las suyas, así que se elige en vez de adivinarse. NULL = ese
     * evento no se emite. `set null` a propósito: borrar la etapa apaga el
     * evento, no rompe la configuración.
     */
    qualifiedStageId: text("qualified_stage_id").references(
      () => pipelineStage.id,
      { onDelete: "set null" }
    ),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("capi_settings_org_uq").on(t.organizationId)]
);

/* ============================================================
 * Proveedor de IA (Ajustes → IA)
 * ============================================================ */

/**
 * Credencial del proveedor de IA de la organización (puerto de `ai_credentials`
 * de Vocero Cloud, issue #85). Una fila por organización: proveedor (su
 * `base_url` OpenAI-compatible), modelo y token cifrado con los mismos helpers
 * que el de WhatsApp; hacia fuera solo `token_last4`.
 *
 * `status` lo escribe el adaptador según lo que respondió QUIEN COBRA: 401 →
 * `paused_invalid_token`, 402 → `paused_no_credit`. Un 429 o un 500 no pausan
 * (ver `server/ai/credentials.ts`). Guardar un token nuevo vuelve a `active`.
 *
 * Sin fila, el adaptador cae a las variables `OPENROUTER_*` del entorno
 * (respaldo para instalaciones automatizadas); con fila, la fila manda.
 */
export const aiCredentials = pgTable(
  "ai_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Preset de la UI; `base_url` es lo que de verdad identifica al proveedor. */
    provider: text("provider", { enum: ["openrouter", "openai_compatible"] })
      .notNull()
      .default("openrouter"),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /** Lo ÚNICO del token que puede salir hacia el cliente. */
    tokenLast4: text("token_last4").notNull(),
    status: text("status", {
      enum: ["active", "paused_invalid_token", "paused_no_credit"],
    })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_credentials_org_uq").on(t.organizationId)]
);

/* ============================================================
 * 021 — Despacho al cerebro
 * ============================================================ */

/**
 * El outbox del despachador (spec 021): los turnos que el CRM le empuja a un
 * cerebro externo. El mensaje ya está en `message` antes de que exista una
 * fila aquí: bandeja primero, cerebro después.
 *
 * Misma tabla, columnas y estados que `dispatch` de Vocero Cloud, sin lo que
 * allá es de la plataforma (`brain_generation`, `expires_at`, `brain_kind`,
 * `responded_message_id`).
 */
export const dispatch = pgTable(
  "dispatch",
  {
    /** Es el `dispatchId` que viaja al cerebro: la clave de idempotencia. */
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "pendiente",
        "en_vuelo",
        "entregado",
        "caducado_a_humano",
        "descartado",
      ],
    })
      .notNull()
      .default("pendiente"),
    /** Sube al tomar la fila: distingue a dos dueños de un mismo lease. */
    attempts: integer("attempts").notNull().default(0),
    /**
     * La ventana de agrupado: cada mensaje nuevo de la conversación la empuja
     * hacia adelante. El worker solo toma filas cuyo `not_before` ya venció,
     * así que una ráfaga se junta sola.
     */
    notBefore: timestamp("not_before").notNull().defaultNow(),
    firstMessageAt: timestamp("first_message_at").notNull(),
    lastMessageAt: timestamp("last_message_at").notNull(),
    leasedUntil: timestamp("leased_until"),
    /**
     * 025 — Los entrantes que este despacho le DEBE al cerebro: los que lo
     * encolaron o lo extendieron.
     *
     * La ráfaga se delimita por el último saliente, y eso confunde «sin
     * responder» con «sin entregar»: lo que el cliente escribe mientras el
     * cerebro piensa queda DETRÁS de su respuesta. Con los ids anotados, ese
     * mensaje viaja aunque ya haya una respuesta después de él. Nulo en filas
     * anteriores a esta columna, que se comportan como antes.
     */
    messageIds: jsonb("message_ids").$type<string[]>(),
    /** Motivo del último fallo. Nunca el cuerpo firmado ni la llave. */
    lastError: text("last_error"),
    /** 070 — Qué despliegue recibió este despacho (`multi`). */
    brainDeploymentId: text("brain_deployment_id").references(
      () => brainDeployment.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    /**
     * La pieza central de esta tabla: como máximo UN despacho vivo por
     * conversación. De aquí salen el agrupado de ráfagas y el orden, y
     * sobreviven a que alguien reescriba el worker, porque la garantía la da
     * Postgres y no la lógica.
     */
    uniqueIndex("dispatch_conversation_vivo_uq")
      .on(t.conversationId)
      .where(sql`${t.status} in ('pendiente', 'en_vuelo')`),
    /**
     * La tarjeta «Quién responde» pregunta por el último entregado y el último
     * fallido. Con `updated_at` en el índice esa pregunta cuesta lo mismo con
     * cien filas que con un millón; sin él, cada refresco ordenaba todo el
     * histórico. (En Vocero Cloud es `dispatch_org_status_idx`, sin la tercera
     * columna: este es su superconjunto.)
     */
    index("dispatch_org_status_updated_idx").on(
      t.organizationId,
      t.status,
      t.updatedAt
    ),
    // La consulta del worker: pendientes cuya ventana ya venció.
    index("dispatch_status_notbefore_idx").on(t.status, t.notBefore),
    // Auditoría 073-B — El conteo anti-flood (`contarDespachos`): las últimas
    // 24 h de un negocio sin recorrer su histórico ni los descartados.
    index("dispatch_org_created_idx")
      .on(t.organizationId, t.createdAt)
      .where(sql`${t.status} <> 'descartado'`),
    // Auditoría 070 (M-3): ON DELETE SET NULL al borrar un cerebro, sin
    // recorrer toda la tabla.
    index("dispatch_brain_deployment_idx")
      .on(t.brainDeploymentId)
      .where(sql`${t.brainDeploymentId} is not null`),
  ]
);

/**
 * 070 — Respuestas de un cerebro ya aceptadas por `/api/brains/messages`.
 * Un turno puede mandar varios textos por despacho; un reintento del MISMO
 * texto devuelve el mensaje ya creado en vez de enviarlo dos veces.
 */
export const brainReply = pgTable(
  "brain_reply",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dispatchId: text("dispatch_id").notNull(),
    textHash: text("text_hash").notNull(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.dispatchId, t.textHash] }),
    // Auditoría 070 (M-3): ON DELETE CASCADE desde `message`, y la purga.
    index("brain_reply_message_idx").on(t.messageId),
    index("brain_reply_created_idx").on(t.createdAt),
  ]
);

/** 070 — Resultado de una operación de agenda v2 por `idempotencyKey`. */
export const brainOperation = pgTable(
  "brain_operation",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    action: text("action").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.idempotencyKey] }),
    index("brain_operation_created_idx").on(t.createdAt),
  ]
);

/* ============================================================
 * 047 — Eventos de webhook guardados antes de procesarse
 * ============================================================ */

/**
 * El cuerpo de cada entrega de Meta o Zernio, tal como llegó, guardado ANTES
 * de acusar recibo. Si procesarlo falla, el barrido lo reintenta con espera
 * creciente (`src/server/webhooks/`); si no se pudo ni guardar, la ruta
 * responde 503 y reintenta quien lo mandó.
 *
 * Trae datos del cliente: se borra a los 7 días de procesado y a los 30 de
 * agotado, y nunca sale a la API ni a los logs.
 */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id").primaryKey(),
    /** Resuelto al recibir, con las mismas credenciales que usa la ingesta. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Quién lo procesa: el adaptador del canal y la fuente. */
    fuente: text("fuente", {
      enum: ["whatsapp", "meta_instagram", "meta_messenger", "zernio"],
    }).notNull(),
    payload: jsonb("payload").notNull(),
    /** SHA-256 del cuerpo crudo: la misma entrega dos veces es una fila. */
    huella: text("huella").notNull(),
    status: text("status", {
      enum: ["pendiente", "en_proceso", "procesado", "agotado"],
    })
      .notNull()
      .default("pendiente"),
    /** Sube al reclamar: distingue a dos dueños de una misma reserva. */
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before").notNull().defaultNow(),
    leasedUntil: timestamp("leased_until"),
    /** El mensaje de la excepción, recortado. Nunca el cuerpo. */
    lastError: text("last_error"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_event_huella_uq").on(t.huella),
    // El barrido solo lee lo vivo: con el índice parcial, una tabla llena de
    // procesados no lo hace más lento.
    index("webhook_event_barrido_idx")
      .on(t.status, t.notBefore)
      .where(sql`${t.status} in ('pendiente', 'en_proceso')`),
    // Los conteos de Ajustes → WhatsApp.
    index("webhook_event_org_status_idx").on(t.organizationId, t.status),
  ]
);

/* ============================================================
 * 049 — Respuestas rápidas («/atajo» en el compositor)
 * ============================================================ */

/**
 * Textos que el equipo inserta con `/atajo` en vez de teclearlos otra vez
 * (horario, pago, envío…). Compartidas por la organización: las administra
 * quien configura y las usa cualquiera. No son plantillas de Meta: solo sirven
 * con la ventana abierta.
 */
export const quickReply = pgTable(
  "quick_reply",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Normalizado: minúsculas, sin acentos, `[a-z0-9_-]{1,32}`. */
    atajo: text("atajo").notNull(),
    /** Hasta 4 096 caracteres (el tope de WhatsApp). Admite `{nombre}`. */
    texto: text("texto").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quick_reply_org_atajo_uq").on(t.organizationId, t.atajo)]
);

/* ============================================================
 * 050 — Notas internas en el hilo
 * ============================================================ */

/**
 * Lo que el equipo se anota dentro de una conversación y el cliente nunca ve.
 *
 * Tabla propia A PROPÓSITO, no un tipo de `message`: el envío a Meta, el
 * despacho al cerebro, «sin responder», la ventana y las métricas leen
 * `message`, y así ninguno puede tocar una nota por descuido. Una prueba
 * vigila que esas rutas no la mencionen.
 */
export const conversationNote = pgTable(
  "conversation_note",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** Si se borra la cuenta, la nota queda («Alguien del equipo»). */
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    texto: text("texto").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversation_note_conv_idx").on(t.organizationId, t.conversationId, t.createdAt),
  ]
);

/* ============================================================
 * 072-B — Llamadas del cerebro a herramientas de módulo
 * ============================================================ */

/**
 * Idempotencia del puente (`POST /api/brains/tools/{name}`, D14): una
 * herramienta de `efecto: "escritura"` repetida con el mismo `dispatchId`,
 * nombre y argumentos devuelve la respuesta guardada sin volver a ejecutar.
 * `idempotency_key` = sha256(dispatchId · nombre · args canónicos). Las de
 * lectura no se anotan. Se purgan a los 30 días (`webhooks/worker.ts`).
 */
export const brainToolCall = pgTable(
  "brain_tool_call",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    dispatchId: text("dispatch_id").notNull(),
    tool: text("tool").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    estado: text("estado", { enum: ["en_curso", "hecha", "fallida"] }).notNull(),
    /** El cuerpo 200 que se devolvió (solo con `estado = 'hecha'`). */
    response: jsonb("response"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brain_tool_call_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("brain_tool_call_created_idx").on(t.createdAt),
    // M-1 (auditoría 072-B) — Para el `ON DELETE CASCADE` de la conversación.
    index("brain_tool_call_conv_idx").on(t.conversationId),
    check("brain_tool_call_estado_ck", sql`${t.estado} in ('en_curso', 'hecha', 'fallida')`),
    // B-3 — Una llamada `hecha` siempre tiene la respuesta que se repite.
    check("brain_tool_call_hecha_ck", sql`${t.estado} <> 'hecha' or ${t.response} is not null`),
  ]
);

/**
 * 073-A — Lo que le pasó al bot y nadie vio: un despacho que caducó porque el
 * cerebro no contestaba, una llave de IA sin saldo que frenó los despachos,
 * un envío que el canal rechazó para siempre.
 *
 * Una fila por (organización, `dedupeKey`): un incidente que se repite suma
 * `count` y mueve `lastAt` en vez de llenar la tabla (una llave sin saldo con
 * 500 mensajes entrantes es UNA fila por hora). Se purga a los 90 días.
 */
export const botIncident = pgTable(
  "bot_incident",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** La conversación afectada, si la hay (una llave sin saldo es de todo el negocio). */
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", {
      // 073-B — `abuso`: el tope anti-flood frenó el despacho.
      enum: ["despacho_caducado", "sin_saldo", "sin_credencial", "envio_permanente", "abuso"],
    }).notNull(),
    detail: text("detail"),
    count: integer("count").notNull().default(1),
    dedupeKey: text("dedupe_key").notNull(),
    firstAt: timestamp("first_at").notNull().defaultNow(),
    lastAt: timestamp("last_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bot_incident_dedupe_uq").on(t.organizationId, t.dedupeKey),
    index("bot_incident_last_idx").on(t.lastAt),
    index("bot_incident_conv_idx").on(t.conversationId),
    check(
      "bot_incident_kind_ck",
      sql`${t.kind} in ('despacho_caducado', 'sin_saldo', 'sin_credencial', 'envio_permanente', 'abuso')`
    ),
  ]
);
