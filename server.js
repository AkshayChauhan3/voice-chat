    /**
     * =============================================================
     * server.js  –  Voice Chat Signalling Server  (HTTPS + WSS)
     * =============================================================
     * Why HTTPS?
     *   Browsers require a "secure context" (HTTPS or localhost) before
     *   they expose navigator.mediaDevices.  When testing from a mobile
     *   device on the same Wi-Fi, the URL is http://192.168.x.x:3000
     *   which is NOT localhost, so the browser blocks microphone access.
     *   Switching to HTTPS fixes this.
     *
     * Certificates (self-signed, valid 1 year):
     *   Generated once with:
     *     openssl req -x509 -newkey rsa:2048 \
     *       -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
     *   Files: key.pem, cert.pem  (gitignore these in production)
     *
     * On first visit the browser will show "Your connection is not private".
     * Click "Advanced → Proceed" to accept the self-signed cert.
     * Android Chrome: type "thisisunsafe" on the warning page to bypass.
     * =============================================================
     */

    const fs = require("fs");
    const https = require("https");       // ← HTTPS instead of http
    const express = require("express");
    const { Server } = require("socket.io");

    /* ── TLS credentials (self-signed) ── */
    const tlsOptions = {
        key: fs.readFileSync("key.pem"),
        cert: fs.readFileSync("cert.pem"),
    };

    const app = express();
    const server = https.createServer(tlsOptions, app); // ← HTTPS server
    const io = new Server(server);

    /* ── Serve all project files as static assets ── */
    app.use(express.static(__dirname));

    /**
     * roomUsers  –  { roomId → Map<socketId, username> }
     * Tracks who is currently in each room so we can broadcast
     * the participant list and notify peers on join/leave.
     */
    const roomUsers = new Map();

    /* ════════════════════════════════════════════════
    Socket.IO connection handler
    ════════════════════════════════════════════════ */
    io.on("connection", (socket) => {

        console.log(`[+] Connected   : ${socket.id}`);

        /* ── JOIN ROOM ─────────────────────────────── */
        /**
         * Client sends { room, username }.
         * We add the socket to the Socket.IO room, update roomUsers,
         * and broadcast join events so every peer updates their UI.
         */
        socket.on("join-room", ({ room, username }) => {
            socket.join(room);
            socket.currentRoom = room;
            socket.currentUsername = username;

            if (!roomUsers.has(room)) roomUsers.set(room, new Map());
            roomUsers.get(room).set(socket.id, username);

            const users = [...roomUsers.get(room).values()];
            console.log(`[→] ${username} joined "${room}". Users: [${users.join(", ")}]`);

            // tell everyone else a new user arrived
            socket.to(room).emit("user-joined", { username, users });

            // send the full user list back to the joining socket only
            socket.emit("room-info", { room, users });
        });

        /* ── WEBRTC OFFER ───────────────────────────── */
        /**
         * Caller creates SDP offer and sends it here.
         * We relay it to every other peer in the same room.
         */
        socket.on("offer", (data) => {
            console.log(`[↔] Offer    from ${socket.id} → room "${data.room}"`);
            socket.to(data.room).emit("offer", { ...data, from: socket.id });
        });

        /* ── WEBRTC ANSWER ──────────────────────────── */
        /**
         * Callee creates SDP answer and sends it here.
         * We relay it back to the caller.
         */
        socket.on("answer", (data) => {
            console.log(`[↔] Answer   from ${socket.id} → room "${data.room}"`);
            socket.to(data.room).emit("answer", data);
        });

        /* ── ICE CANDIDATE ──────────────────────────── */
        /**
         * Both peers trickle ICE candidates through the server.
         * Without relaying these the P2P connection cannot be
         * established in most real-world network configurations.
         */
        socket.on("ice-candidate", (data) => {
            socket.to(data.room).emit("ice-candidate", data.candidate);
        });

        /* ── HANG UP (Stay in room, drop call) ──────── */
        socket.on("hangup", (data) => {
            socket.to(data.room).emit("hangup", data);
        });

        /* ── LEAVE ROOM (voluntary) ─────────────────── */
        socket.on("leave-room", ({ room, username }) => {
            _removeFromRoom(socket, room, username);
        });

        /* ── DISCONNECT (tab close / network drop) ───── */
        socket.on("disconnect", () => {
            console.log(`[-] Disconnected: ${socket.id}`);
            if (socket.currentRoom) {
                _removeFromRoom(socket, socket.currentRoom, socket.currentUsername);
            }
        });
    });

    /* ════════════════════════════════════════════════
    Helper: remove user from room and notify peers
    ════════════════════════════════════════════════ */
    function _removeFromRoom(socket, room, username) {
        if (!roomUsers.has(room)) return;

        roomUsers.get(room).delete(socket.id);
        const users = [...roomUsers.get(room).values()];

        console.log(`[←] ${username} left "${room}". Remaining: [${users.join(", ")}]`);
        socket.to(room).emit("user-left", { username, users });

        if (users.length === 0) roomUsers.delete(room); // prune empty rooms
        socket.leave(room);
    }

    /* ════════════════════════════════════════════════
    Start the HTTPS server
    ════════════════════════════════════════════════ */
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, "0.0.0.0", () => {
        // Show all local IPs so the user knows which URL to open on mobile
        const { networkInterfaces } = require("os");
        const nets = networkInterfaces();
        const ips = [];
        for (const ifaces of Object.values(nets)) {
            for (const iface of ifaces) {
                if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
            }
        }

        console.log(`\n🔒  HTTPS server running!\n`);
        console.log(`   Local   → https://localhost:${PORT}`);
        ips.forEach(ip => console.log(`   Network → https://${ip}:${PORT}`));
        console.log(`\n⚠️  Self-signed cert: accept the browser warning on first visit.`);
        console.log(`   Android Chrome tip: type  thisisunsafe  on the warning page.\n`);
    });