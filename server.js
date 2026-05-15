const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

function genCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

io.on("connection", (socket) => {

  // HOST creates a room
  socket.on("create_room", ({ name, maxPlayers, roundTime }) => {
    let code;
    do { code = genCode(); } while (rooms[code]);

    rooms[code] = {
      code,
      host: socket.id,
      maxPlayers,
      roundTime,
      players: [{ id: socket.id, name, idx: 0 }],
      banned: [],
      clicks: [],
      gameActive: false
    };

    socket.join(code);
    socket.emit("room_created", { code, playerIdx: 0, roundTime, maxPlayers });
    io.to(code).emit("lobby_update", rooms[code]);
  });

  // GUEST joins a room
  socket.on("join_room", ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit("join_error", "Room not found. Check the code and try again.");
    if (room.banned.includes(socket.id)) return socket.emit("join_error", "You have been banned from this room.");
    if (room.players.length >= room.maxPlayers) return socket.emit("join_error", "Room is full!");
    if (room.gameActive) return socket.emit("join_error", "Game already in progress.");

    const idx = room.players.length;
    room.players.push({ id: socket.id, name, idx });
    socket.join(code);
    socket.emit("room_joined", { code, playerIdx: idx, roundTime: room.roundTime, maxPlayers: room.maxPlayers });
    io.to(code).emit("lobby_update", room);
  });

  // HOST changes round time
  socket.on("set_round_time", ({ code, roundTime }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.roundTime = roundTime;
    io.to(code).emit("lobby_update", room);
  });

  // HOST kicks a player
  socket.on("kick_player", ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.players = room.players.filter(p => p.id !== targetId);
    room.players.forEach((p, i) => p.idx = i);
    io.to(targetId).emit("kicked");
    io.to(code).emit("lobby_update", room);
  });

  // HOST bans a player
  socket.on("ban_player", ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (!room.banned.includes(targetId)) room.banned.push(targetId);
    room.players = room.players.filter(p => p.id !== targetId);
    room.players.forEach((p, i) => p.idx = i);
    io.to(targetId).emit("banned");
    io.to(code).emit("lobby_update", room);
  });

  // HOST unbans
  socket.on("unban_player", ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.banned = room.banned.filter(id => id !== targetId);
    socket.emit("ban_list_update", room.banned);
  });

  // HOST starts game
  socket.on("start_game", ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.gameActive = true;
    room.clicks = new Array(room.players.length).fill(0);
    io.to(code).emit("game_start", { players: room.players, roundTime: room.roundTime });
  });

  // Player sends a click
  socket.on("player_click", ({ code, idx }) => {
    const room = rooms[code];
    if (!room || !room.gameActive) return;
    room.clicks[idx] = (room.clicks[idx] || 0) + 1;
    io.to(code).emit("click_update", { clicks: room.clicks });
  });

  // Game ended (any client can trigger after timer)
  socket.on("game_over", ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.gameActive = false;
    io.to(code).emit("show_results", { clicks: room.clicks });
  });

  // Play again
  socket.on("play_again", ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.gameActive = false;
    room.clicks = [];
    io.to(code).emit("back_to_lobby", room);
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const wasHost = room.host === socket.id;
      room.players = room.players.filter(p => p.id !== socket.id);
      room.players.forEach((p, i) => p.idx = i);
      if (wasHost || room.players.length === 0) {
        io.to(code).emit("room_closed", "The host left. Room has been closed.");
        delete rooms[code];
      } else {
        io.to(code).emit("lobby_update", room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CLICKY server running on port ${PORT}`));