const express = require('express');
const app = express();
const http = require('http').createServer(app);

// 1. LA ROUTE DE SANTÉ POUR RASSURER RENDER
app.get('/', (req, res) => {
    res.send('Le serveur de Boomerang Fu fonctionne parfaitement !');
});

// 2. CONFIGURATION SOCKET.IO AVEC CORS OUVERT
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // On accepte tout le monde pour être tranquille
        methods: ["GET", "POST"]
    }
});

let playersCount = 0;

io.on('connection', (socket) => {
    playersCount++;
    
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

// 3. ÉCOUTE SUR 0.0.0.0 (TRÈS IMPORTANT SUR RENDER)
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
