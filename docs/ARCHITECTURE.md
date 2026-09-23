# Arquitectura de Hoopline

## Decisión de stack

| Opción | Evaluación en este entorno | Decisión |
| --- | --- | --- |
| Godot 4 | Binario bloqueado (GitHub releases → 403). Sin forma de ejecutar/testear. | Descartado |
| Unity | No disponible en contenedor Linux sin licencia/editor. | Descartado |
| **TypeScript + Three.js + Vite** | Node 22, Chromium y Playwright disponibles: se puede ejecutar, testear y capturar pantalla. La simulación en TS puro corre igual en navegador, tests y un futuro servidor Node. | **Elegido** |

Distribución móvil: PWA instalable (hoy) y empaquetado nativo Android/iOS con Capacitor (siguiente paso, ver `STATUS.md`).

## Capas

```
src/
  core/        Utilidades sin dependencias: math (sin asignaciones), RNG determinista,
               eventos tipados, logger, bucle de paso fijo.
  data/        Todo lo configurable: tuning, cancha, atributos, arquetipos, habilidades,
               jugadores/equipos ficticios, modos, dificultad, calidad, controles, i18n.
  sim/         SIMULACIÓN PURA (sin DOM ni Three.js). Determinista a 60 Hz.
    systems/   movimiento, posesión, física del balón, tiro, pase, dribbling, defensa,
               rebote, stamina, reglas, acciones, actualización del balón.
  ai/          IA por capas: TeamBrain (táctica) → PlayerBrain (decisión + steering)
               → PlayerInput (mismo formato que un humano). AIDirector orquesta.
  game/        matchFactory: construye sim + IA + buffers (lo usan cliente y tests).
  input/       Fuentes (táctil, teclado, gamepad) → InputFrame → PlayerInput relativo a cámara.
  render/      Three.js: Renderer, arena, jugadores (skinning rígido), balón, cámara, VFX.
  audio/       WebAudio procedural (sin assets): SFX + ambiente de público.
  ui/          DOM accesible: componentes, pantallas, HUD, estilos.
  save/        Persistencia versionada con migraciones y saneado.
  progression/ Reglas de XP/niveles/mejoras/habilidades como funciones puras.
  debug/       Overlay de depuración (chunk lazy, nunca requerido por el juego).
  app/         App (flujo de pantallas) y GameSession (un partido en el cliente).
```

Reglas de dependencia:

- `sim/` solo importa `core/` y `data/`. **Nunca** DOM, Three.js ni `Math.random`.
- `ai/` lee la simulación y produce `PlayerInput`; no muta el estado.
- `render/`, `ui/`, `audio/` leen el estado y consumen `SimEvent`; no lo mutan.
- `app/` es el único que conecta todo.

## Simulación

- Paso fijo `SIM_DT = 1/60`. El bucle (`core/loop.ts`) acumula tiempo, limita a 5 pasos por frame (evita la espiral de la muerte) e interpola el render con `alpha`.
- Todo azar pasa por `Rng` (mulberry32 serializable). Misma semilla + mismos inputs ⇒ mismo partido (test de determinismo).
- Orden por tick: prevPos → stance → `processInput` → `updateActions` → movimiento → contactos/límites → stamina → balón → reglas.
- **Posesión: fuente única de verdad** en `systems/possession.ts` (`giveBall`, `makeLoose`, `makeDead`, `setOffense`). Ningún otro sistema cambia de dueño el balón.
- **Tiro explicable**: `computeShotChance` devuelve un desglose (base, distancia, timing, contest, fatiga, movimiento, tipo). La tirada decide el resultado *previsto*; `planShot` busca (con la misma física) un lanzamiento que produzca exactamente ese resultado. El enceste lo decide siempre la física (cruce del plano del aro). Test: 0 discrepancias en partidos reales.
- Física del balón exacta para gravedad constante, aro como toro, tablero como caja, suelo con restitución; subpasos por velocidad para evitar túneles.
- Eventos (`SimEvent`) por tick alimentan estadísticas, audio, VFX y HUD sin acoplamiento.

## IA

1. **TeamBrain**: asignaciones hombre a hombre (búsqueda exhaustiva de coste mínimo, ≤5 jugadores), ayuda defensiva cuando el atacante supera a su defensor cerca del aro, puntos de espaciado.
2. **PlayerBrain**: decisiones discretas en ticks de decisión (frecuencia según dificultad) y steering continuo. Utilidad: EV del tiro con **anticipación del closeout**, pases (visión limitada por dificultad), penetración (tráfico en carril), movimientos de dribbling, finta.
3. Defensa con **percepción retardada** (el defensor sigue una posición suavizada con su tiempo de reacción): los cambios de ritmo del atacante funcionan de verdad; no hay "imán".
4. La dificultad cambia decisiones y ejecución (reacción, varianza del timing de tiro, selectividad, disciplina en contest, visión), **nunca** los atributos.

## Render y rendimiento

- Jugadores: rig procedural de huesos → **un SkinnedMesh rígido por jugador** (un draw call por material). 246 → 85 draw calls en 3v3.
- Geometría estática del pabellón fusionada; público con `InstancedMesh` animado en vertex shader.
- Presets LOW/MEDIUM/HIGH/ULTRA cambian parámetros reales: pixel ratio, antialias (recrea contexto), sombras y tamaño de mapa, PBR vs Lambert, resolución de la textura de cancha, público, partículas, luces extra, anisotropía, tope de FPS.
- Resolución dinámica: EMA del frame time; baja/sube la escala de render (0.6–1.0).
- Sin asignaciones en bucles calientes de la simulación; VFX con pools y presupuesto fijo.
- Bundle: juego ~60 KB gzip + Three.js ~137 KB gzip; overlay de debug en chunk aparte.

## Red (preparación, no implementada)

La arquitectura ya separa lo necesario para un servidor autoritativo:

- `Simulation` corre en Node sin cambios; los clientes enviarían `PlayerInput` (cuantizable con `quantizeInput`).
- El servidor ejecutaría la simulación y enviaría snapshots; el cliente interpolaría (ya existe interpolación prev/actual) y predeciría su propio jugador.
- La progresión (`progression/`) es pura para que el servidor recalcule XP desde eventos: **el cliente nunca es fuente de verdad** para XP, estadísticas competitivas ni resultados.
- Determinismo entre plataformas: `Math.sin/cos/atan2` pueden diferir entre motores JS; por eso el modelo recomendado es servidor autoritativo con snapshots, no lockstep.

## Seguridad

- Todo texto de usuario entra al DOM vía `textContent` (`ui/dom.ts`); nombres saneados.
- Guardado: `sanitizeSave` valida tipos, rangos, enums y listas; los datos manipulados se degradan a valores seguros (test incluido).
- CSP estricta en `netlify.toml` (`default-src 'self'`, sin `unsafe-inline` ni orígenes externos), más `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`.
