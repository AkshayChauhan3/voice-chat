# Voice Chat Application

A real-time voice chat application using WebRTC for peer-to-peer audio streaming and Socket.IO for the signaling server.

## Features
- Real-time voice chatting in "Rooms"
- Peer-to-peer WebRTC connections
- Built-in localized HTTPS signaling server to allow mobile testing over the local network (browsers require a Secure Context for microphone access).

## How It Works (Beginner Friendly)
Ever wondered how your voice gets from your computer to someone else's? Here is a simple breakdown of the magic happening behind the scenes:

1. **The Frontend (The User Interface)**: 
   This is the web page you see (built with HTML, CSS, and plain JavaScript). It provides the interface to enter your name, join a specific "Room", and click the "Call" button. It also asks the browser for permission to use your microphone.

2. **The Signaling Server (The Telephone Operator)**: 
   Built using *Node.js* and *Socket.IO*, the server's main job is to act like an old-school telephone operator. When you join a room, the server introduces you to everyone else there. To establish a voice call, computers need to exchange technical details (like their IP addresses and what kind of audio formats they support). The server passes these "invitations" and "answers" back and forth, but it **never** touches your actual voice data.

3. **WebRTC (The Walkie-Talkie)**:
   *WebRTC* (Web Real-Time Communication) is the technology built into modern browsers that handles the actual voice streaming. Once the Signaling Server has helped two computers introduce themselves, WebRTC creates a direct line (Peer-to-Peer connection) between them. Your voice travels directly from your browser to the other person's browser, just like a walkie-talkie. This makes the chat extremely fast and private!

4. **Why HTTPS? (Secure Context)**:
   For security reasons, web browsers will only let a website access your microphone if the site is perfectly secure. That's why this app sets up its own secure `HTTPS` connection using fake (self-signed) certificates to run locally.

## Prerequisites
- [Node.js](https://nodejs.org/) installed on your machine.
- SSL Certificates (`key.pem` and `cert.pem`) are required. If they don't exist in the project root, you can generate them using OpenSSL:
  ```bash
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
  ```

## Getting Started

1. **Install Dependencies**
   Open your terminal in the project directory and run:
   ```bash
   npm install
   ```

2. **Start the Server**
   To start the signaling server, run:
   ```bash
   node server.js
   ```

3. **Access the Application**
   - The server will run securely on port `3000`.
   - On the same machine: Open your browser and navigate to `https://localhost:3000`
   - On other devices (like your mobile phone) connected to the same Wi-Fi: Navigate to `https://<your-ip-address>:3000` (the server logs will print the exact IP address to use).

## Important Note regarding HTTPS / Certificates
Because this application uses WebRTC and accesses user media (the microphone), modern browsers require the connection to be secure (HTTPS) when accessed outside of `localhost`. 

Since we are using self-signed certificates for local development:
- **Desktop/Laptop**: Your browser will display a warning saying "Your connection is not private". Click on **Advanced** and then click **Proceed to localhost (unsafe)** or **Proceed to <ip-address> (unsafe)**.
- **Android Chrome (Mobile)**: If the "Proceed" button is missing on the warning page, you can bypass it by tapping anywhere on the warning screen and blindly typing `thisisunsafe`. 
