# Искра API SDK

SDK для интеграций с API Искры: Node.js/TypeScript и Python (sync/async).
Чат, фоновые задачи, файлы, навыки, специалисты, настройки исполнения,
Память и публикация приложений доступны через API-ключ.

| Пакет | Среда | Руководство |
|---|---|---|
| `@iskradevs/apisdk` | Node.js 22/24, TypeScript, ESM/CommonJS | [Node.js](node/README.md) |
| `iskra-api-sdk` / `iskra_sdk` | Python 3.11+, sync/async | [Python](python/README.md) |

Первая версия — `0.1.0`. Установка из этого репозитория:

```bash
git clone https://github.com/iskradevs/apisdk.git
cd apisdk/node
npm ci
npm pack
# В каталоге своего Node.js приложения:
# npm install /absolute/path/to/apisdk/node/iskradevs-apisdk-0.1.0.tgz
```

Python устанавливается из подкаталога:

```bash
python -m pip install ./apisdk/python
```

Публикация пакетов в npm/PyPI оформляется отдельно. Команды установки выше
работают с публичным исходником и не требуют регистрации пакета в registry.

## Первый запрос

Создайте ключ в интерфейсе Искры и передайте его своему серверному приложению.
`baseUrl` / `base_url` задаётся явно: URL вашей установки, без `/api/v1`.
Например, для dev-стенда — `https://dev.iskracloud.ru`.

```typescript
import { Iskra } from '@iskradevs/apisdk';

const iskra = new Iskra({
  apiKey: process.env.ISKRA_API_KEY!,
  baseUrl: process.env.ISKRA_BASE_URL!,
});
const defaults = await iskra.execPlan.defaults();
console.log(defaults.options);
```

```python
import os
from iskra_sdk import Iskra

with Iskra(api_key=os.environ["ISKRA_API_KEY"], base_url=os.environ["ISKRA_BASE_URL"]) as iskra:
    defaults = iskra.exec_plan.defaults()
    print(defaults["options"])
```

Для фотографий и длительных задач используйте загрузку файла и `runs.create`,
затем `runs.wait` или события прогресса. Закрытие соединения или timeout ожидания
не отменяет серверный прогон; отмена вызывается явно. SDK не повторяет POST
автоматически: повтор синхронного чата может выполнить ещё один ход.

## Контракт и примеры

- [Маршруты, права и особенности API](reference/api.md).
- [Node.js примеры](node/examples/).
- [Python примеры](python/examples/).
- `contracts/` — одинаковые HTTP fixtures для проверки обоих клиентов.
- [Сценарии на работающем стеке](integration/README.md) — проверка установленных
  пакетов через настоящий API, включая файлы, контекст и ограничения ключа.

Каталоги отражают доступность текущего профиля и права ключа. Для Памяти нужны
явно выданные `memory:read` / `memory:write`; права на файлы разговора не дают
доступ к Памяти. Управление ключами выполняется в интерфейсе Искры.

## Разработка и обратная связь

Этот публичный репозиторий — готовая копия SDK. Разработка ведётся в основном
репозитории Искры, после проверки публикуется очередная версия. Ошибки и
предложения можно сообщать в Issues; правки переносятся в основной источник.
`SOURCE_REVISION` связывает публикацию с проверенной версией исходника.

## Лицензия

MIT — [LICENSE](LICENSE).
