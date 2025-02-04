package main

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Разрешаем все источники (для тестирования)
	},
}

var clients = make(map[*websocket.Conn]bool)
var mutex = &sync.Mutex{}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)

	handler := cors.Default().Handler(mux)
	http.ListenAndServe(":8080", handler)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Ошибка при обновлении соединения:", err)
		return
	}
	defer conn.Close()

	// Регистрация клиента
	mutex.Lock()
	clients[conn] = true
	mutex.Unlock()

	log.Println("Новый клиент подключен")

	// Обработка сообщений от клиента
	for {
		var msg map[string]interface{}
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("Ошибка при чтении сообщения:", err)
			break
		}

		log.Printf("Получено сообщение: %v", msg)

		// Пересылка сообщения всем другим клиентам
		mutex.Lock()
		for client := range clients {
			if client != conn {
				err := client.WriteJSON(msg)
				if err != nil {
					log.Println("Ошибка при отправке сообщения:", err)
					client.Close()
					delete(clients, client)
				}
			}
		}
		mutex.Unlock()
	}

	// Удаление клиента при отключении
	mutex.Lock()
	delete(clients, conn)
	mutex.Unlock()
	log.Println("Клиент отключен")
}
