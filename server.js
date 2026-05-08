const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Boomerang OK'); });

let playersCount = 0;

io.on('connection', (socket) => {
    playersCount++;
    let role = (playersCount % 2 !== 0) ? 'p1' : 'p2';
    socket.emit('init', role);

    socket.on('playerState', (data) => { socket.broadcast.emit('enemyState', data); });
    socket.on('throwBoomerang', () => { socket.broadcast.emit('enemyThrow'); });
    socket.on('playerDied', (data) => { socket.broadcast.emit('enemyDied', data); });

    // --- NOUVEAU : RELAIS DU CHAT ---
    socket.on('chatMessage', (msg) => {
        socket.broadcast.emit('chatMessage', msg);
    });

    socket.on('disconnect', () => { playersCount--; });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Port ${PORT}`); });
