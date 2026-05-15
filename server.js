// ============================================================================
// Little Guy -- Serveur multijoueur (rooms jusqu'à 3 joueurs)
// ============================================================================
// Architecture room-based : chaque partie en ligne (Story ou Versus) se déroule
// dans une room identifiée par un code 6 chars. Le premier joueur d'une room
// est l'host (slot 1). Les suivants prennent les slots 2 et 3. Migration auto
// si l'host se déconnecte. Tous les events sont scopés à leur room.
//
// Events client -> serveur :
//   joinRoom { code, gameMode }   : rejoint/crée une room
//   leave                          : quitte la room sans fermer le socket
//   playerState { x, y, vx, ... }  : envoyé à 20Hz, broadcast aux autres
//   hit { targetSlot, dmg, ... }   : dégât cross-network (versus)
//   roundEvent { type, ... }       : événement match/manche (versus wins, etc.)
//   startGame { ... }              : host signale le début de partie
//
// Events serveur -> client :
//   init { id, slot, code, gameMode, isHost, seed, players }
//   playerList { players }
//   joined { id, slot }   /   left { id, slot }
//   playerState { id, slot, ... } (relay)
//   hit { fromSlot, ... } (relay)
//   roundEvent { fromSlot, ... } (relay)
//   startGame { ... } (broadcast)
//   hostAssigned   (migration)
//   roomFull       (code occupé par 3 joueurs)
// ============================================================================

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Little Guy multiplayer server -- OK'); });

const rooms = {};

function genRoomCode() {
    // Alphabet sans caractères ambigus : 0/O et 1/I exclus
    const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 6; i++) code += C[Math.floor(Math.random() * C.length)];
    } while (rooms[code]);
    return code;
}
function assignSlot(room) {
    const used = new Set(Object.values(room.players).map(p => p.slot));
    for (let s of [1, 2, 3]) if (!used.has(s)) return s;
    return 0; // pas de slot dispo
}

io.on('connection', (socket) => {
    console.log('[connect]', socket.id);

    // ========================================================================
    // joinRoom : rejoint ou crée une room
    // ========================================================================
    socket.on('joinRoom', ({ code, gameMode }) => {
        // Nettoie le code : majuscules, alphanumeric, 6 chars max
        let roomId = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (!roomId) roomId = genRoomCode();

        let room = rooms[roomId];
        if (!room) {
            // Création -> ce joueur devient host
            room = { players: {}, hostId: socket.id, gameMode: gameMode || 'story', seed: Math.floor(Math.random() * 1e9) };
            rooms[roomId] = room;
            console.log('[create-room]', roomId, 'mode=' + room.gameMode);
        }
        // Vérification capacité
        if (Object.keys(room.players).length >= 3) {
            socket.emit('roomFull', { code: roomId });
            return;
        }
        const slot = assignSlot(room);
        if (slot === 0) { socket.emit('roomFull', { code: roomId }); return; }

        room.players[socket.id] = { id: socket.id, slot, ready: false };
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.slot = slot;
        console.log('[join]', socket.id, '-> room', roomId, 'slot', slot, room.hostId === socket.id ? '(host)' : '');

        socket.emit('init', {
            id: socket.id, slot, code: roomId, gameMode: room.gameMode,
            isHost: socket.id === room.hostId, seed: room.seed,
            players: Object.values(room.players)
        });
        socket.to(roomId).emit('joined', { id: socket.id, slot });
        io.to(roomId).emit('playerList', { players: Object.values(room.players) });
    });

    // ========================================================================
    // leave : quitte la room sans fermer le socket
    // ========================================================================
    socket.on('leave', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const wasHost = (room.hostId === socket.id);
        delete room.players[socket.id];
        socket.leave(roomId);
        socket.to(roomId).emit('left', { id: socket.id, slot: socket.data.slot });
        socket.data.roomId = null;
        socket.data.slot = null;
        if (Object.keys(room.players).length === 0) {
            delete rooms[roomId];
            console.log('[delete-room]', roomId);
        } else if (wasHost) {
            room.hostId = Object.keys(room.players)[0];
            io.to(room.hostId).emit('hostAssigned');
            io.to(roomId).emit('playerList', { players: Object.values(room.players) });
            console.log('[host-migrate]', roomId, '->', room.hostId);
        } else {
            io.to(roomId).emit('playerList', { players: Object.values(room.players) });
        }
    });

    // ========================================================================
    // playerState : position + animation (~20Hz) -> relay aux autres
    // ========================================================================
    socket.on('playerState', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        socket.to(roomId).emit('playerState', { id: socket.id, slot: socket.data.slot, ...data });
    });

    // ========================================================================
    // hit : dégât cross-network (versus). Relay à la cible (autres clients).
    // Le client cible est autoritaire sur son propre HP.
    // ========================================================================
    socket.on('hit', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        socket.to(roomId).emit('hit', { fromSlot: socket.data.slot, ...data });
    });

    // ========================================================================
    // roundEvent : événement de manche/match (versus wins, restart, etc.)
    // Relayé à tous les membres de la room.
    // ========================================================================
    socket.on('roundEvent', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        io.to(roomId).emit('roundEvent', { fromSlot: socket.data.slot, ...data });
    });

    // ========================================================================
    // startGame : signal de l'host -> tous les clients lancent le mode
    // ========================================================================
    socket.on('startGame', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (socket.id !== rooms[roomId].hostId) return; // seul l'host peut lancer
        io.to(roomId).emit('startGame', data || {});
        console.log('[start-game]', roomId, 'by', socket.id);
    });

    // ========================================================================
    // Déconnexion : cleanup de la room
    // ========================================================================
    socket.on('disconnect', () => {
        console.log('[disconnect]', socket.id);
        const roomId = socket.data && socket.data.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const wasHost = (room.hostId === socket.id);
            delete room.players[socket.id];
            socket.to(roomId).emit('left', { id: socket.id, slot: socket.data.slot });
            if (Object.keys(room.players).length === 0) {
                delete rooms[roomId];
                console.log('[delete-room]', roomId);
            } else if (wasHost) {
                room.hostId = Object.keys(room.players)[0];
                io.to(room.hostId).emit('hostAssigned');
                io.to(roomId).emit('playerList', { players: Object.values(room.players) });
                console.log('[host-migrate]', roomId, '->', room.hostId);
            } else {
                io.to(roomId).emit('playerList', { players: Object.values(room.players) });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log('Little Guy server ready on :' + PORT); });
