# Memoria con Obsidian

Guía para montar una memoria larga para tus agentes con [Obsidian](https://obsidian.md): notas en Markdown, enlaces `[[...]]` y un índice. **No es una memoria vectorial**: se encuentra por nombre, enlaces y texto. La búsqueda semántica no está incluida.

## 1. Crear la bóveda
1. Instala Obsidian y crea una bóveda (por ejemplo `Documentos/Obsidian Vault`).
2. Copia el contenido de `ejemplos/obsidian/` a la raíz de la bóveda.
3. Renombra `Claude/MI_PROYECTO` con el nombre de tu carpeta de trabajo y actualiza el filtro de `Mapa de notas.base` (`file.inFolder("Claude/MI_PROYECTO")`).
4. Abre `Mapa de notas.base`: es una tabla con todas tus notas y las vistas Proyectos, Herramientas y Lecciones.

## 2. Estructura recomendada
```
Claude/MI_PROYECTO/
  00 Índice.md          ← lo primero que lee el asistente
  Proyectos.md          ← lista de proyectos
  Proyectos/            ← una nota por proyecto (usa la plantilla)
  Herramientas/         ← una nota por herramienta o script
  Decisiones.md · Seguridad.md · Pendientes e ideas.md
  <Tema> - lecciones y trampas.md
```
Cada nota lleva cabecera con `tags` y `actualizado`, y enlaza con `[[Nombre de la nota]]`.

## 3. Reglas para el asistente (ponlas en tu `CLAUDE.md`)
1. Escribir en español, con cabecera y enlaces.
2. **Nunca** guardar claves, tokens, contraseñas, el enlace del panel con `#t=` ni datos de clientes o pacientes.
3. Lo que tú editas a mano manda sobre lo que escribió el asistente.
4. Distinguir **[VERIFICADO]** (visto en el código) de **[SUPUESTO]**.
5. Los proyectos son de solo lectura salvo que pidas cambiarlos.

## 4. Conectarla con Claude Code
- Pide al asistente al inicio de sesión: "lee `00 Índice.md` de la bóveda antes de empezar".
- Claude Code guarda además su propia memoria en `~/.claude/projects/<proyecto>/memory/` (un `MEMORY.md` con un índice de una línea por archivo). Puedes poner ahí un puntero a la bóveda.
- El panel carga el `CLAUDE.md` de la carpeta de cada proyecto en el prompt de sistema, así que las reglas de arriba también se aplican a las órdenes del panel.

## 5. Otras herramientas
Si usas otro agente de voz o escritorio, dale una **bóveda aparte**. No le des la bóveda donde guardas notas de trabajo: esos programas pueden enviar texto y audio a servicios externos.
