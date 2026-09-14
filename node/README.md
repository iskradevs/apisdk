# @iskradevs/apisdk

TypeScript/JavaScript SDK для Headless API Искры. Node.js 22 и 24,
ESM и CommonJS, строгие типы TypeScript. Версия SDK: **0.1.0**.

```bash
npm install @iskradevs/apisdk
```

```ts
import { Iskra } from '@iskradevs/apisdk';

const iskra = new Iskra({
  apiKey: process.env.ISKRA_API_KEY!,
  baseUrl: process.env.ISKRA_BASE_URL!,
});
const answer = await iskra.chat.create({ message: 'Привет!' });
console.log(answer.answer);
```

CommonJS: `const { Iskra } = require('@iskradevs/apisdk')`.
`apiKey` и `baseUrl` обязательны. `baseUrl` — адрес контура с необязательным
префиксом прокси, например `https://example.org/iskra`, без `/api/v1`.
SDK добавляет маршруты API, сохраняя префикс. Redirect-ответы возвращаются
как ошибки HTTP. Токен хранится в приватном поле и исключён из inspection.

SDK рассчитан на пользовательские ключи `isk_`. Управление ключами через
браузерную сессию, viewer JWT и секреты приложений в него не входят.
Доступность маршрутов зависит от версии и настроек установленной Искры;
сервер остаётся источником прав, квот и состояния.

## Настройка запросов

Конструктор принимает `timeoutMs` (120000 по умолчанию), `runAs` и
инъекцию `fetch` для транспорта или тестов. Последний аргумент методов —
`RequestOptions`: `signal`, `timeoutMs`, `idempotencyKey`, `runAs`.
JSON-поля запросов и ответов используют серверные имена `snake_case`.

```ts
const controller = new AbortController();
await iskra.chat.create(
  { message: 'Продолжи анализ', conversation_id: 'conversation-id' },
  { signal: controller.signal, idempotencyKey: 'operation-001' },
);
```

**Автоматических повторов нет**, включая POST с `Idempotency-Key`.
Для native chat/OpenAI agent этот ключ дедуплицирует создание разговора,
но повторный запрос может выполнить ещё один платный ход. Async runs
имеет отдельный серверный контракт повторного получения `run_id`.

`runAs` передаёт `X-Iskra-Run-As`. Для одного процесса загрузки и исполнения
удобно создать отдельный клиент с фиксированным `runAs`: тот же профиль нужен
на upload, create/get/events/wait/cancel и download. Переопределение в
`RequestOptions` действует на один вызов и все опросы внутри `wait`.
Apps-маршруты отклоняют делегирование локальным `TypeError`.

## Файлы и асинхронный прогон

```ts
import { openAsBlob } from 'node:fs';

const uploaded = await iskra.files.upload({
  files: [{ name: 'brief.pdf', data: await openAsBlob('./brief.pdf') }],
});
const run = await iskra.runs.create({
  message: 'Подготовь выводы по документу',
  conversation_id: uploaded.conversation_id,
  files: uploaded.files.map(file => ({ id: file.id })),
}, { idempotencyKey: 'brief-analysis-001' });
const finished = await iskra.runs.wait(run.run_id, { timeoutMs: 900000 });
console.log(finished.status, finished.result, finished.error);
```

`files.upload` отправляет повторяющиеся multipart-части `file`. `UploadFile`
содержит `name` и `data: Blob`; `openAsBlob` позволяет передать файл с диска
без загрузки всего файла в JS-память. Поля `conversation_id` и `ttl_seconds`
необязательны. Ответ содержит **ID версий**, пригодные для `files[].id` в
этом же разговоре. Версия привязывается к одному ходу. Native chat также
принимает `{name, mime, content_base64}`; async runs принимает только `{id}`.

`wait` опрашивает `GET /runs/{id}` с серверным `next_after`, интервалом
1000 мс и общим дедлайном 900000 мс по умолчанию. HTTP-таймаут отдельного
запроса остаётся настройкой клиента. Возвращается terminal snapshot для
`completed`, `failed`, `cancelled` и `interaction_required`; `failed` само
по себе не бросает HTTP-ошибку. Локальный таймаут или AbortSignal прекращает
ожидание, сохраняя серверный прогон. Его отменяют явным `runs.cancel(run_id)`.

Прогресс доступен через `runs.get(run_id, {after})` и SSE:

```ts
for await (const event of iskra.runs.events(run.run_id, { after: 0 })) {
  console.log(event.id, event.kind, event.data);
}
```

SSE runs передаёт прогресс: `content` содержит длину ответа, а не токены.
`data` сохраняет произвольный JSON, для неизвестного текстового формата —
исходную строку. `id` сохраняется строкой. Автопереподключения нет; для
возобновления передайте `after` явно (последний seq + 1). Синтетический
terminal event может иметь ID `-1`, тогда следующий cursor — `0`.
Также поддерживается третий аргумент `{ lastEventID: '3' }`; query `after`
имеет приоритет на сервере. Терминальное событие завершает итератор;
обрыв до него возвращает `ProtocolError` с сохранением уже полученных событий.
`break` и abort освобождают тело ответа.

`files.download(conversation_id, 'reports/answer.md')` возвращает `Response`:
читайте `response.body`, `response.blob()` или `response.text()`. Для
скачивания строится разрешённый маршрут по ID и относительному пути;
`download_url` из результата не используется как произвольный адрес.
Если тело не нужно, вызовите `response.body?.cancel()`.

## Каталоги, контекст и Память

