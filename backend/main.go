package main

import (
	"crypto/tls"
	"log"
	"net/http"
	"strconv"
	"sync"

	"github.com/caarlos0/env/v9"
	"github.com/gorilla/websocket"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

type (
	Config struct {
		Login string `env:"LOGIN"`
	}

	WSMessage struct {
		Action    string      `json:"action,omitempty"`
		Offer     interface{} `json:"offer,omitempty"`
		Answer    interface{} `json:"answer,omitempty"`
		Candidate interface{} `json:"candidate,omitempty"`
	}

	Client struct {
		conn   *websocket.Conn
		inCall bool
	}

	Server struct {
		clients     map[*websocket.Conn]*Client
		countActive int
		mutex       sync.RWMutex
		config      Config
	}
)

func New() (Config, error) {
	var c Config
	err := env.ParseWithOptions(&c, env.Options{RequiredIfNoDef: true})
	if err != nil {
		return Config{}, err
	}
	return c, nil
}

func NewServer(cfg Config) *Server {
	return &Server{
		clients: make(map[*websocket.Conn]*Client),
		mutex:   sync.RWMutex{},
		config:  cfg,
	}
}

func main() {
	mux := http.NewServeMux()

	c, err := New()
	if err != nil {
		log.Fatal("Ошибка при загрузке конфигурации:", err)
		return
	}

	s := NewServer(c)

	fs := http.FileServer(http.Dir("/app/frontend"))
	mux.Handle("/", fs)
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/checkUser", func(w http.ResponseWriter, r *http.Request) {
		login := r.FormValue("login")

		if login == c.Login {
			w.Write([]byte("Ok"))
		} else {
			w.Write([]byte("Failed"))
		}
	})
	mux.HandleFunc("/count", s.countUsers)
	mux.HandleFunc("/active", s.countActiveUsers)

	certFile := "/app/cert/fullchain1.pem"
	keyFile := "/app/cert/privkey1.pem"

	server := &http.Server{
		Addr:    ":8888",
		Handler: mux,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	log.Println("WebSocket-сервер запущен на wss://median-map.online/ws/")
	err = server.ListenAndServeTLS(certFile, keyFile)

	if err != nil {
		log.Fatal("Ошибка запуска сервера:", err)
	}
}

func (s *Server) countUsers(w http.ResponseWriter, r *http.Request) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	count := len(s.clients)
	w.Write([]byte(strconv.Itoa(count)))
}

func (s *Server) countActiveUsers(w http.ResponseWriter, r *http.Request) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	w.Write([]byte(strconv.Itoa(s.countActive)))
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	log.Println("Новое соединение")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Ошибка при обновлении соединения:", err)
		return
	}

	// Создаем клиента и добавляем его в карту
	client := &Client{conn: conn, inCall: false}

	s.mutex.Lock()
	s.clients[conn] = client
	s.mutex.Unlock()

	log.Println("Новый клиент подключен. Всего клиентов:", len(s.clients))

	defer func() {
		s.mutex.Lock()
		defer s.mutex.Unlock()

		// Если клиент был в звонке, уменьшаем счетчик активных
		if client.inCall {
			s.countActive--
			if s.countActive < 0 {
				s.countActive = 0
			}
			log.Println("Клиент в звонке отключен. Активных звонарей:", s.countActive)
		}

		delete(s.clients, conn)
		conn.Close()
		log.Println("Клиент отключен. Всего клиентов:", len(s.clients))
	}()

	for {
		var msg WSMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("Ошибка при чтении сообщения:", err)
			break
		}

		s.mutex.Lock()
		switch msg.Action {
		case "call_started":
			if !client.inCall {
				client.inCall = true
				s.countActive++
				log.Println("Новый звонок начат. Активных звонарей:", s.countActive)
			}
		case "call_ended":
			if client.inCall {
				client.inCall = false
				s.countActive--
				if s.countActive < 0 {
					s.countActive = 0
				}
				log.Println("Звонок завершен. Активных звонарей:", s.countActive)
			}
		default:
			// Ретрансляция сообщений другим клиентам
			for _, otherClient := range s.clients {
				if otherClient.conn != conn {
					err := otherClient.conn.WriteJSON(msg)
					if err != nil {
						log.Println("Ошибка при отправке сообщения:", err)
						// Обработка отключения клиента будет в defer
					}
				}
			}
		}
		s.mutex.Unlock()
	}
}
