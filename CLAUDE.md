# Guía para agentes (Hoopline)

- Idioma de comunicación con el usuario: español. Código y comentarios: inglés.
- Antes de cerrar una tarea: `npm run build` (incluye typecheck), `npm test` y, si toca UI/flujo, `npm run test:e2e`.
- Cambios de balance: medir con `npm run balance` antes y después; no ajustar a ciegas.

## Reglas de arquitectura

- `src/sim/` es pura y determinista: sin DOM, sin Three.js, sin `Math.random` (usar `world.rng`). Todo cambio de dueño del balón pasa por `sim/systems/possession.ts`.
- La IA produce `PlayerInput` (igual que un humano); nunca muta el estado de la simulación.
- Números de gameplay en `src/data/` (tuning, arquetipos, movimientos…), no dispersos en sistemas.
- Texto de usuario al DOM solo con `textContent` (`ui/dom.ts`). Nada de `innerHTML`.
- Todo lo leído del almacenamiento pasa por `sanitizeSave`; si cambia el formato: subir `SAVE_VERSION` y añadir migración.
- Presentación (render/audio/UI) reacciona a `SimEvent`; no lee estado privado de sistemas.
