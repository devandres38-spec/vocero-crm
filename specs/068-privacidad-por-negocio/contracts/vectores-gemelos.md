# Contrato: los vectores gemelos del filtro (formato 1)

Los genera el cerebro (`npm run privacidad:vectores` → `test/fixtures/privacidad-vectores.json`) con **su** implementación, que es la de referencia. El mismo archivo, byte a byte, se copia a Vocero (`tests/unit/fixtures/privacidad-vectores.json`). Las dos pruebas gemelas fijan su SHA-256.

```json
{
  "formato": 1,
  "libphonenumber": "1.13.15",
  "perfiles": {
    "dental-co": { "formato": 1, "perfil": "odontologia", "versionPerfil": 1, "pais": "CO", "sensible": { "…": [] }, "permitidos": [], "huella": "…" }
  },
  "casos": [
    {
      "perfil": "dental-co",
      "texto": "me duele la muela",
      "esperado": {
        "text": "[mensaje con información de salud omitido]",
        "health": { "categories": ["sintoma"], "urgent": false },
        "masked": [],
        "flags": ["salud", "sintoma"]
      }
    },
    {
      "perfil": null,
      "texto": "hola",
      "boton": null,
      "esperado": { "text": "[mensaje omitido: no se pudo revisar]", "health": null, "masked": [], "unreviewed": true, "flags": ["sin_revisar"] }
    }
  ]
}
```

- `perfil: null` prueba `withoutReview(texto, boton)`: sin perfil, un texto se omite y un botón (`boton` con su id) se conserva.
- `esperado` es `PrivacyResult` más `flags` (`privacyFlagsOf`). Una clave ausente y una con `undefined` no son lo mismo: `unreviewed` solo aparece cuando es `true`.

## Perfiles

| Clave | De dónde sale | Para qué |
| --- | --- | --- |
| `dental-co` | `clientes/demo` (odontología, CO) | Las tres listas de salud y frases permitidas de servicios |
| `generico-co` | `clientes/demo-academia` | Solo `salud-general` |
| `sin-salud-us` | `clientes/demo-barberia` (`sensible: null`, US) | Salud apagada; teléfonos de otro país |
| `dental-ferula-co` | `dental-co` + «Férula para bruxismo» y «férula» en `permitidos` | Una frase permitida que contiene un término de salud: ninguna frase de servicio de la demo dental contiene uno (agregado en la implementación, 10-nov-2026) |
| `dental-mx` | `dental-co` con `pais: "MX"` | Teléfonos mexicanos (la huella cambia) |

## Casos

1. **El corpus del cerebro completo** (`privacy-corpus.test.ts`, con y sin salud), con `dental-co`.
2. **Los casos de `privacy-filter.test.ts`** del cerebro, con su perfil.
3. **Bordes del texto:** tildes y mayúsculas, letras repetidas («dueleee»), letras decoradas (negrita matemática, ancho completo), caracteres invisibles dentro de una palabra (espacio de ancho cero, guion suave), emojis, frase permitida que contiene un término («férula para bruxismo») y la misma palabra fuera de ella.
4. **Bordes de datos personales:** correo; tarjeta con espacios, guiones y fecha pegada («4111 1111 1111 1111 12/27»); cédula con y sin aviso, con puntos de miles; precios que no son documento («1.200.000 pesos», «$350.000»); teléfonos de Colombia, México y Estados Unidos, con y sin prefijo, con cada perfil de país.
5. **Sin perfil:** texto (se omite) y botón (se conserva).
6. **Salud apagada:** un mensaje de salud con `sin-salud-us` pasa, pero su correo y su teléfono se enmascaran.

**Implementado (10-nov-2026):** 293 casos y 5 perfiles. Huella del archivo (saltos LF): `6243a5db34e0101b2930b15e6caad657da18ac5dcc5778ce099f56ecb09f4127`. Fija también las fugas conocidas del filtro de hoy (pasaporte con letras, teléfonos de otro país escritos con espacios), que se arreglan en un PR aparte antes del paso 3.2.

Cuando un caso real se escape en el piloto, se agrega al corpus del cerebro, se regeneran los vectores y se copian a Vocero.
