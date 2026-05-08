const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Autorise tous les sites web à s'y connecter
        methods: ["GET", "POST"]
    }
});

// Sert le fichier HTML
app.use(express.static(__dirname));

let playersCount = 0;

io.on('connection', (socket) => {
    playersCount++;
    
    // Attribue le rôle P1 (Aubergine) au premier connecté, P2 (Tomate) au second
    let role = (playersCount % 2 !== 0) ? 'p1' : 'p2';
    console.log(`Un joueur s'est connecté. Rôle assigné : ${role}`);
    
    socket.emit('init', role);

    // Relais de la position au joueur adverse
    socket.on('playerState', (data) => {
        socket.broadcast.emit('enemyState', data);
    });

    // Relais du lancer de boomerang
    socket.on('throwBoomerang', () => {
        socket.broadcast.emit('enemyThrow');
    });

    // Relais de la mort
    socket.on('playerDied', () => {
        socket.broadcast.emit('enemyDied');
    });

    socket.on('disconnect', () => {
        console.log('Un joueur a quitté.');
        playersCount--;
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
