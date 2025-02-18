import asyncio
import json
import websockets
import pyaudio
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer, RTCRtpSender
from aiortc.contrib.media import MediaPlayer
dfdf

# Конфигурация ICE-серверов (STUN)
configuration = RTCConfiguration([
    RTCIceServer(urls="stun:stun.l.google.com:19302")
])

# Глобальные переменные для PeerConnection и медиапотоков
pc = None
peer_connections = {}
device_name = "Набор микрофонов (Realtek(R) Audio)"
local_audio = MediaPlayer(f"audio={device_name}", format="dshow", options={"rtbufsize": "100000000"})

p = pyaudio.PyAudio()
output_stream = None

def play_audio(data):
    global output_stream
    if output_stream is None:
        # Инициализация потока воспроизведения
        output_stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=100000,
            output=True,
            frames_per_buffer=128
        )
    output_stream.write(data)


async def connect_websocket():
    uri = "wss://median-map.online:8080/ws"
    async with websockets.connect(uri) as websocket:
        print("WebSocket соединение установлено, начинаю звонок")
        await start_call(websocket)
        # await ice_keep_alive(websocket)
        await handle_websocket_messages(websocket)


async def handle_websocket_messages(websocket):
    print("Ожидание сообщений от WebSocket")
    async for message in websocket:
        data = json.loads(message)
        if data.get("offer"):
            print("Получен offer")
            await handle_offer(data["offer"], websocket)
        elif data.get("answer"):
            print("Получен answer")
            try:
                answer = data["answer"]
                await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
            except Exception as e:
                print("Ошибка: получен answer в состоянии 'stable'. Реконнект через случайную задержку...")
        elif data.get("candidate"):
            print("Получен ICE кандидат")
            candidate = data["candidate"]
            ice_candidate = RTCIceCandidate(
                candidate=candidate["candidate"],
                sdpMid=candidate["sdpMid"],
                sdpMLineIndex=candidate["sdpMLineIndex"]
            )
            await pc.addIceCandidate(ice_candidate)
            print("ICE кандидат добавлен")


async def handle_offer(offer, websocket):
    global pc
    print("Обработка offer")

    if pc is None:
        await create_peer_connection(websocket)

    if pc.signalingState == "have-local-offer":
        print("Конфликт: уже есть локальный офер. Перезапуск соединения.")
        await pc.close()
        await create_peer_connection(websocket)

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    await websocket.send(json.dumps({
        "answer": {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type
        }
    }))

async def reconnect(websocket):
    global pc
    if pc:
        await pc.close()
    await create_peer_connection(websocket)
    await start_call(websocket)


async def create_peer_connection(websocket):
    print("Создание PeerConnection")
    global pc, local_audio, peer_connections
    pc = RTCPeerConnection(configuration)
    peer_connections["main"] = pc
    pc.sdpSemantics = "unified-plan"

    if local_audio.audio:
        pc.addTrack(local_audio.audio)

    @pc.on("icecandidate")
    async def on_ice_candidate(candidate):
            if candidate:
                print("Отправка ICE-кандидата")
                await websocket.send(json.dumps({
                    "candidate": {
                        "sdpMid": candidate.sdpMid,
                        "sdpMLineIndex": candidate.sdpMLineIndex,
                        "candidate": candidate.candidate
                    }
                }))
            else:
                print("ICE-кандидаты закончились, отправляем null")
                await websocket.send(json.dumps({"candidate": None}))

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        
        print(f"Состояние соединения: {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "disconnected":
            await reconnect(websocket)

    @pc.on("track")
    async def on_track(track):
        print(f"Получен трек с типом: {track.kind}")

        if track.kind == "audio":
            print("Получен аудиопоток")

            async def track_monitor():
                while True:
                    frame = await track.recv()
                    if frame is None:
                        print("Аудиопоток пуст, соединение может закрыться")
                        await asyncio.sleep(0.5)
                        continue
                    play_audio(frame.to_ndarray().tobytes())

            # Запускаем обработку аудиопотока в фоне
            asyncio.create_task(track_monitor())

            # Добавляем обработку завершения трека
            @track.on("ended")
            async def on_track_ended():
                print("Аудиопоток завершился, реконнект...")
                await reconnect(websocket)


async def start_call(websocket):
    
    global pc
    if pc is None:
        await create_peer_connection(websocket)
    

    print("Создание нового оффера.")
    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    await websocket.send(json.dumps({
        "offer": {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type
        }
    }))




async def main():
    await connect_websocket()

if __name__ == "__main__":
    asyncio.run(main())