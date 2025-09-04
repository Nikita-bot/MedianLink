# Этап 1: Сборка Go-приложения
FROM golang:alpine AS builder

WORKDIR /app

# Устанавливаем зависимости для сборки
RUN apk add --no-cache git

# Копируем файлы проекта
COPY . .

# Скачиваем зависимости и компилируем Go-приложение
RUN go mod download

RUN go build -ldflags="-s -w" -o /app/server ./main.go

# Этап 2: Минимальный образ для запуска
FROM alpine:latest

RUN apk update --no-cache

WORKDIR /app

COPY ./frontend /app/frontend

# Копируем скомпилированный бинарник из builder-образа
COPY --from=builder /app/server /app/server
# Открываем порт 8888
EXPOSE 8888

# Запускаем сервер
CMD ["/app/server"]
