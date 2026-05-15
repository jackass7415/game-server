const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Survie Pro - MMO OK'); });

// Le serveur décide du monde une seule fois au démarrage
const serverStartTime = Date.now();
const worldSeeds = {
    x: Math.random() * 1000000,
    z: Math.random() * 1000000
};

const players = {};
let destroyedObjects = [];

// 👑 LE FAMEUX MAÎTRE DU JEU !
let hostId = null;

// ============================================================================
// === LITTLE GUY (celeste.html) -- système de rooms (jusqu'à 3 joueurs/room) ===
// ============================================================================
// Rooms keyed par code (6 chars). gameMode = 'story' | 'versus'. Slots 1/2/3.
// Le 1er joueur à rejoindre devient host (slot 1). Seed partagé pour la
// génération procédurale Story (chunks identiques côté tous les clients).
const lgRooms = {};
function lgGenRoomCode() {
    const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 6; i++) code += C[Math.floor(Math.random() * C.length)];
    } while (lgRooms[code]);
    return code;
}
function lgAssignSlot(room) {
    const used = new Set(Object.values(room.players).map(p => p.slot));
    for (let s of [1, 2, 3]) if (!used.has(s)) return s;
    return 0; // pas de slot dispo (room pleine)
}

io.on('connection', (socket) => {
    // Attribution du rôle et stockage
    players[socket.id] = { 
        id: socket.id, 
        x: 0, y: 30, z: 0, ry: 0, 
        color: Math.random() * 0xffffff 
    };

    // Si personne n'est le chef, le nouveau devient le chef
    if (!hostId) {
        hostId = socket.id;
        console.log(`Nouvel Hôte assigné: ${hostId}`);
    }

    // Envoi des Seeds et des infos vitales
    socket.emit('init', { 
        id: socket.id, 
        players, 
        seeds: worldSeeds,
        startTime: serverStartTime,
        destroyedObjects: destroyedObjects,
        isHost: (socket.id === hostId) // <-- C'EST ÇA QUI MANQUAIT !
    });
    
    io.emit('playerCount', Object.keys(players).length);
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('playerState', (data) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...data };
            socket.broadcast.emit('enemyState', players[socket.id]);
        }
    });

    socket.on('objectDestroyed', (objectId) => {
        if (!destroyedObjects.includes(objectId)) {
            destroyedObjects.push(objectId); 
            socket.broadcast.emit('objectDestroyed', objectId); 
        }
    });

    // 🟢 RELAIS DE L'IA (L'Hôte envoie la position des monstres aux autres)
    socket.on('syncEntities', (entitiesData) => {
        if (socket.id === hostId) {
            socket.broadcast.emit('syncEntities', entitiesData);
        }
    });

    // 🟢 FRAPPE D'UN MONSTRE (Le client demande à l'Hôte de faire les dégâts)
    socket.on('hitEntity', (data) => {
        io.to(hostId).emit('hitEntity', data);
    });

    // 🟢 CERTIFICAT DE DÉCÈS (L'Hôte prévient tout le monde de supprimer le monstre)
    socket.on('entityDied', (id) => {
        socket.broadcast.emit('entityDied', id);
    });

    socket.on('chatMessage', (msg) => {
        socket.broadcast.emit('chatMessage', { text: msg, id: socket.id });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];

        // 🟢 PASSATION DE POUVOIR : Si le chef quitte, on donne la couronne au suivant
        if (socket.id === hostId) {
            const remainingPlayers = Object.keys(players);
            if (remainingPlayers.length > 0) {
                hostId = remainingPlayers[0];
                io.to(hostId).emit('hostAssigned');
                console.log(`Changement d'Hôte: ${hostId}`);
            } else {
                hostId = null; // Plus personne sur le serveur
            }
        }

        io.emit('playerLeft', socket.id);
        io.emit('playerCount', Object.keys(players).length);

        // === LITTLE GUY : nettoyage de la room ===
        const lgRoomId = socket.data && socket.data.lgRoom;
        if (lgRoomId && lgRooms[lgRoomId]) {
            const room = lgRooms[lgRoomId];
            const wasHost = (room.hostId === socket.id);
            delete room.players[socket.id];
            socket.to(lgRoomId).emit('lg_left', { id: socket.id, slot: socket.data.lgSlot });
            if (Object.keys(room.players).length === 0) {
                delete lgRooms[lgRoomId];
            } else if (wasHost) {
                room.hostId = Object.keys(room.players)[0];
                io.to(room.hostId).emit('lg_hostAssigned');
            }
        }
    });

    // ========================================================================
    // === LITTLE GUY : événements de room ====================================
    // ========================================================================
    // joinRoom : code = string (peut être null/empty -> on en génère un nouveau)
    // gameMode : 'story' ou 'versus'
    socket.on('lg_joinRoom', ({ code, gameMode }) => {
        // Code propre : majuscules, 6 chars max
        let roomId = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (!roomId) roomId = lgGenRoomCode();

        let room = lgRooms[roomId];
        if (!room) {
            // Création d'une nouvelle room (ce joueur devient host)
            room = { players: {}, hostId: socket.id, gameMode: gameMode || 'story', seed: Math.floor(Math.random() * 1e9) };
            lgRooms[roomId] = room;
        }
        // Vérification room pleine (max 3 joueurs)
        if (Object.keys(room.players).length >= 3) {
            socket.emit('lg_roomFull', { code: roomId });
            return;
        }
        // Si la room existe déjà, le mode est imposé par l'host
        const slot = lgAssignSlot(room);
        if (slot === 0) { socket.emit('lg_roomFull', { code: roomId }); return; }

        room.players[socket.id] = { id: socket.id, slot, ready: false };
        socket.join(roomId);
        socket.data.lgRoom = roomId;
        socket.data.lgSlot = slot;

        // Envoi info init au joueur
        socket.emit('lg_init', {
            id: socket.id, slot, code: roomId, gameMode: room.gameMode,
            isHost: socket.id === room.hostId, seed: room.seed,
            players: Object.values(room.players)
        });
        // Notifie les autres dans la room
        socket.to(roomId).emit('lg_joined', { id: socket.id, slot });
        // Notifie aussi le nouveau venu de tous les autres (déjà via 'players' dans init)
        // → Mais les autres ont besoin de la liste à jour aussi
        io.to(roomId).emit('lg_playerList', { players: Object.values(room.players) });
    });

    // Quitter la room (retour menu, etc.) sans fermer le socket
    socket.on('lg_leave', () => {
        const roomId = socket.data.lgRoom;
        if (!roomId || !lgRooms[roomId]) return;
        const room = lgRooms[roomId];
        const wasHost = (room.hostId === socket.id);
        delete room.players[socket.id];
        socket.leave(roomId);
        socket.to(roomId).emit('lg_left', { id: socket.id, slot: socket.data.lgSlot });
        socket.data.lgRoom = null;
        socket.data.lgSlot = null;
        if (Object.keys(room.players).length === 0) {
            delete lgRooms[roomId];
        } else if (wasHost) {
            room.hostId = Object.keys(room.players)[0];
            io.to(room.hostId).emit('lg_hostAssigned');
            io.to(roomId).emit('lg_playerList', { players: Object.values(room.players) });
        } else {
            io.to(roomId).emit('lg_playerList', { players: Object.values(room.players) });
        }
    });

    // État joueur (position, animation, HP) -- broadcast aux autres de la room
    socket.on('lg_playerState', (data) => {
        const roomId = socket.data.lgRoom;
        if (!roomId) return;
        socket.to(roomId).emit('lg_playerState', { id: socket.id, slot: socket.data.lgSlot, ...data });
    });

    // Hit cross-réseau (attaquant -> serveur -> cible). Cible applique les dégâts.
    socket.on('lg_hit', (data) => {
        const roomId = socket.data.lgRoom;
        if (!roomId) return;
        socket.to(roomId).emit('lg_hit', { fromSlot: socket.data.lgSlot, ...data });
    });

    // Événement de manche/match (versus) -- broadcast tous les autres.
    socket.on('lg_roundEvent', (data) => {
        const roomId = socket.data.lgRoom;
        if (!roomId) return;
        io.to(roomId).emit('lg_roundEvent', { fromSlot: socket.data.lgSlot, ...data });
    });

    // Signal "start game" envoyé par l'host quand la room est prête.
    socket.on('lg_startGame', (data) => {
        const roomId = socket.data.lgRoom;
        if (!roomId || !lgRooms[roomId]) return;
        if (socket.id !== lgRooms[roomId].hostId) return; // seul l'host peut lancer
        io.to(roomId).emit('lg_startGame', data || {});
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt`); });
