import asyncio
import json
import websockets
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
from aiortc.contrib.media import MediaPlayer, MediaRecorder
import requests

# Конфигурация ICE-серверов (STUN/TURN)
configuration = {
    "iceServers": [
        {"urls": "stun:stun.l.google.com:19302"},
        {
            "urls": "turn:your-turn-server.com:3478",
            "username": "your-username",
            "credential": "your-password",
        },
    ]
}

# Глобальные переменные
peer_connection = None
local_stream = None
remote_stream = None
ws = None

async def update_online_count():
    while True:
        try:
            response = requests.get('https://median-map.online:8080/count')
            if response.status_code == 200:
                user_count = response.text
                print(f"Online users: {user_count}")
            else:
                print(f"Ошибка: получен статус {response.status_code}")
        except Exception as e:
            print(f"Ошибка при получении количества онлайн-пользователей: {e}")
        await asyncio.sleep(1)

async def connect_websocket():
    global ws
    uri = "wss://median-map.online:8080/ws"
    ws = await websockets.connect(uri)

    async for message in ws:
        data = json.loads(message)

        if "offer" in data:
            await handle_offer(data["offer"])
        elif "answer" in data:
            await peer_connection.setRemoteDescription(
                RTCSessionDescription(sdp=data["answer"]["sdp"], type=data["answer"]["type"])
            )
        elif "candidate" in data:
            await peer_connection.addIceCandidate(RTCIceCandidate(**data["candidate"]))

async def handle_offer(offer):
    global peer_connection
    if not peer_connection:
        create_peer_connection()

    await peer_connection.setRemoteDescription(
        RTCSessionDescription(sdp=offer["sdp"], type=offer["type"])
    )

    answer = await peer_connection.createAnswer()
    await peer_connection.setLocalDescription(answer)
    print("Generated answer SDP:", answer.sdp)  # Для отладки
    await ws.send(json.dumps({"answer": {"sdp": answer.sdp, "type": answer.type}}))


def create_peer_connection():
    global peer_connection, local_stream
    peer_connection = RTCPeerConnection(configuration)

    # Добавление локального аудиопотока
    if local_stream and local_stream.audio:
        for track in local_stream.audio:
            peer_connection.addTrack(track)


    
    remote_stream = MediaRecorder("output.wav")  # Записываем входящий звук
    remote_stream.start()

    @peer_connection.on("track")
    async def on_track(track):
        if track.kind == "audio":
            remote_stream.addTrack(track)

    # Отправка ICE-кандидатов
    @peer_connection.on("icecandidate")
    async def on_ice_candidate(candidate):
        if candidate:
            print("Sending ICE candidate:", candidate)
            await ws.send(json.dumps({
                "candidate": {
                    "candidate": candidate.candidate,
                    "sdpMid": candidate.sdpMid,
                    "sdpMLineIndex": candidate.sdpMLineIndex
                }
            }))

async def start_call():
    global peer_connection, local_stream, ws

    try:
        # Захватываем аудио с микрофона
        #local_stream = MediaPlayer(None, format="avfoundation")  # MacOS
        local_stream = MediaPlayer("default", format="dshow", options={"audio_codec": "opus"})
        # local_stream = MediaPlayer("default", format="pulse")  # Linux

        # Создаем PeerConnection
        peer_connection = RTCPeerConnection()

        # Добавляем аудио-трек
        for track in local_stream.audio:
            peer_connection.addTrack(track)

        # Генерируем offer
        offer = await peer_connection.createOffer()
        await peer_connection.setLocalDescription(offer)

        # Отправляем offer через WebSocket
        await ws.send(json.dumps({"offer": {"sdp": offer.sdp, "type": offer.type}}))

    except Exception as e:
        print(f"Ошибка при начале звонка: {e}")


async def end_call():
    global local_stream, remote_stream, peer_connection
    if local_stream:
        await local_stream.stop()
    if remote_stream:
        await remote_stream.stop()
    if peer_connection:
        await peer_connection.close()

    print("Звонок завершен.")

async def main():
    asyncio.create_task(update_online_count())
    while True:
        command = input("Введите 1 для начала звонка, 2 для завершения: ")
        if command == "1":
            await start_call()
        elif command == "2":
            await end_call()
        else:
            print("Неизвестная команда. Введите 1 или 2.")


if __name__ == "__main__":
    asyncio.run(main())