| Методы | Назначение |
|---|---|
| `skills.list()` | Навыки: bundle, available, setup_state, mandatory |
| `specialists.list()` | ID и описание специалистов |
| `execPlan.defaults()` | Превью plan, nullable pins, options без разговора |
| `conversations.create({...})` | Создать разговор без вызова модели |
| `conversations.context(id)` | Состояние workspace и подключений |
| `conversations.setWorkspace(id, {directory_id})` | Выбрать рабочую папку |
| `conversations.clearWorkspace(id)` | Снять папку пустого разговора; возвращает snapshot |
| `conversations.addMemoryRef(id, ref)` | Подключить locator или collection_id с access_mode |
| `conversations.updateMemoryRef(id, refId, {access_mode})` | Изменить режим |
| `conversations.deleteMemoryRef(id, refId)` | Снять подключение; 204 возвращает undefined |
| `memory.browse(query)` | Корни, подпапки или поиск; cursor передаётся явно |
| `memory.collections()` / `memory.collectionMembers(id)` | Читать коллекции и состав |
| `memory.createRoot({name})` / `memory.createFolder({directory_id,path})` | Создать постоянные папки |
| `memory.upload({directory_id,file,path?,conflict_policy?})` | Один файл; policy create или rename |
| `memory.download(fileId, {directory_id,...})` | Response с содержимым/preview |
| `chat.delete(conversation_id)` | Удалить эфемерный разговор |

`memory.download` использует **file.id**, а не version.id, и поддерживает
`download: '1'`, `format: 'pdf' | 'spreadsheet' | 'spreadsheet-asset'`, `asset`.
`memory:write` не включает `memory:read`; запись требует обоих scopes.
Файлы Памяти постоянные: удаление разговора их не удаляет. `files:read/write`
дают доступ к файлам разговора и не открывают Память.

`iskra_exec.skills` передаётся без изменений: отсутствующее поле или `null`
сохраняет автоматический выбор; `[]` явно выбирает пустой набор и допустим
лишь при отсутствии обязательных навыков. Иначе сервер возвращает
`403 mandatory_skill_required`. Для ручного набора используйте `bundle`,
проверяйте `available`, `setup_state` и включайте все `mandatory` из каталога.
Обязательные bundles также перечислены в `options.mandatory_bundles` ответа
`execPlan.defaults()`. SDK сам не меняет набор.
Явное `antonym: false` сохраняется.

`interaction_required` — отдельный исход. Значения запрошенных полей можно
передать следующим ходом через `policy.inputs`. Подтверждение без полей
требует веб-интерфейса; пустой `inputs` не выражает согласие.

## Apps и OpenAI

```ts
const app = await iskra.apps.create({
  bundle: { name: 'bundle.zip', data: await openAsBlob('./bundle.zip') },
  title: 'Отчёт', activate: true,
});
const publication = await iskra.apps.get(app.id, { version: app.version });
```

Обновление: `apps.publishVersion(appId, {bundle, activate?})`.
Нужен scope `apps:publish`. GET возвращает состояние ровно запрошенной
публикации; `publication.state` и `probe_error` проверяются вместе.
`409 approval_required` сохраняет сведения в `APIError.rawBody.params`;
повторная отправка архива для обхода подтверждения не требуется.

```ts
const models = await iskra.openai.models();
for await (const chunk of iskra.openai.chatCompletions({
  model: 'iskra-agent', messages: [{ role: 'user', content: 'Привет!' }], stream: true,
})) {
  console.log(chunk);
}
```

OpenAI SSE возвращает JSON-чанки отдельно от events runs; `[DONE]` завершает
итератор. EOF без `[DONE]` возвращает `ProtocolError`. Ошибка после HTTP 200 приходит JSON-чанком `{error: ...}` и
сохраняется как `OpenAIStreamError`. Raw-модель требует `chat:run` + `llm:raw`;
она принимает tools/tool_choice и параметры генерации, но не расширения
conversation_id/policy/iskra_exec. Agent принимает `response_format.type=text`,
raw также принимает `json_object`. `json_schema` фасад не поддерживает;
для структурированного ответа используйте native chat/runs.

## Ошибки и типы

```ts
import { APIError, NetworkError, TimeoutError, AbortError } from '@iskradevs/apisdk';
try {
  await iskra.chat.create({ message: 'Выполни задачу' });
} catch (error) {
  if (error instanceof APIError) {
    console.error(error.status, error.code, error.requestID, error.retryAfter);
    // rawBody сохраняет native/OpenAI/problem JSON целиком, включая answer и
    // conversation_id при 422 structured_output_failed.
  } else if (error instanceof TimeoutError || error instanceof AbortError) {
    console.error('Локальное ожидание остановлено');
  } else if (error instanceof NetworkError) {
    console.error('Транспорт недоступен');
  } else throw error;
}
```

Не-JSON тело HTTP-ошибки ограничено 8192 байтами. `retryAfter` сохраняет
исходный заголовок (секунды или HTTP-date); SDK не планирует повтор.
`ProtocolError` означает неверный JSON, Content-Type SSE или обрыв потока
до завершающего события.
Секрет исключён из стандартного inspection/JSON ошибки; `rawBody` доступен
явно и может содержать чувствительный текст ответа.
Типы сохраняют неизвестные поля и произвольный `output`/event JSON.
`chat.create<MyOutput>()` типизирует output; `runs.get<MyResult>()` и
`runs.wait<MyResult>()` — result, без изменения ответа сервера.

[Примеры](./examples/) показывают весь процесс работы. Разработка из
репозитория: `npm ci`, `npm test`, `npm run test:package`.
Тесты используют общий HTTP-контракт из `../contracts` и локальный сервер,
а пакет отдельно устанавливается с проверкой ESM, CommonJS и declarations.
