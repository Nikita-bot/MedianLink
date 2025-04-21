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
let isCallActive = false;
let activeUsers = 0;

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
        enteredPin += digit;
        document.getElementById('login').innerText = enteredPin;
}

function clearPin() {
    enteredPin = '';
    document.getElementById('login').innerText = '';
}

async function updateOnlineCount() {
    try {
        const response = await fetch("/count");
        const onlineCount = await response.text();
        document.getElementById("onlineCount").textContent = onlineCount;
        updateCallButtonState();
    } catch (error) {
        console.error("Ошибка при получении количества онлайн-пользователей:", error);
    }
}

setInterval(updateOnlineCount, 1000);


function updateCheckers() {
    const check1 = document.getElementById("check1");
    const check2 = document.getElementById("check2");

    check1.style.backgroundColor = "";
    check2.style.backgroundColor = "";


    if (isCallActive) {
        check1.style.backgroundColor = "green"; 
        if (activeUsers >= 2) {
            check2.style.backgroundColor = "green"; 
        }
    }
}

function updateCallButtonState() {
    const canStartCall = !isCallActive && onlineCount >= 2;
    startCallButton.disabled = !canStartCall;
}

document.getElementById("loginBtn").addEventListener("click", function() {
    const login = document.getElementById("login").innerText;
    
    fetch("/checkUser", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `login=${login}`
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
            isCallActive = true;
            activeUsers = 2; 
            updateCheckers();
            updateCallButtonState();
            await handleOffer(message.offer);
        } else if (message.answer) {
            await peerConnection.setRemoteDescription(message.answer);
        } else if (message.candidate) {
            await peerConnection.addIceCandidate(message.candidate);
        } else if (message.action === "call_started") {
            isCallActive = true;
            activeUsers = 1;
            updateCheckers();
            updateCallButtonState();
        } else if (message.action === "call_ended") {
            isCallActive = false;
            activeUsers = 0;
            updateCheckers();
            updateCallButtonState();
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
    
    isCallActive = true;
    activeUsers = 1;

    updateCheckers();
    updateCallButtonState();

    try {

        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localAudio.srcObject = localStream;

        createPeerConnection();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        ws.send(JSON.stringify({ 
            offer,
            action: "call_started" 
        }));

    } catch (error) {
        console.error("Ошибка при начале звонка:", error);
        isCallActive = false;
        activeUsers = 0;
        updateCheckers();
        updateCallButtonState();
    }
});


endCallButton.addEventListener('click', () => {
    startCallButton.disabled = false;
    endCallButton.disabled = true;
    isCallActive = false;
    activeUsers = 0;

    updateCheckers();
    updateCallButtonState();


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

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "call_ended" }));
    }


    console.log("Звонок завершен.");
});

