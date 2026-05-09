const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/', (req, res) => { res.send('Serveur Survie HOTE OK'); });

const serverStartTime = Date.now();
const worldSeeds = { x: Math.random() * 1000000, z: Math.random() * 1000000 };
const players = {};
let destroyedObjects = [];

// 🟢 NOUVEAU : Identifiant du joueur "Maître du Jeu"
let hostId = null; 

io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id, x: 0, y: 30, z: 0, ry: 0 };

    // Si personne n'est le chef, le nouveau devient le chef !
    if (!hostId) {
        hostId = socket.id;
        console.log(`Nouvel Hôte assigné: ${hostId}`);
    }

    // On prévient le joueur s'il est l'Hôte au moment de l'initialisation
    socket.emit('init', { 
        id: socket.id, 
        players, 
        seeds: worldSeeds,
        startTime: serverStartTime,
        destroyedObjects: destroyedObjects,
        isHost: (socket.id === hostId) // <-- INFO CRUCIALE
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

    // 🟢 NOUVEAU : Relais des positions des monstres (De l'Hôte vers les Clients)
    socket.on('syncEntities', (entitiesData) => {
        if (socket.id === hostId) { // Sécurité : seul l'hôte a le droit de bouger les monstres
            socket.broadcast.emit('syncEntities', entitiesData);
        }
    });

    // 🟢 NOUVEAU : Un client frappe un monstre (Du Client vers l'Hôte)
    socket.on('hitEntity', (data) => {
        // On envoie la demande de dégâts directement à l'Hôte pour qu'il calcule la mort
        io.to(hostId).emit('hitEntity', data);
    });

    socket.on('chatMessage', (msg) => {
        socket.broadcast.emit('chatMessage', { text: msg, id: socket.id });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];

        // 🟢 NOUVEAU : Transfert de pouvoir si l'Hôte quitte la partie
        if (socket.id === hostId) {
            const remainingPlayers = Object.keys(players);
            if (remainingPlayers.length > 0) {
                hostId = remainingPlayers[0]; // Le joueur suivant devient l'hôte
                io.to(hostId).emit('hostAssigned'); // On lui annonce la nouvelle
                console.log(`Changement d'Hôte: ${hostId}`);
            } else {
                hostId = null; // Plus personne
            }
        }

        io.emit('playerLeft', socket.id);
        io.emit('playerCount', Object.keys(players).length);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => { console.log(`Serveur prêt`); });
