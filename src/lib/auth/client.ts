"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// 074 — Sin `organizationClient()`: las rutas del plugin están cerradas y la
// app nunca las usó; el equipo se maneja por `/api/settings/team`.
// 076 — `twoFactorClient` para el segundo paso del login (el código del
// superadmin). Sin `onTwoFactorRedirect`: el formulario lo maneja solo.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

export const { signIn, signOut, useSession } = authClient;
