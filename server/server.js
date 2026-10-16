const http = require('http');
const {
    PORT,
    CLIENT_URL
} = require('./config/env'); // must be first — loads dotenv
const app = require('./app');
const {
    initFirebase
} = require('./config/firebase');
const {
    setIO
} = require('./sockets/index');
const {
    initSocket
} = require('./sockets/socket.handler');

// Initialize Firebase Firestore
initFirebase();

const server = http.createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: CLIENT_URL,
        credentials: true
    },
});

setIO(io);
initSocket(io);

// Graceful shutdown — releases the port cleanly on SIGTERM/SIGINT
const shutdown = (signal) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    server.close(() => {
        console.log('Server closed. Port released.');
        process.exit(0);
    });
    // Force exit if close takes too long
    setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C

// Handle port-in-use and other listen errors without crashing nodemon loop
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        const fallback = Number(PORT) + 1;
        console.error(`Port ${PORT} is already in use. Trying port ${fallback}...`);
        setTimeout(() => server.listen(fallback), 1000);
    } else {
        console.error('Server error:', err.message);
        process.exit(1);
    }
});

server.listen(PORT, () => {
    const addr = server.address();
    console.log(`Server running on port ${addr.port}`);
});