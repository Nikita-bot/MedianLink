const startCallButton = document.getElementById('startCall');
const endCallButton = document.getElementById('endCall');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');

let localStream;
let remoteStream;
let peerConnection;
let ws;

// Конфигурация ICE-серверов (STUN)
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

// Подключение к WebSocket
function connectWebSocket() {
    ws = new WebSocket('wss://median-map.online:8080/ws');

    ws.onopen = () => {
        console.log("WebSocket соединение установлено");
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.offer) {
            // Получен offer от другого клиента
            await handleOffer(message.offer);
        } else if (message.answer) {
            // Получен answer от другого клиента
            await peerConnection.setRemoteDescription(message.answer);
        } else if (message.candidate) {
            // Получен ICE-кандидат
            await peerConnection.addIceCandidate(message.candidate);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket соединение закрыто");
    };
}

// Обработка offer
async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    await peerConnection.setRemoteDescription(offer);

    // Создание answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Отправка answer через WebSocket
    ws.send(JSON.stringify({ answer }));
}

// Создание PeerConnection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // Добавление локального аудиопотока
    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    // Обработка удаленного аудиопотока
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        remoteAudio.srcObject = remoteStream;
    };

    // Отправка ICE-кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ candidate: event.candidate }));
        }
    };
}

// Начало звонка
startCallButton.addEventListener('click', async () => {
    startCallButton.disabled = true;
    endCallButton.disabled = false;

    try {
        // Получение локального аудиопотока (микрофон)
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localAudio.srcObject = localStream;

        // Создание PeerConnection
        createPeerConnection();

        // Создание offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Отправка offer через WebSocket
        ws.send(JSON.stringify({ offer }));
    } catch (error) {
        console.error("Ошибка при начале звонка:", error);
    }
});

// Завершение звонка
endCallButton.addEventListener('click', () => {
    startCallButton.disabled = false;
    endCallButton.disabled = true;

    // Остановка всех треков
    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
    }

    // Закрытие PeerConnection
    if (peerConnection) {
        peerConnection.close();
    }

    // Сброс аудиоэлементов
    localAudio.srcObject = null;
    remoteAudio.srcObject = null;

    console.log("Звонок завершен.");
});

// Инициализация WebSocket
connectWebSocket();