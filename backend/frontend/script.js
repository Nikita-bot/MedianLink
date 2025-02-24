const startCallButton = document.getElementById('startCall');
const endCallButton = document.getElementById('endCall');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');

let localStream;
let remoteStream;
let peerConnection;
let ws;
let onlineCount = 0;
let enteredPin = '';

const configuration = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302",
        },
        {
            urls: "turn:your-turn-server.com:3478",
            username: "your-username",
            credential: "your-password",
        },
    ],
};

function addDigit(digit) {
    if (enteredPin.length < 5) {
        enteredPin += digit;
        document.getElementById('inputDisplay').textContent = enteredPin.padEnd(5, '-');
    }
}

function clearPin() {
    enteredPin = '';
    document.getElementById('inputDisplay').textContent = '-----';
    document.getElementById('status').textContent = 'uc0u1047 u1072 u1082 u1088 u1099 u1090 u1086 ';
}

async function updateOnlineCount() {
    try {
        const response = await fetch("/count");
        const onlineCount = await response.text();
        document.getElementById("onlineCount").textContent = onlineCount;
    } catch (error) {
        console.error("Ошибка при получении количества онлайн-пользователей:", error);
    }
}

setInterval(updateOnlineCount, 1000);

document.getElementById("loginBtn").addEventListener("click", function() {
    const login = document.getElementById("login").value;
    const password = document.getElementById("password").value;
    
    fetch("/checkUser", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `login=${login}&password=${password}`
    })
    .then(response => response.text())
    .then(data => {
        if (data === "Ok") {
            document.getElementById("authContainer").style.display = "none";
            document.getElementById("chatContainer").style.display = "block";
            connectWebSocket();
        } else {
            document.getElementById("error").textContent = "Неверные данные!";
        }
    });
});


function connectWebSocket() {
    ws = new WebSocket('wss://median-map.online:8080/ws');

    ws.onopen = () => {
        console.log("WebSocket соединение установлено");
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.offer) {
            await handleOffer(message.offer);
        } else if (message.answer) {
            await peerConnection.setRemoteDescription(message.answer);
        } else if (message.candidate) {
            await peerConnection.addIceCandidate(message.candidate);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket соединение закрыто");
    };
}


async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    await peerConnection.setRemoteDescription(offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    ws.send(JSON.stringify({ answer }));
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        remoteAudio.srcObject = remoteStream;
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ candidate: event.candidate }));
        }
    };
}

startCallButton.addEventListener('click', async () => {
    startCallButton.disabled = true;
    endCallButton.disabled = false; 
    updateOnlineCount()

    try {

        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localAudio.srcObject = localStream;

        createPeerConnection();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        ws.send(JSON.stringify({ offer }));
    } catch (error) {
        console.error("Ошибка при начале звонка:", error);
    }
});


endCallButton.addEventListener('click', () => {
    startCallButton.disabled = false;
    endCallButton.disabled = true;

    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
    }

    if (peerConnection) {
        peerConnection.close();
    }

    localAudio.srcObject = null;
    remoteAudio.srcObject = null;

    console.log("Звонок завершен.");
});

