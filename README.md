# Colors y Clues

Versión casera en español inspirada en **Colors & Clues**, pensada para jugar con amigos en una única sala compartida.

## Qué es

Es un juego multijugador en tiempo real donde:

- una persona da pistas
- el resto intenta adivinar una casilla concreta de un tablero de colores
- se juega por rondas
- gana quien llegue antes a la puntuación máxima

La aplicación está hecha con:

- **Frontend**: HTML, CSS y JavaScript
- **Backend**: Node.js + Express + Socket.IO

## Características actuales

- sala única compartida
- entrada con mote
- lobby con jugadores conectados
- sistema de "listo"
- inicio automático cuando todos están listos
- tablero de colores con coordenadas
- turnos rotatorios
- selección de color secreto entre 4 opciones
- pista 1 de una palabra
- pista 2 de dos palabras
- validación de pistas prohibidas
- adivinanzas por casillas
- sistema de puntuación
- reconexión básica
- reinicio de partida por votación

## Cómo se juega

### Flujo de una ronda

1. Un jugador es el **clue giver**
2. Ese jugador recibe **4 colores posibles**
3. Elige **1 color secreto**
4. Escribe una **primera pista** de **1 palabra**
5. El resto marca su primera elección en el tablero
6. El clue giver escribe una **segunda pista** de **2 palabras**
7. El resto ajusta o confirma su elección final
8. Se calculan los puntos
9. Empieza la siguiente ronda con otro clue giver

### Puntuación

Para los jugadores que adivinan:

- **3 puntos** si aciertan exactamente la casilla
- **2 puntos** si quedan adyacentes
- **1 punto** si quedan a 2 bloques
- **0 puntos** si quedan más lejos

Para el clue giver:

- gana **1 punto por cada jugador** cuya elección final haya quedado dentro del área **3x3** centrada en la casilla objetivo

### Fin de la partida

La partida termina cuando alguien llega a:

- **25 puntos**

## Reglas de pistas

Actualmente las pistas están limitadas así:

- **Pista 1**: exactamente **1 palabra**
- **Pista 2**: exactamente **2 palabras**
