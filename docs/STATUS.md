# Estado del proyecto

Leyenda: **IMPLEMENTED** (integrado, ejecutado y verificado) · **PARTIAL** · **PLACEHOLDER** · **NOT IMPLEMENTED** · **BLOCKED**

## Núcleo y jugabilidad

| Sistema | Estado | Verificación / notas |
| --- | --- | --- |
| Bucle de paso fijo + interpolación | IMPLEMENTED | 60 Hz, tope 5 pasos/frame, tope 30 FPS en LOW |
| Simulación determinista | IMPLEMENTED | Test: misma semilla ⇒ mismo resultado |
| Movimiento (aceleración, sprint, stance, giros, contactos) | IMPLEMENTED | Contacto por fuerza/complexión; defensor "plantado" gana masa |
| Posesión (fuente única) | IMPLEMENTED | held / shot / pass / loose / dead |
| Física del balón (aro, tablero, suelo, red) | IMPLEMENTED | Tests de rebote y trayectoria |
| Tiro: timing, contest, fatiga, distancia, tipos (8) | IMPLEMENTED | Desglose explicable; 0 discrepancias física/modelo |
| Finta de tiro | IMPLEMENTED | Toque < 0,14 s |
| Bandejas y mates contextuales | IMPLEMENTED | Mates ~85–89 % de acierto en IA vs IA |
| Pase (dirigido por stick, pase adelantado, bote, bombeado, intercepción) | IMPLEMENTED | |
| Dribbling data-driven (7 movimientos, cambio de mano, desequilibrio) | IMPLEMENTED | Añadir movimientos = añadir datos |
| Defensa: robo, tapón, contest, ayudas, recuperación, box-out | IMPLEMENTED | |
| Rebote ponderado (posición, salto, box-out, atributos) | IMPLEMENTED | OREB% ~17 % (1v1) / ~30 % (3v3) |
| Stamina con histéresis de agotamiento | IMPLEMENTED | Test unitario |
| Reglas medio campo (check, clear, reloj de posesión, bocina, muerte súbita) | IMPLEMENTED | |
| Faltas y tiros libres | NOT IMPLEMENTED | Siguiente iteración de reglas |
| Bloqueos (pick & roll) | NOT IMPLEMENTED | TeamBrain preparado para jugadas |
| Juego al poste específico | PARTIAL | Existe tiro cercano/fade con postScoring; faltan movimientos de poste |
| Alley-oop | NOT IMPLEMENTED | Pase bombeado existe |

## IA

| Sistema | Estado | Notas |
| --- | --- | --- |
| Asignaciones, ayudas, espaciado, cortes | IMPLEMENTED | |
| Selección de tiro con anticipación de closeout | IMPLEMENTED | FG ~40–46 %, 3P ~36–38 % (herramienta `npm run balance`) |
| Dificultad por decisiones/ejecución | IMPLEMENTED | 4 perfiles |
| Compañeros IA con humano | IMPLEMENTED | 3v3 |

## Modos y progresión

| Sistema | Estado | Notas |
| --- | --- | --- |
| Práctica | IMPLEMENTED | Devolución automática del balón |
| 1v1 | IMPLEMENTED | E2E completo hasta resultados |
| 3v3 | IMPLEMENTED | |
| 5v5 (pista completa) | NOT IMPLEMENTED | Sim preparada (formación de 5, hoops por dirección); faltan reglas de pista completa y transición |
| Carrera | PARTIAL | "Mi jugador": XP, niveles, mejoras con topes por arquetipo, habilidades, estadísticas de carrera. Falta calendario/temporada |
| Desafíos | NOT IMPLEMENTED | |
| Plantillas y sustituciones | PARTIAL | Rosters de 5 por equipo; sustituciones en partido no implementadas |

## Presentación

| Sistema | Estado | Notas |
| --- | --- | --- |
| Arena, cancha, aros, público | IMPLEMENTED | Arte procedural original |
| Jugadores | PLACEHOLDER | Rig procedural rígido (funcional, animado). Interfaz `AnimState` lista para sustituir por modelos skinned GLTF + clips |
| Animación por estados | IMPLEMENTED | 14 estados con mezcla de poses e IK de piernas |
| Cámara broadcast | IMPLEMENTED | Suavizado, shake, ajustes de altura/distancia |
| VFX con pools y calidad | IMPLEMENTED | |
| Audio procedural | IMPLEMENTED | Sin música todavía (NOT IMPLEMENTED) |
| UI/menús/HUD/resultados | IMPLEMENTED | Accesible, responsive, es/en |
| Controles táctiles | IMPLEMENTED | Joystick flotante, botones contextuales, háptica, ajustes |
| Calibración de latencia del timing de tiro | NOT IMPLEMENTED | Recomendado para móviles con latencia táctil alta |

## Plataforma

| Sistema | Estado | Notas |
| --- | --- | --- |
| Presets de calidad reales + resolución dinámica | IMPLEMENTED | |
| Guardado versionado con migraciones y backup | IMPLEMENTED | Tests |
| PWA (manifest, service worker, iconos) | IMPLEMENTED | SW solo en producción |
| Despliegue Netlify con CSP y caché | IMPLEMENTED | `netlify.toml` |
| Build Android (Capacitor) | IMPLEMENTED | APK de depuración compilado y verificado (targetSdk 36, horizontal, inmersivo, iconos/splash propios, 5 MB). Firma de release: pendiente de keystore del propietario |
| Build iOS | BLOCKED | Requiere macOS + Xcode (no disponible en este entorno); Capacitor ya está configurado |
| CI (GitHub Actions) | IMPLEMENTED | Tests, build, E2E y APK como artefacto |
| Multijugador online | NOT IMPLEMENTED | Arquitectura preparada (ver ARCHITECTURE.md) |
| Dominio canónico / sitemap | BLOCKED | Requiere el dominio de producción definitivo |

## Dependencias con avisos conocidos

- `npm audit`: 3 avisos moderados en `uuid` vía `xcode`, dependencia **solo de desarrollo** de `@capacitor/cli` (manipulación de proyectos iOS). No forma parte del bundle del juego. Revisar al actualizar Capacitor.

## Métricas verificadas

- Tests: 29 unitarios/integración + 7 E2E (Playwright, build de producción, viewport Android horizontal, sin errores ni warnings de consola).
- Coste de simulación + IA: ~0,01 ms por tick (3v3).
- Draw calls 3v3: 85 (desde 246 antes del skinning rígido).
- Bundle: ~60 KB gzip de juego + ~137 KB gzip de Three.js.
