package main

import (
	"crypto/tls"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var clients = make(map[*websocket.Conn]bool)
var mutex = &sync.Mutex{}

func main() {
	mux := http.NewServeMux()

	fs := http.FileServer(http.Dir("app/frontend"))
	mux.Handle("/", fs)
	mux.HandleFunc("/ws", handleWebSocket)

	// TLS-сертификатыc
	certFile := "app/cert/median-map_online_cert.pem"
	keyFile := "app/cert/median-map_online_private_key.pem"

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	log.Println("WebSocket-сервер запущен на wss://median-map.online/ws/")
	err := server.ListenAndServeTLS(certFile, keyFile)
	if err != nil {
		log.Fatal("Ошибка запуска сервера:", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Ошибка при обновлении соединения:", err)
		return
	}
	defer conn.Close()

	// Добавление клиента
	mutex.Lock()
	clients[conn] = true
	mutex.Unlock()

	log.Println("Новый клиент подключен")

	for {
		var msg map[string]interface{}
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("Ошибка при чтении сообщения:", err)
			break
		}

		log.Printf("Получено сообщение: %v", msg)

		// Рассылка другим клиентам
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

	mutex.Lock()
	delete(clients, conn)
	mutex.Unlock()
	log.Println("Клиент отключен")
}
