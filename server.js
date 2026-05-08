const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur de Survie 3D OK'); });

const players = {};

io.on('connection', (socket) => {
    console.log(`Joueur connecté: ${socket.id}`);

    // Création du joueur avec position par défaut
    players[socket.id] = { id: socket.id, x: 0, y: 30, z: 0, ry: 0, isAttacking: false };
    
    // On envoie au nouveau joueur la liste des joueurs existants
    socket.emit('init', { id: socket.id, players });
    
    // On prévient les autres qu'un nouveau est là
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Réception des mouvements 3D
    socket.on('playerState', (data) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...data };
            socket.broadcast.emit('enemyState', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Déconnexion: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt sur le port ${PORT}`); });
