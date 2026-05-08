const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Boomerang OK'); });

let playersCount = 0;
let scores = { p1: 0, p2: 0 }; // Initialisation des scores

io.on('connection', (socket) => {
    playersCount++;
    let role = (playersCount % 2 !== 0) ? 'p1' : 'p2';
    socket.emit('init', { role, scores }); // Envoie le rôle et le score actuel

    socket.on('playerState', (data) => { socket.broadcast.emit('enemyState', data); });
    socket.on('throwBoomerang', () => { socket.broadcast.emit('enemyThrow'); });
    
    socket.on('playerDied', (data) => {
        // L'attaquant gagne un point
        let winner = (data.victim === 'p1') ? 'p2' : 'p1';
        scores[winner]++;

        // On envoie le nouveau score et l'info du mort
        io.emit('scoreUpdate', scores);
        socket.broadcast.emit('enemyDied', data);

        // Si quelqu'un atteint 10 victoires
        if (scores[winner] >= 10) {
            io.emit('gameWin', { winner });
            scores = { p1: 0, p2: 0 }; // On reset pour la prochaine fois
        }
    });

    socket.on('chatMessage', (msg) => { socket.broadcast.emit('chatMessage', msg); });
    socket.on('disconnect', () => { playersCount--; });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Port ${PORT}`); });
