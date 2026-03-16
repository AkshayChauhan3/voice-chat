/**
 * =============================================================
 * script.js  –  Voice Chat Client (WebRTC + Socket.IO)
 * =============================================================
 * Call cycle bug fixes implemented:
 * 1. Duplicate offers: Added `isInCall` guard.
 * 2. Auto-rejoin: On socket reconnect, if we were in a room, re-join it.
 * 3. ICE States: `disconnected` now attempts ICE restart (or waits) instead of immediately hanging up.
 * 4. Stale peerConnection: `hangUp()` resets everything properly allowing immediate re-calls.
 * 5. Better cleanup: When remote leaves, we hang up properly without breaking local state.
 * =============================================================
 */

const socket = io();

/* ── WebRTC & App State ── */
let localStream = null;
let peerConnection = null;
let currentRoom = "";
let currentUsername = "";
let isMuted = false;
let isInCall = false; // Guard to prevent duplicate offers

const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

/* ── DOM refs ── */
const usernameInput = document.getElementById("username");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const callBtn = document.getElementById("callBtn");
const leaveBtn = document.getElementById("leaveBtn");
const muteBtn = document.getElementById("muteBtn");
const remoteAudio = document.getElementById("remoteAudio");
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const activityLog = document.getElementById("activityLog");
const userListEl = document.getElementById("userList");
const callTimerEl = document.getElementById("callTimer");
const preJoinScreen = document.getElementById("preJoinScreen");
const mainAppScreen = document.getElementById("mainAppScreen");
const currentRoomText = document.getElementById("currentRoomText");

/* ── Call timer ── */
let timerInterval = null;
let timerSeconds = 0;

function startTimer() {
    if (timerInterval) return;
    timerSeconds = 0;
    callTimerEl.classList.remove("hidden");
    timerInterval = setInterval(() => {
        timerSeconds++;
        const m = String(Math.floor(timerSeconds / 60)).padStart(2, "0");
        const s = String(timerSeconds % 60).padStart(2, "0");
        callTimerEl.textContent = `⏱ ${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    callTimerEl.classList.add("hidden");
    callTimerEl.textContent = "⏱ 00:00";
}

/* ════════════════════════════════════════════════
   UI helpers
════════════════════════════════════════════════ */

function setStatus(text, dotColor) {
    statusEl.textContent = text;
    statusDot.style.background = dotColor;
    statusEl.style.color = dotColor;
}

function addLog(message, type = "info") {
    const placeholder = activityLog.querySelector(".log-empty");
    if (placeholder) placeholder.remove();

    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const div = document.createElement("div");
    div.className = `log-entry log-${type}`;
    div.innerHTML = `<span class="log-time">${t}</span> ${message}`;

    // Keep log from growing infinitely
    if (activityLog.children.length > 50) {
        activityLog.removeChild(activityLog.firstChild);
    }

    activityLog.appendChild(div);
    activityLog.scrollTop = activityLog.scrollHeight;
}

function renderUserList(users) {
    userListEl.innerHTML = "";
    if (users.length === 0) {
        userListEl.innerHTML = `<li class="empty-state">No one else here</li>`;
        return;
    }

    users.forEach(name => {
        const li = document.createElement("li");
        const initial = name.charAt(0).toUpperCase();
        const isMe = name === currentUsername;

        li.className = `participant-item ${isMe ? "me" : ""}`;
        li.innerHTML = `
        <div class="avatar ${isMe ? 'avatar-me' : ''}">${initial}</div>
        <div class="participant-name">${name} ${isMe ? '<span class="me-tag">(You)</span>' : ""}</div>
    `;
        userListEl.appendChild(li);
    });
}

function updateUIState(state) {
    if (state === "login") {
        preJoinScreen.classList.remove("hidden");
        mainAppScreen.classList.add("hidden");
        setStatus("Idle", "#6b7280");
        document.title = "VoiceRoom";
    } else if (state === "room") {
        preJoinScreen.classList.add("hidden");
        mainAppScreen.classList.remove("hidden");
        currentRoomText.textContent = currentRoom;

        callBtn.disabled = false;
        leaveBtn.disabled = false;
        muteBtn.classList.add("hidden");

        setStatus("In Room", "#10b981"); // emerald
        document.title = `VoiceRoom - ${currentRoom}`;
    } else if (state === "incall") {
        callBtn.disabled = true;
        leaveBtn.disabled = false;
        muteBtn.classList.remove("hidden");
        muteBtn.classList.remove("muted");
        muteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg> Mute`;
        isMuted = false;
    }
}

/* ════════════════════════════════════════════════
   Mic Access
════════════════════════════════════════════════ */

async function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
            "Microphone access unavailable. Please ensure you are using HTTPS or localhost."
        );
    }
    try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        const friendly = {
            NotAllowedError: "Microphone permission denied.",
            NotFoundError: "No microphone detected.",
            NotReadableError: "Microphone is in use by another app.",
        };
        throw new Error(friendly[err.name] || `Mic error: ${err.message}`);
    }
}

