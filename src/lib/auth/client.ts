"use client";

import { createAuthClient } from "better-auth/react";

// 074 — Sin `organizationClient()`: las rutas del plugin están cerradas y la
// app nunca las usó; el equipo se maneja por `/api/settings/team`.
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
