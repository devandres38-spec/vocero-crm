#!/usr/bin/env bash
# Arranque del Codespace de Aliantis. IDÉNTICO en vocero-crm y aliantis-brain: si cambias uno,
# cambia el otro. La lógica vive en el repo aliantis-espacio (scripts/preparar-espacio.sh);
# aquí solo se trae ese repo y se le pasa la fase.
#
#   bash .devcontainer/arranque.sh clonar     # onCreateCommand
#   bash .devcontainer/arranque.sh instalar   # postCreateCommand
#
# Guía: aliantis-espacio/docs/codespaces.md
set -euo pipefail

ESPACIO="/workspaces/agencia/CRMs/Vocero CRM + Nea Agent"

if [ ! -d "$ESPACIO/.git" ]; then
  mkdir -p "$(dirname "$ESPACIO")"
  git clone --quiet https://github.com/devandres38-spec/aliantis-espacio.git "$ESPACIO"
  # Para probar un cambio del entorno desde su rama: si aliantis-espacio tiene una rama con el
  # mismo nombre que la de este repo, se usa esa. Si no, main.
  rama="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  if [ "$rama" != "main" ] && git -C "$ESPACIO" ls-remote --exit-code --heads origin "$rama" >/dev/null; then
    git -C "$ESPACIO" checkout --quiet "$rama"
    echo "aliantis-espacio en la rama $rama"
  fi
fi

exec bash "$ESPACIO/scripts/preparar-espacio.sh" "${1:-instalar}"
