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

io.on('connection', (socket) => {
    // Attribution du rôle et stockage
    players[socket.id] = { 
        id: socket.id, 
        x: 0, y: 30, z: 0, ry: 0, 
        color: Math.random() * 0xffffff // Couleur aléatoire pour chaque joueur
    };

    // Envoi des Seeds et des joueurs actuels
    socket.emit('init', { 
    id: socket.id, 
    players, 
    seeds: worldSeeds,
    startTime: serverStartTime // <--- NOUVEAU
});
    
    io.emit('playerCount', Object.keys(players).length);
    socket.broadcast.emit('playerJoined', players[socket.id]);

    socket.on('playerState', (data) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...data };
            socket.broadcast.emit('enemyState', players[socket.id]);
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
