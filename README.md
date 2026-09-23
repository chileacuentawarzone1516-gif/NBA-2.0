# Hoopline

Juego de baloncesto 3D original para móvil y navegador: partidos **1 contra 1** y **3 contra 3** en media pista, práctica libre, tiro con medidor de timing, dribbling, defensa con robos y tapones, rebote, stamina, IA por capas con 4 dificultades y progresión de un jugador creado por el usuario.

> "Hoopline" es un título de trabajo. Todos los equipos, jugadores, logotipos, texturas y sonidos son originales y se generan proceduralmente; no se usa ningún contenido protegido.

## Requisitos

- Node.js ≥ 22.12
- Navegador con WebGL2 (Chrome, Edge, Firefox, Safari 15+)

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm install` | Instala dependencias |
| `npm run dev` | Servidor de desarrollo (http://localhost:5173) |
| `npm run build` | Typecheck + build de producción en `dist/` |
| `npm run preview` | Sirve el build de producción |
| `npm test` | Tests unitarios y de integración (Vitest, headless) |
| `npm run test:e2e` | Tests end-to-end (Playwright) contra el build de producción |
| `npm run balance` | Informe de balance: 24 partidos IA vs IA por modo (FG%, 3P%, robos, tapones…) |

Variables del informe de balance: `BALANCE_MATCHES`, `BALANCE_MODES=oneOnOne,threeOnThree`, `BALANCE_DIFFS=pro,legend`.

## Controles

| Acción | Táctil | Teclado | Mando |
| --- | --- | --- | --- |
| Moverse | Joystick flotante (mitad izquierda) | WASD / flechas | Stick izquierdo |
| Tiro (mantener y soltar en la zona verde) · Tapón/Salto | TIRO | Espacio / K | A |
| Finta | Toque rápido de TIRO | Toque rápido | Toque rápido |
| Pase · Pedir balón · Cambiar jugador (defensa) | PASE | J | X |
| Movimiento de dribbling (según dirección) · Robo | AMAGO / ROBO | L | B |
| Sprint | SPRINT | Shift | RB / RT |
| Pausa | Botón ⏸ | Esc / P | Start |
| Panel de depuración | Ajustes → depuración | ` | — |

Movimientos de dribbling según la dirección del stick respecto al jugador: neutro = hesitation, adelante = arrancada, atrás = stepback, lado de la mano libre = crossover, lado del balón = escape lateral, diagonal adelante = entre piernas, diagonal atrás = por detrás de la espalda.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md): decisiones técnicas, capas, simulación, IA, render, seguridad y preparación para red.
- [Estado](docs/STATUS.md): estado de cada sistema (IMPLEMENTED / PARTIAL / PLACEHOLDER / NOT IMPLEMENTED / BLOCKED) y métricas verificadas.

## Despliegue

Netlify: `netlify.toml` define build, cabeceras de seguridad (CSP estricta) y caché inmutable de assets con hash. El service worker (solo en producción) permite jugar offline tras la primera visita.
