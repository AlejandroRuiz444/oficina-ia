# Sala de Seguridad (ejemplo)

Una sala del panel con subagentes especializados. Los 3 agentes de `agentes/` son genéricos y están escritos para este repo.

1. Crea una carpeta (p. ej. `Seguridad`) y copia ahí `CLAUDE.md`.
2. Copia `agentes/` a `~/.claude-code-office/room-agents/seguridad/` (en Windows: `C:\Users\TU_USUARIO\.claude-code-office\room-agents\seguridad`).
3. Copia `rooms.json.example` a `~/.claude-code-office/rooms.json` y pon la ruta real de tu carpeta, en minúsculas y con `\` dobles.
4. Para fijarla como sala siempre despierta, usa el interruptor "Sala activa" del panel.
5. Reinicia el panel. El chat dirá "agentes de la sala cargados: 3".

Para añadir más agentes, suelta más archivos `.md` en esa carpeta. Solo se usan `name`, `description` y `tools`; el resto se ignora. Las lecturas fuera de la carpeta de la sala piden aprobación.

## Agentes de wshobson/agents
`agentes-wshobson/` trae 14 agentes de seguridad copiados de https://github.com/wshobson/agents (licencia MIT, © 2024 Seth Hobson; ver `THIRD_PARTY/wshobson-agents-LICENSE.txt`), con permiso de su autor. Es una copia fija; el original puede haber cambiado. Cópialos a `room-agents/seguridad/` junto a los tuyos si los quieres.

## Plugins
`../plugins/settings.json` es la configuración de proyecto que declara el marketplace `wshobson/agents` y qué plugins están activos. No copia su código: se descarga del repositorio original al abrir el proyecto en Claude Code.
