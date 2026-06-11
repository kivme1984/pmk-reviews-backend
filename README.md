# PMK reviews collector

Сервис хранит последнее успешное состояние рейтингов и отдаёт Tilda только
публичные данные:

- `GET /api/reviews/summary`
- `GET /api/reviews/latest`
- `GET /api/reviews/events/latest`
- `POST /api/reviews/refresh?secret=...`

## Запуск

1. Скопировать `.env.example` в `.env` на сервере.
2. Добавить URL нормализованных серверных feeds.
3. Не размещать `.env`, API-ключи и токены в Tilda.
4. Запустить `node server.mjs`.

Нормализованный feed Яндекс/Avito/VK должен возвращать JSON:

```json
{
  "rating": 5,
  "reviewCount": 100,
  "reviews": [
    {
      "id": "source-review-id",
      "author": "Имя",
      "text": "Текст реального отзыва",
      "rating": 5,
      "publishedAt": "2026-06-10T10:00:00Z",
      "url": "https://..."
    }
  ]
}
```

Если источник временно недоступен, сервис сохраняет предыдущие данные и
помечает их как `stale`. Если источник ещё не подключён, frontend получает
`unavailable` без выдуманного рейтинга.

Для Avito по умолчанию используются публично отображаемые рейтинг, количество
и последние отзывы со страницы компании. Если задан `PMK_AVITO_FEED_URL`,
он имеет приоритет.
