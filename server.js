const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WIN_TARGET = 3;
const MATCH_TIMEOUT_MS = 30000;
const PRIVATE_ROOM_TIMEOUT_MS = 60000;

let waitingPool = [];          // socket IDs waiting for a match
const rooms = new Map();       // roomId -> room object
const socketRoomMap = new Map(); // socketId -> roomId
const matchTimers = new Map(); // socketId -> timeout handle

const privateRooms = new Map();      // code -> { hostSocketId, timer }
const socketPrivateRoom = new Map(); // socketId -> code (owned room)

// ── Utilities ────────────────────────────────────────────────────────────────

function resolveRound(a, b) {
  if (a === b) return 'draw';
  if (
    (a === 'rock'     && b === 'scissors') ||
    (a === 'scissors' && b === 'paper')    ||
    (a === 'paper'    && b === 'rock')
  ) return 'a';
  return 'b';
}

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  } while (privateRooms.has(code));
  return code;
}

// ── Random matchmaking ────────────────────────────────────────────────────────

function findOrCreateMatch(socket) {
  if (socketRoomMap.has(socket.id)) return;
  if (waitingPool.includes(socket.id)) return;

  while (waitingPool.length > 0) {
    const opponentId = waitingPool.shift();
    const opponentSocket = io.sockets.sockets.get(opponentId);
    if (opponentSocket?.connected) {
      createRoom(socket, opponentSocket);
      return;
    }
  }

  waitingPool.push(socket.id);

  const timer = setTimeout(() => {
    waitingPool = waitingPool.filter(id => id !== socket.id);
    matchTimers.delete(socket.id);
    if (socket.connected) socket.emit('match_timeout');
  }, MATCH_TIMEOUT_MS);
  matchTimers.set(socket.id, timer);
}

function cancelMatchTimer(socketId) {
  const timer = matchTimers.get(socketId);
  if (timer) {
    clearTimeout(timer);
    matchTimers.delete(socketId);
  }
}

// ── Private room ─────────────────────────────────────────────────────────────

function cancelPrivateRoom(socketId) {
  const code = socketPrivateRoom.get(socketId);
  if (!code) return;
  const pr = privateRooms.get(code);
  if (pr) {
    clearTimeout(pr.timer);
    privateRooms.delete(code);
  }
  socketPrivateRoom.delete(socketId);
}

// ── Room creation & leave ────────────────────────────────────────────────────

function createRoom(socketA, socketB) {
  cancelMatchTimer(socketA.id);
  cancelMatchTimer(socketB.id);
  cancelPrivateRoom(socketA.id);
  cancelPrivateRoom(socketB.id);

  const roomId = randomUUID();
  const room = {
    roomId,
    players: [socketA.id, socketB.id],
    scores: { [socketA.id]: 0, [socketB.id]: 0 },
    choices: { [socketA.id]: null, [socketB.id]: null },
  };

  rooms.set(roomId, room);
  socketRoomMap.set(socketA.id, roomId);
  socketRoomMap.set(socketB.id, roomId);

  socketA.emit('match_found');
  socketB.emit('match_found');
}

function leaveRoom(socket) {
  cancelMatchTimer(socket.id);
  cancelPrivateRoom(socket.id);
  waitingPool = waitingPool.filter(id => id !== socket.id);

  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;

  const room = rooms.get(roomId);
  socketRoomMap.delete(socket.id);
  if (!room) return;

  const opponentId = room.players.find(id => id !== socket.id);
  socketRoomMap.delete(opponentId);
  rooms.delete(roomId);

  const opponentSocket = io.sockets.sockets.get(opponentId);
  if (opponentSocket?.connected) {
    opponentSocket.emit('opponent_left');
  }
}

// ── Socket events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('find_match', () => findOrCreateMatch(socket));

  socket.on('rematch', () => {
    leaveRoom(socket);
    findOrCreateMatch(socket);
  });

  socket.on('create_private_room', () => {
    if (socketRoomMap.has(socket.id)) return; // already in a game
    cancelPrivateRoom(socket.id);             // cancel any previous owned room

    const code = generateRoomCode();

    const timer = setTimeout(() => {
      privateRooms.delete(code);
      socketPrivateRoom.delete(socket.id);
      if (socket.connected) socket.emit('private_room_expired');
    }, PRIVATE_ROOM_TIMEOUT_MS);

    privateRooms.set(code, { hostSocketId: socket.id, timer });
    socketPrivateRoom.set(socket.id, code);

    socket.emit('private_room_created', { code });
  });

  socket.on('join_private_room', ({ code }) => {
    if (typeof code !== 'string') return;
    const key = code.trim();
    const pr = privateRooms.get(key);

    if (!pr) {
      socket.emit('join_error', { message: '房间码无效或已过期' });
      return;
    }
    if (pr.hostSocketId === socket.id) {
      socket.emit('join_error', { message: '不能加入自己的房间' });
      return;
    }

    const hostSocket = io.sockets.sockets.get(pr.hostSocketId);
    if (!hostSocket?.connected) {
      clearTimeout(pr.timer);
      privateRooms.delete(key);
      socket.emit('join_error', { message: '房间码无效或已过期' });
      return;
    }

    clearTimeout(pr.timer);
    privateRooms.delete(key);
    socketPrivateRoom.delete(pr.hostSocketId);

    createRoom(socket, hostSocket);
  });

  socket.on('choose', (choice) => {
    if (!['rock', 'paper', 'scissors'].includes(choice)) return;

    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (room.choices[socket.id] !== null) return;

    room.choices[socket.id] = choice;
    socket.emit('choice_acknowledged');

    const [idA, idB] = room.players;
    if (room.choices[idA] === null || room.choices[idB] === null) return;

    const choiceA = room.choices[idA];
    const choiceB = room.choices[idB];
    const result = resolveRound(choiceA, choiceB);

    if (result === 'a') room.scores[idA]++;
    else if (result === 'b') room.scores[idB]++;

    const matchOver = room.scores[idA] >= WIN_TARGET || room.scores[idB] >= WIN_TARGET;

    function buildPayload(myId, myChoice, opChoice) {
      const opId = room.players.find(id => id !== myId);
      let roundWinner;
      if (result === 'draw') roundWinner = 'draw';
      else if ((result === 'a' && myId === idA) || (result === 'b' && myId === idB)) roundWinner = 'you';
      else roundWinner = 'opponent';

      return {
        yourChoice: myChoice,
        opponentChoice: opChoice,
        roundWinner,
        scores: { you: room.scores[myId], opponent: room.scores[opId] },
        matchOver,
        matchWinner: matchOver ? (room.scores[myId] >= WIN_TARGET ? 'you' : 'opponent') : null,
      };
    }

    const socketA = io.sockets.sockets.get(idA);
    const socketB = io.sockets.sockets.get(idB);

    if (socketA) socketA.emit('round_result', buildPayload(idA, choiceA, choiceB));
    if (socketB) socketB.emit('round_result', buildPayload(idB, choiceB, choiceA));

    if (matchOver) {
      socketRoomMap.delete(idA);
      socketRoomMap.delete(idB);
      rooms.delete(roomId);
    } else {
      room.choices[idA] = null;
      room.choices[idB] = null;
    }
  });

  socket.on('leave', () => leaveRoom(socket));

  socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Snap Duel running on http://localhost:${PORT}`);
});
