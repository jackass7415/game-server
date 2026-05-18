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
// Reassigne tous les slots selon l'ordre d'arrivée (joinTime).
// Le plus ancien joueur restant devient host (slot 1), les suivants P2 et P3.
// Appelé uniquement en lobby (avant `gameStarted = true`) pour garder une numérotation cohérente.
function reassignSlots(room) {
    const sorted = Object.values(room.players).sort((a, b) => a.joinTime - b.joinTime);
    sorted.forEach((p, i) => p.slot = i + 1);
    if (sorted.length > 0) room.hostId = sorted[0].id;
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
            // Création -> ce joueur devient host (slot 1 après reassign)
            room = { players: {}, hostId: socket.id, gameMode: gameMode || 'story', seed: Math.floor(Math.random() * 1e9), gameStarted: false };
            rooms[roomId] = room;
            console.log('[create-room]', roomId, 'mode=' + room.gameMode);
        }
        // Vérification capacité
        if (Object.keys(room.players).length >= 3) {
            socket.emit('roomFull', { code: roomId });
            return;
        }

        // Ajoute le joueur avec son joinTime (ordre d'arrivée)
        room.players[socket.id] = { id: socket.id, slot: 0, joinTime: Date.now(), ready: false };
        // En lobby : reassigne tous les slots par ordre d'arrivée -> host = slot 1, suivants = 2, 3
        if (!room.gameStarted) reassignSlots(room);
        else {
            // En jeu : pas de reassign (les autres joueurs ont déjà leurs slots fixés). On donne juste le premier libre.
            const used = new Set(Object.values(room.players).map(p => p.slot).filter(s => s > 0));
            for (let s of [1, 2, 3]) if (!used.has(s)) { room.players[socket.id].slot = s; break; }
        }

        const mySlot = room.players[socket.id].slot;
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.slot = mySlot;
        console.log('[join]', socket.id, '-> room', roomId, 'slot', mySlot, room.hostId === socket.id ? '(host)' : '');

        socket.emit('init', {
            id: socket.id, slot: mySlot, code: roomId, gameMode: room.gameMode,
            isHost: socket.id === room.hostId, seed: room.seed,
            players: Object.values(room.players)
        });
        socket.to(roomId).emit('joined', { id: socket.id, slot: mySlot });
        // Broadcast la liste mise à jour (avec potentiellement des slots réattribués)
        io.to(roomId).emit('playerList', { players: Object.values(room.players), hostId: room.hostId });
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
            return;
        }
        // En lobby : reassigne les slots (compacte 1/2/3 selon ordre d'arrivée)
        if (!room.gameStarted) {
            reassignSlots(room);
            io.to(roomId).emit('slotReassigned', { players: Object.values(room.players), hostId: room.hostId });
            if (wasHost) console.log('[host-migrate]', roomId, '->', room.hostId, '(lobby reassign)');
        } else if (wasHost) {
            // En jeu : on garde les slots mais on désigne un nouvel host
            const sorted = Object.values(room.players).sort((a, b) => a.joinTime - b.joinTime);
            room.hostId = sorted[0].id;
            io.to(room.hostId).emit('hostAssigned');
            io.to(roomId).emit('playerList', { players: Object.values(room.players), hostId: room.hostId });
            console.log('[host-migrate]', roomId, '->', room.hostId, '(in-game, slot conservé)');
        } else {
            io.to(roomId).emit('playerList', { players: Object.values(room.players), hostId: room.hostId });
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
    // worldSync : l'host broadcast l'état des entités (enemies, npcs, projectiles, etc.)
    // Relay direct aux autres membres de la room. Sécurité : seul l'host peut émettre.
    // ========================================================================
    socket.on('worldSync', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (socket.id !== rooms[roomId].hostId) return;
        socket.to(roomId).emit('worldSync', data);
    });

    // ========================================================================
    // entityHit : un client non-host signale qu'il a frappé une entité.
    // L'host reçoit et applique le dégât sur son entité (autoritaire).
    // ========================================================================
    socket.on('entityHit', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        io.to(rooms[roomId].hostId).emit('entityHit', { fromSlot: socket.data.slot, ...data });
    });

    // ========================================================================
    // particleBurst : explosion/effet visuel ponctuel important (mort boss, explosion).
    // Relay à tous les membres pour qu'ils voient l'effet en sync. Host-only.
    // ========================================================================
    socket.on('particleBurst', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (socket.id !== rooms[roomId].hostId) return;
        socket.to(roomId).emit('particleBurst', data);
    });

    // ========================================================================
    // chunkGen : l'host vient de générer un chunk Story. Relay aux non-hosts pour qu'ils
    // appliquent EXACTEMENT les mêmes entités (positions, types, hp). Sécurité : seul l'host.
    // ========================================================================
    socket.on('chunkGen', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (socket.id !== rooms[roomId].hostId) return;
        socket.to(roomId).emit('chunkGen', data);
    });

    // ========================================================================
    // chatMessage : message texte de chat. Broadcast à TOUS les membres de la room
    // (y compris l'expéditeur via io.to, mais le client filtre via fromSlot pour ne pas
    // afficher en double car il affiche "Moi: " localement à l'émission).
    // Sanitize : trim + cap 200 chars + skip si vide.
    // ========================================================================
    socket.on('chatMessage', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const raw = (data && typeof data.text === 'string') ? data.text : '';
        const text = raw.trim().slice(0, 200);
        if (!text) return;
        // Broadcast aux AUTRES membres (l'émetteur affiche déjà localement)
        socket.to(roomId).emit('chatMessage', { fromSlot: socket.data.slot, text });
    });

    // ========================================================================
    // startGame : signal de l'host -> tous les clients lancent le mode
    // ========================================================================
    socket.on('startGame', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (socket.id !== rooms[roomId].hostId) return; // seul l'host peut lancer
        // Marque la room comme "en jeu" pour figer les slots (pas de reassign si quelqu'un part en cours de partie)
        rooms[roomId].gameStarted = true;
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
                return;
            }
            // En lobby : reassigne (compacte les slots + nouveau host = plus ancien)
            if (!room.gameStarted) {
                reassignSlots(room);
                io.to(roomId).emit('slotReassigned', { players: Object.values(room.players), hostId: room.hostId });
                if (wasHost) console.log('[host-migrate]', roomId, '->', room.hostId, '(lobby reassign)');
            } else if (wasHost) {
                // En jeu : host quitte -> nouveau host = plus ancien restant, slot conservé
                const sorted = Object.values(room.players).sort((a, b) => a.joinTime - b.joinTime);
                room.hostId = sorted[0].id;
                io.to(room.hostId).emit('hostAssigned');
                io.to(roomId).emit('playerList', { players: Object.values(room.players), hostId: room.hostId });
                console.log('[host-migrate]', roomId, '->', room.hostId, '(in-game, slot conservé)');
            } else {
                io.to(roomId).emit('playerList', { players: Object.values(room.players), hostId: room.hostId });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log('Little Guy server ready on :' + PORT); });