/* ════════════════════════════════════════════════
   JOIN ROOM
════════════════════════════════════════════════ */
joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    const room = roomInput.value.trim();

    if (!username || !room) {
        alert("Please enter both Name and Room ID.");
        return;
    }

    currentUsername = username;
    currentRoom = room;

    socket.emit("join-room", { room, username });

    // Optimistic UI update
    updateUIState("room");
    addLog(`Joining room <strong>${room}</strong>...`, "info");
});

/* ════════════════════════════════════════════════
   START CALL (caller side)
════════════════════════════════════════════════ */
callBtn.addEventListener("click", async () => {
    if (isInCall) return; // Prevent duplicate offers

    try {
        addLog("Requesting microphone...", "info");
        setStatus("Calling...", "#8b5cf6"); // violet

        localStream = await getMic();
        peerConnection = createPeerConnection();
        isInCall = true;
        updateUIState("incall");

        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit("offer", { offer, room: currentRoom });
        addLog("Calling participants in room...", "call");

    } catch (err) {
        addLog(err.message, "error");
        hangUp("Call failed to start.");
    }
});

/* ════════════════════════════════════════════════
   LEAVE / HANG UP
════════════════════════════════════════════════ */
leaveBtn.addEventListener("click", () => {
    // If we're in a call, just drop the call. If not, leave the room entirely.
    if (isInCall) {
        hangUp("You ended the call.");
        // notify others we hung up without leaving room
        socket.emit("hangup", { room: currentRoom, username: currentUsername });
    } else {
        socket.emit("leave-room", { room: currentRoom, username: currentUsername });
        currentRoom = "";
        updateUIState("login");
        addLog("You left the room.", "leave");
        activityLog.innerHTML = '<div class="log-empty">Join a room to see activity.</div>';
    }
});

/* ════════════════════════════════════════════════
   MUTE / UNMUTE
════════════════════════════════════════════════ */
muteBtn.addEventListener("click", () => {
    if (!localStream) return;
    isMuted = !isMuted;

    localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });

    if (isMuted) {
        muteBtn.classList.add("muted");
        muteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg> Unmute`;
        addLog("Microphone muted.", "info");
    } else {
        muteBtn.classList.remove("muted");
        muteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg> Mute`;
        addLog("Microphone unmuted.", "info");
    }
});

/* ════════════════════════════════════════════════
   createPeerConnection()
════════════════════════════════════════════════ */
function createPeerConnection() {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("ice-candidate", { candidate, room: currentRoom });
    };

    pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        console.log("[ICE State]", s);

        if (s === "connected" || s === "completed") {
            setStatus("Connected", "#10b981"); // emerald
            startTimer();
        } else if (s === "failed") {
            // Only hangup on strict failure. 'disconnected' might recover.
            addLog("Connection failed.", "error");
            hangUp("Connection failed.");
        } else if (s === "disconnected") {
            setStatus("Reconnecting...", "#f59e0b"); // amber
            addLog("Network drop detected, attempting to reconnect...", "warning");

            // Trigger ICE restart after a short delay if it doesn't recover on its own
            setTimeout(async () => {
                if (peerConnection && peerConnection.iceConnectionState === "disconnected") {
                    try {
                        addLog("Triggering ICE restart...", "info");
                        const offer = await peerConnection.createOffer({ iceRestart: true });
                        await peerConnection.setLocalDescription(offer);
                        socket.emit("offer", { offer, room: currentRoom, isIceRestart: true });
                    } catch (err) {
                        console.error("ICE restart failed:", err);
                    }
                }
            }, 3000);
        }
    };

    pc.ontrack = ({ streams }) => {
        remoteAudio.srcObject = streams[0];
        addLog("🔊 Audio stream connected.", "success");
        startTimer(); // Ensure timer starts even if ICE state misses
        setStatus("Connected", "#10b981");
    };

    return pc;
}

