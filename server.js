const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Survie Pro OK'); });

// Le serveur décide du monde une seule fois au démarrage
const serverStartTime = Date.now();
const worldSeeds = {
    x: Math.random() * 1000000,
    z: Math.random() * 1000000
};

const players = {};

// 🟢 NOUVEAU 1/3 : Le grand livre mémoire du monde
let destroyedObjects = []; 

io.on('connection', (socket) => {
    // Attribution du rôle et stockage
    players[socket.id] = { 
        id: socket.id, 
        x: 0, y: 30, z: 0, ry: 0, 
        color: Math.random() * 0xffffff // Couleur aléatoire pour chaque joueur
    };

    // Envoi des Seeds, du temps, et de la mémoire
    socket.emit('init', { 
        id: socket.id, 
        players, 
        seeds: worldSeeds,
        startTime: serverStartTime,
        destroyedObjects: destroyedObjects // 🟢 NOUVEAU 2/3 : On envoie la liste aux nouveaux
    });
    
    io.emit('playerCount', Object.keys(players).length);
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('playerState', (data) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...data };
            socket.broadcast.emit('enemyState', players[socket.id]);
        }
    });

    // 🟢 NOUVEAU 3/3 : Quand un joueur détruit un truc (Arbre, Rocher, Coffre)
    socket.on('objectDestroyed', (objectId) => {
        if (!destroyedObjects.includes(objectId)) {
            destroyedObjects.push(objectId); // Le serveur s'en souvient pour toujours
            socket.broadcast.emit('objectDestroyed', objectId); // Il prévient les autres joueurs en direct
        }
    });

    // Relais du Chat (identique au prototype)
    socket.on('chatMessage', (msg) => {
        socket.broadcast.emit('chatMessage', { text: msg, id: socket.id });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        io.emit('playerCount', Object.keys(players).length);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt`); });
