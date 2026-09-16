# uWaveSuite

PWA приложение для работы с гидроакустическими модемами **uWave** (UC&NL).

Работает через Web Serial API в браузере (Chrome, Edge).

## Возможности

- 🔌 Подключение к модему uWave (CDMA / Logical режимы)
- 🎯 Трекинг устройств (CDMA каналы или логические адреса)
- 📊 Взвешенный режим опроса (глубина чаще, температура/напряжение реже)
- 📡 USBL — определение позиции по азимуту и дальности
- 📏 Линейка и графическая шкала на карте
- 🌐 Топопривязка (ручная или через GNSS)
- 📡 **VLBL** — дальномерный режим (определение координат маяков по дальностям с разных точек)
- 💬 **Чат** — единая панель для отправки/приёма сообщений:
  - Короткие запросы (CDMA и логические)
  - Передача пакетов (до 64 байт)
  - Приём асинхронных сообщений (ASYNC_IN, PT_RCVD)
  - Уведомления о доставке/недоставке пакетов
  - Счётчик непросмотренных сообщений
- 📍 **POI (точки интереса)** — метки на карте с загрузкой/экспортом CSV
- 💾 Логирование NMEA обмена
- 📤 Экспорт CSV, KML, JSON, NMEA GGA, DXF
- ▶ Воспроизведение логов с изменением скорости
- 🎨 6 тем оформления
- 📱 Поддержка мобильных устройств (PWA, Android через UCNLLauncher)

## Режимы работы

### Трекинг

- **CDMA режим** — устройства адресуются по паре кодовых каналов (Tx, Rx)
- **Логический режим** — устройства адресуются по адресу (0-254)

Режим команд:
- **Взвешенный (5:1:1)** — глубина опрашивается в 5 раз чаще
- **Циклический** — равномерное чередование команд
- **Одиночный** — только одна команда

### VLBL (дальномерный режим)

Определение координат маяков по дальностям с разных точек. Требуется GNSS
и движение вокруг маяков.

- Автоматический сбор измерений при движении
- Авторешение каждые N измерений
- Умный отбор баз по угловому разбросу
- Отображение решения и качества (HDOP, радиальная ошибка)

## Требования

- Браузер с поддержкой Web Serial API:
  - Chrome / Edge (desktop)
  - Chrome для Android
- Модем uWave с USB-UART адаптером
- (Опционально) GNSS-приёмник для VLBL и географического режима

## Быстрый старт

1. Откройте [uWaveSuite](https://ucnl.github.io/uWaveSuite/)
2. Нажмите **🔌 uWave** и выберите COM-порт
3. Устройство будет обнаружено автоматически
4. Настройте трекинг: **Инструменты → Настройка трекинга**
5. Добавьте устройства (CDMA каналы или логические адреса)
6. Нажмите **▶ Трекинг** для запуска

## Сборка

Не требуется — чистый HTML/CSS/JS.

Для локального запуска через HTTP (рекомендуется для работы Web Worker):

```bash
python -m http.server 8080
# или
npx http-server -p 8080
```

## Структура проекта

uWaveSuite/
│   app.js
│   CHANGELOG.md
│   dh-filter-xyz.js
│   dh-filter.js
│   export.js
│   geo-utils.js
│   gnss-parser.js
│   haversine.js
│   index.html
│   LICENSE
│   log-analyzer.js
│   log-storage.js
│   logger.js
│   manifest.json
│   median.js
│   poi-manager.js
│   README.md
│   serial-manager.js
│   settings-storage.js
│   smoother-xyz.js
│   smoother.js
│   sound-speed.js
│   styles.css
│   sw.js
│   tracks.js
│   utm.js
│   uw-device-manager.js
│   uw-port.js
│   uw-protocol.js
│   uw-queue-manager.js
│   uw-tracking-engine.js
│   uw-usbl-solver.js
│   uw-vlbl-measurements.js
│   uw-vlbl-solver.js
│   uw-vlbl-store.js
│   uw-vlbl-worker.js
│   vincenty.js
│   webview-stub.js
│
├───docs
│       guide.md
│
├───icons
│       icon-192.png
│       icon-512.png
│       icon-maskable-512.png
│
├───modules
│       ui-addressing.js
│       ui-cdma.js
│       ui-chat.js
│       ui-console.js
│       ui-devices.js
│       ui-export.js
│       ui-map.js
│       ui-ruler.js
│       ui-settings.js
│       ui-themes.js
│       ui-topo.js
│       ui-tracking.js
│       ui-vlbl.js
│
└───tools
        coord-converter.html

## Лицензия

GNU GPL v3.0 — см. [LICENSE](LICENSE)

