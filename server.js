const express = require('express');
const app = express();
const http = require('http').createServer(app);

// Configuration Socket.IO avec CORS ciblé sur TON site web
const io = require('socket.io')(http, {
    cors: {
        origin: ["https://lordsofficial.com", "https://www.lordsofficial.com"], 
        methods: ["GET", "POST"]
    }
});

let playersCount = 0;

io.on('connection', (socket) => {
    playersCount++;
    
    // Attribue le rôle P1 (Aubergine) au premier, P2 (Tomate) au second
    let role = (playersCount % 2 !== 0) ? 'p1' : 'p2';
    console.log(`Joueur connecté : ${role}`);
    
    socket.emit('init', role);

    socket.on('playerState', (data) => {
        socket.broadcast.emit('enemyState', data);
    });

    socket.on('throwBoomerang', () => {
        socket.broadcast.emit('enemyThrow');
    });

    socket.on('playerDied', () => {
        socket.broadcast.emit('enemyDied');
    });

    socket.on('disconnect', () => {
        console.log('Un joueur a quitté.');
        playersCount--;
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
