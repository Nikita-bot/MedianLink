const startCallButton = document.getElementById('startCall');
const endCallButton = document.getElementById('endCall');
const localAudio = document.getElementById('localAudio');

let localStream;
let ws;
let peerConnections = {}; // Хранит соединения для каждого пользователя
let remoteStreams = {}; // Хранит аудио-потоки для каждого пользователя
let userId; // Наш ID в сети
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
    } catch (error) {
        console.error("Ошибка при получении количества онлайн-пользователей:", error);
    }
}

setInterval(updateOnlineCount, 1000);

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

async function getLocalIP() {
    return new Promise((resolve, reject) => {
        const pc = new RTCPeerConnection(configuration);
        pc.createDataChannel(""); // Создаём пустой канал для WebRTC
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(reject);

        pc.onicecandidate = (event) => {
            if (event && event.candidate) {
                const ip = event.candidate.candidate.split(" ")[4]; // Извлекаем IP-адрес
                pc.close();
                resolve(ip);
            }
        };

        setTimeout(() => reject("Не удалось получить IP"), 5000);
    });
}

// Подключение к WebSocket
async function connectWebSocket() {
    ws = new WebSocket('wss://median-map.online:8888/ws');

    ws.onopen = () => {
        console.log("WebSocket соединение установлено");
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.announce) {
            console.log("Новый пользователь:", message.announce);
            connectToUsers([message.announce]); // Подключаемся к новому пользователю
        } else if (message.offer) {
            await handleOffer(message.offer, message.senderId);
        } else if (message.answer) {
            await peerConnections[message.senderId]?.setRemoteDescription(message.answer);
        } else if (message.candidate) {
            await peerConnections[message.senderId]?.addIceCandidate(message.candidate);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket соединение закрыто");
    };
}

// Обработчик входящего предложения (offer)
async function handleOffer(offer, senderId) {
    if (!peerConnections[senderId]) {
        peerConnections[senderId] = createPeerConnection(senderId);
    }

    await peerConnections[senderId].setRemoteDescription(offer);
    const answer = await peerConnections[senderId].createAnswer();
    await peerConnections[senderId].setLocalDescription(answer);

    ws.send(JSON.stringify({ answer, senderId: userId })); // Отправляем свой IP как ID
}

// Создание нового WebRTC-соединения
function createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
        if (!remoteStreams[remoteUserId]) {
            remoteStreams[remoteUserId] = new Audio();
            remoteStreams[remoteUserId].autoplay = true;
            document.body.appendChild(remoteStreams[remoteUserId]);
        }
        remoteStreams[remoteUserId].srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ candidate: event.candidate, senderId: userId })); // Передаём свой IP как ID
        }
    };

    return pc;
}

// Подключение ко всем пользователям в чате
async function connectToUsers(users) {
    for (let remoteUserId of users) {
        if (!peerConnections[remoteUserId] && remoteUserId !== userId) { // Не подключаемся к себе
            peerConnections[remoteUserId] = createPeerConnection(remoteUserId);
        }

        const offer = await peerConnections[remoteUserId].createOffer();
        await peerConnections[remoteUserId].setLocalDescription(offer);

        ws.send(JSON.stringify({ offer, senderId: userId}));
    }
}

// Кнопка "Начать звонок"
startCallButton.addEventListener("click", async () => {
    startCallButton.disabled = true;
    endCallButton.disabled = false;

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudio.srcObject = localStream;

    userId = await getLocalIP(); // Получаем IP как ID пользователя
    console.log("Мой ID (IP):", userId);
    ws.send(JSON.stringify({ announce: userId }));
});


endCallButton.addEventListener("click", () => {
    startCallButton.disabled = false;
    endCallButton.disabled = true;

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};

    Object.values(remoteStreams).forEach(rs => rs.getTracks().forEach((track) => track.stop()))
    remoteStreams = {};

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    localAudio.srcObject = null;
    console.log("Звонок завершен.");
});

