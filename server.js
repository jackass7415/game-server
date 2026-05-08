const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Boomerang OK'); });

let scores = { p1: 0, p2: 0 };
let assignedRoles = {}; // Stocke qui est qui { socketId: 'p1' ou 'p2' }

io.on('connection', (socket) => {
    // On cherche quel rôle est libre
    let role = null;
    const currentRoles = Object.values(assignedRoles);
    
    if (!currentRoles.includes('p1')) role = 'p1';
    else if (!currentRoles.includes('p2')) role = 'p2';
    else role = 'spectateur';

    assignedRoles[socket.id] = role;
    console.log(`Joueur connecté: ${role}`);

    // On envoie le rôle et le score
    socket.emit('init', { role, scores });

    socket.on('playerState', (data) => { socket.broadcast.emit('enemyState', data); });
    socket.on('throwBoomerang', () => { socket.broadcast.emit('enemyThrow'); });
    
    socket.on('playerDied', (data) => {
        let winner = (data.victim === 'p1') ? 'p2' : 'p1';
        scores[winner]++;
        io.emit('scoreUpdate', scores);
        socket.broadcast.emit('enemyDied', data);

        if (scores[winner] >= 10) {
            io.emit('gameWin', { winner });
            scores = { p1: 0, p2: 0 };
        }
    });

    // Chat : on relaie aussi le rôle pour avoir la bonne couleur
    socket.on('chatMessage', (msg) => {
        socket.broadcast.emit('chatMessage', { text: msg, role: assignedRoles[socket.id] });
    });

    socket.on('disconnect', () => {
        console.log(`Déconnexion de: ${assignedRoles[socket.id]}`);
        delete assignedRoles[socket.id];
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt`); });