/* ════════════════════════════════════════════════
   hangUp(reason)
   Safely tears down call WITHOUT leaving the room.
════════════════════════════════════════════════ */
function hangUp(reason = "") {
    isInCall = false;

    if (peerConnection) {
        // Remove track listeners to prevent ghost audio
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    remoteAudio.srcObject = null;
    stopTimer();

    // If we are still in a room, reset back to room state
    if (currentRoom) {
        updateUIState("room");
    }

    if (reason) addLog(`Call ended: ${reason}`, "leave");
}

/* ════════════════════════════════════════════════
   SOCKET.IO — signalling events from server
════════════════════════════════════════════════ */

socket.on("room-info", ({ room, users }) => {
    renderUserList(users);
    addLog(`Joined <strong>${room}</strong>. Playing with ${users.length} total users.`, "join");
});

socket.on("user-joined", ({ username, users }) => {
    renderUserList(users);
    addLog(`👋 <strong>${username}</strong> joined the room.`, "join");
});

socket.on("user-left", ({ username, users }) => {
    renderUserList(users);
    addLog(`🚪 <strong>${username}</strong> left the room.`, "leave");
    // Only drop the call if the *other* person left. If there are 3+ people, this logic is too simple,
    // but for 1:1 it's necessary. Let's hang up everyone if someone leaves to be safe for now
    if (isInCall) hangUp(`${username} departed.`);
});

socket.on("hangup", ({ username }) => {
    if (isInCall) {
        hangUp(`${username} ended the call.`);
    }
});

// Callee receives an offer
socket.on("offer", async ({ offer, from, isIceRestart }) => {
    // If it's a new call and we're already in one, ignore
    if (isInCall && !isIceRestart) {
        console.log("Ignoring offer, already in call.");
        return;
    }

    // If it is an ICE restart, we just need to set the remote description and answer
    // using the existing peerConnection and localStream
    if (isInCall && isIceRestart) {
        try {
            addLog("Incoming ICE restart, reconnecting...", "info");
            await peerConnection.setRemoteDescription(offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit("answer", { answer, room: currentRoom });
            return;
        } catch (err) {
            console.error("Failed to handle ICE restart offer:", err);
            return;
        }
    }

    try {
        addLog("Incoming call, answering...", "info");
        setStatus("Connecting...", "#8b5cf6");

        localStream = await getMic();
        peerConnection = createPeerConnection();
        isInCall = true;
        updateUIState("incall");

        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit("answer", { answer, room: currentRoom });
    } catch (err) {
        addLog(err.message, "error");
        hangUp("Failed to answer call.");
    }
});

// Caller receives the answer
socket.on("answer", async ({ answer }) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(answer);
    } catch (err) {
        console.error("Failed to set remote description on answer", err);
    }
});

socket.on("ice-candidate", async (candidate) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.warn("ICE candidate error:", err.message);
    }
});

/* ── Socket-level Reconnect Logic ── */
socket.on("connect", () => {
    addLog("🌐 Connected to server.", "success");
    setStatus(currentRoom ? "In Room" : "Idle", currentRoom ? "#10b981" : "#6b7280");

    // Auto-rejoin room if we reconnected
    if (currentRoom && currentUsername) {
        addLog("Re-joining room...", "info");
        socket.emit("join-room", { room: currentRoom, username: currentUsername });
    }
});

socket.on("disconnect", () => {
    addLog("⚡ Disconnected from server. Trying to reconnect...", "error");
    setStatus("Offline", "#ef4444"); // red
    if (isInCall) {
        hangUp("Lost connection to server.");
    }
});