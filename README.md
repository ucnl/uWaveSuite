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
- 📡 VLBL — дальномерная навигация (TOA)
- 📦 Пакетная передача (до 64 байт)
- 💾 Логирование NMEA обмена
- 📤 Экспорт CSV, KML, JSON, NMEA GGA, DXF
- ▶ Воспроизведение логов с изменением скорости

## Требования

- Браузер с поддержкой Web Serial API:
  - Chrome / Edge (desktop)
  - Chrome для Android
- Модем uWave с USB-UART адаптером

## Быстрый старт

1. Откройте [uWaveSuite](https://ucnl.github.io/uWaveSuite/)
2. Нажмите **🔌 uWave** и выберите COM-порт
3. Устройство будет обнаружено автоматически
4. Настройте трекинг: **Инструменты → Настройка трекинга**
5. Добавьте устройства (CDMA каналы или логические адреса)
6. Нажмите **▶ Трекинг** для запуска

## Сборка

Не требуется — чистый HTML/CSS/JS.

Для локального запуска:

```bash
# Просто откройте index.html в Chrome
# Или используйте простой HTTP сервер:
python -m http.server 8080
```

## Структура проекта

```
uWaveSuite/
├── index.html          # Главная страница
├── styles.css          # Стили
├── app.js              # Главный модуль
├── uw-protocol.js      # Протокол uWave (NMEA)
├── uw-port.js          # Драйвер порта
├── uw-tracking-engine.js
├── uw-device-manager.js
├── uw-usbl-solver.js   # USBL математика
├── uw-vlbl-solver.js   # VLBL решатель
├── settings-storage.js
├── modules/            # UI модули
└── tools/              # Утилиты
```

## Лицензия

GNU GPL v3.0 — см. [LICENSE](LICENSE)

## Ссылки

- [uWave: Документация](https://docs.unavlab.com/underwater_acoustic_modems_ru.html#uwave)
- [uWaveSuite: GitHub](https://github.com/ucnl/uWaveSuite/)
