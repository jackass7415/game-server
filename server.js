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
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt`); });
