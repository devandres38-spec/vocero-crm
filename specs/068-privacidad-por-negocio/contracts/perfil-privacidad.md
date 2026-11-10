# Contrato: el perfil de privacidad exportado (formato 1)

Lo escribe el cerebro (`npm run privacidad:exportar -- <cliente.yaml>`) y lo lee Vocero (`pnpm privacidad:sembrar`). Los dos lo validan con el mismo esquema, estricto: una clave de más se rechaza.

```json
{
  "formato": 1,
  "perfil": "odontologia",
  "versionPerfil": 1,
  "pais": "CO",
  "sensible": {
    "urgencia": ["sangr*", "…"],
    "sintoma": ["duele", "dolor*", "…"],
    "condicion": ["…"],
    "medicamento": ["…"]
  },
  "permitidos": ["Limpieza dental", "limpieza", "Férula para bruxismo", "…"],
  "huella": "3f2a…(64 caracteres hex)"
}
```

| Campo | Regla |
| --- | --- |
| `formato` | Exactamente `1`. Un formato nuevo es un cambio de este contrato, en los dos repos |
| `perfil` | `^[a-z0-9]+(-[a-z0-9]+)*$` (la misma regla de `PROFILE_ID` del cerebro) |
| `versionPerfil` | Entero positivo |
| `pais` | Un `CountryCode` que `libphonenumber-js` reconoce |
| `sensible` | `null` (salud apagada) o un objeto con **exactamente** las cuatro categorías; cada término cumple `isNormalizedTerm` (minúsculas, sin tildes, `*` solo al final de una palabra) |
| `permitidos` | Lista de textos no vacíos, tal como los escribió el negocio (con tildes y mayúsculas: el filtro los normaliza al comparar) |
| `huella` | SHA-256 hex de `canonicalJson({ pais, permitidos, sensible })` |

**`canonicalJson`:** el JSON con las claves de cada objeto ordenadas alfabéticamente, sin espacios; las listas conservan su orden. Es la función que ya usa el cerebro en `src/config/client-config.ts`; Vocero la copia y la prueba gemela compara las huellas.

**Lo que decide el filtro** es solo `pais`, `permitidos` y `sensible`: por eso la huella cubre esos tres. `perfil` y `versionPerfil` sirven para saber de dónde salió.

**Contenido:** no lleva datos de pacientes ni secretos. Aun así, el de un cliente real no se guarda en ningún repo (P2 de la spec): se exporta, se registra y se borra.
