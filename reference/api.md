# API Искры для Node.js и Python

Пакеты `@iskradevs/apisdk` и `iskra-api-sdk` (импорт `iskra_sdk`) предоставляют
клиенты API Искры с авторизацией по пользовательскому ключу `isk_`.
Этот справочник и [общие фикстуры](../contracts/README.md) описывают снимок
API ветки разработки на **14 сентября 2026 года**, выбранный для SDK `0.1.0`.
Поддержка снимка SDK не гарантирует, что соответствующий backend уже
установлен в конкретном production-контуре. Доступные маршруты зависят от
версии и конфигурации установки; проверьте нужные операции на своём контуре.

## Подключение и авторизация

Конструктор принимает явные `apiKey`/`api_key` и `baseUrl`/`base_url`.
Базовый адрес — origin с необязательным префиксом установки, например
`https://iskra.example/company`, без `/api/v1` или `/api/openai/v1`.
SDK сохраняет префикс и отправляет `Authorization: Bearer <key>` при каждом
вызове. Переходы по HTTP redirect отключены. Сегменты путей и параметры
query кодируются раздельно.

Ключ создаётся в интерфейсе Искры и принадлежит одному рабочему профилю.
Scopes ограничивают права этого профиля; наличие scope не заменяет ACL
ресурса. Ключ не получает административных привилегий. Управление ключами
требует браузерную сессию и не входит в SDK. Viewer JWT приложений и
`/api/v1/app/secrets/{slot}` — отдельная поверхность авторизации.

`X-Iskra-Run-As` требует `run:delegate` и допустимый профиль той же
организации. Один и тот же заголовок нужен на всей цепочке: upload → create
run → GET/events/cancel → download/delete. Без него запись другого профиля
может отвечать `404`. Apps отклоняет этот заголовок с `400 run_as_forbidden`
даже у ключа с правом делегирования.

## Маршруты

Пути ниже добавляются к базовому адресу. `+` означает, что нужны оба scope.
Для хода с ручным `iskra_exec.skills` дополнительно нужен `skills:run`, для
вложений — `files:write`, для постоянного контекста — права Памяти, описанные
ниже. Сопоставление Python методов находится в [routes.json](../contracts/routes.json).

| SDK Node.js | HTTP | Базовые scopes |
|---|---|---|
| `chat.create` | `POST /api/v1/chat` | `chat:run` |
| `chat.delete` | `DELETE /api/v1/chat/{conversation_id}` | `chat:run` |
| `files.upload` | `POST /api/v1/chat/files` | `files:write` |
| `files.download` | `GET /api/v1/chat/{conversation_id}/files/{path...}` | `files:read` |
| `runs.create` | `POST /api/v1/runs` | `chat:run` |
| `runs.get` | `GET /api/v1/runs/{run_id}` | `chat:run` |
| `runs.cancel` | `DELETE /api/v1/runs/{run_id}` | `chat:run` |
| `runs.events` | `GET /api/v1/runs/{run_id}/events` | `chat:run` |
| `skills.list` | `GET /api/v1/skills` | `skills:run` |
| `specialists.list` | `GET /api/v1/specialists` | `chat:run` |
| `execPlan.defaults` | `GET /api/v1/exec-plan/defaults` | `chat:run` |
| `conversations.create` | `POST /api/v1/conversations` | `chat:run` |
| `conversations.context` | `GET /api/v1/chat/{conversation_id}/context` | `chat:run` + `memory:read` |
| `conversations.setWorkspace` | `PUT /api/v1/chat/{conversation_id}/workspace` | `chat:run` + `memory:read` + `memory:write` |
| `conversations.clearWorkspace` | `DELETE /api/v1/chat/{conversation_id}/workspace` | `chat:run` + `memory:read` + `memory:write` |
| `conversations.addMemoryRef` | `POST /api/v1/chat/{conversation_id}/memory-refs` | `chat:run` + `memory:read` |
| `conversations.updateMemoryRef` | `PATCH /api/v1/chat/{conversation_id}/memory-refs/{ref_id}` | `chat:run` + `memory:read` |
| `conversations.deleteMemoryRef` | `DELETE /api/v1/chat/{conversation_id}/memory-refs/{ref_id}` | `chat:run` + `memory:read` |
| `memory.browse` | `GET /api/v1/memory/browse` | `memory:read` |
| `memory.collections` | `GET /api/v1/memory/collections` | `memory:read` |
| `memory.collectionMembers` | `GET /api/v1/memory/collections/{collection_id}/members` | `memory:read` |
| `memory.createRoot` | `POST /api/v1/memory/resources/roots` | `memory:read` + `memory:write` |
| `memory.createFolder` | `POST /api/v1/memory/resources/folders` | `memory:read` + `memory:write` |
| `memory.upload` | `POST /api/v1/memory/resources/files` | `memory:read` + `memory:write` |
| `memory.download` | `GET /api/v1/memory/resources/files/{file_id}/content` | `memory:read` |
| `apps.create` | `POST /api/v1/apps` | `apps:publish` |
| `apps.publishVersion` | `POST /api/v1/apps/{app_id}/versions` | `apps:publish` |
| `apps.get` | `GET /api/v1/apps/{app_id}` | `apps:publish` |
| `openai.models` | `GET /api/openai/v1/models` | `chat:run` |
| `openai.chatCompletions` | `POST /api/openai/v1/chat/completions` | `chat:run` |

## Ход и план исполнения

`chat.create` принимает обязательный `message` и необязательные
`conversation_id`, `instructions`, `files`, `ttl_seconds`, `policy`,
`include_reasoning`, `response_format`, `iskra_exec`.
`runs.create` принимает те же поля, но файлы передаются только по ID версии.

Успешный native-ответ содержит `conversation_id`, `status`, `usage` и, если
они есть, `message_id`, `answer`, `expires_at`, `files`, `output`.
При `status: interaction_required` приходит `interaction` с `tool_call_id`
и `inputs: [{name,label,type,required}]`. Значения полей следующего хода
передаются в `policy.inputs`. Пустой список `inputs` означает подтверждение
без полей: оно требует действия в веб-интерфейсе, `policy.inputs` не выражает
согласие. Usage — информационный счётчик токенов, не точный расчёт оплаты.

`iskra_exec` задаёт настройки одного запроса:

| Поле | Смысл |
|---|---|
| `profile_id` | Разрешённый организации LLM-профиль; это не профиль владельца ключа |
| `complexity` | `simple`, `normal` или `hard` |
| `specialist_id` | ID основного специалиста из каталога |
| `secondary_specialist_id` | Второй отличный специалист вместе с основным; «Общий» в паре недопустим |
| `skills` | Массив bundle навыков; `null`/отсутствие сохраняет автоматический подбор, `[]` выбирает пустой ручной набор |
| `antonym` | Булево значение приватного режима в пределах политики контура |

Отсутствующие настройки не превращаются в пустые или ложные значения.
Неподдержанный уровень отклоняется; `auto` встречается в превью плана, но не
является допустимым значением запроса `complexity`. Ручной набор навыков должен
включать все обязательные bundles. SDK сохраняет явный выбор и передаёт
проверку доступности и политики серверу.

`skills.list` возвращает `{skills:[...]}`. Строка содержит `bundle`, `name`,
`title`, `description`, `version`, `mode`, `available`, `requires_setup`,
`mandatory`, `setup_state`. Для запуска проверьте `available: true` и
`setup_state: ready`; другие состояния — `missing`, `invalid`, `unknown`.
`requires_setup` указывает необходимость настройки, а не её готовность.
В запросе используется `bundle`. Настройка и установка навыков выполняются
в интерфейсе; bearer-маршрутов установки нет.

`specialists.list` возвращает `{specialists:[{id,title,description,icon}]}`.
`execPlan.defaults` возвращает `{plan,pins,version,options}` до создания
разговора: `version` равна `0`, `pins.model`, `pins.skills` и `pins.specialist`
равны `null`. `plan` содержит блоки `model`, `specialist`, `skills`, `memory`,
`context`, `version`; `options` — уровни сложности, `router_enabled`,
`antonym`, `mandatory_bundles`, `memory.folder_ids`, `specialists`.
`options.antonym` принимает `editable`, `mandatory` или `policy`.
Коэффициент уровня интерпретируется вместе с `coeff_known`.
Это превью автоматического выбора, а не полный каталог навыков или
LLM-профилей. Отдельного bearer GET-каталога LLM-профилей нет;
`openai.models` перечисляет виртуальные модели OpenAI-фасада.

## Асинхронные прогоны и SSE

Создание прогона возвращает `202` с `run_id`, `conversation_id`, `status` и
`expires_at`. Здесь `expires_at` — фиксированный **дедлайн прогона**.
В chat/upload/create conversation поле с тем же именем относится к **TTL
разговора** и продлевается отдельно при ходе или загрузке.

`runs.get(run_id)` возвращает `run_id`, `conversation_id`, `status`,
`created_at`, nullable `started_at`/`finished_at`, nullable `result`/`error`,
`events`, `next_after`. Активные статусы — `queued`, `running`; терминальные —
`completed`, `failed`, `cancelled`, `interaction_required`.
`result` успешного прогона сохраняет native-ответ. `error` имеет `code` и
`message`. Статус HTTP 200 сам по себе не означает успешное выполнение задачи.

При polling передавайте в следующий `after` именно `next_after`: пропущенная
запись ленты может занимать позицию и не попадать в массив `events`.
`runs.wait` ограничивает ожидание общим deadline и заканчивает его на любом
терминальном статусе, сохраняя полный результат. Timeout клиента не отменяет
серверный прогон. Для отмены служит явный `runs.cancel`; успех — **200 JSON**
`{run_id,conversation_id,status:"cancelled"}`, завершённый прогон — `409
already_finished`.

`runs.events` использует `Accept: text/event-stream`. SSE содержит
`id: <позиция>`, `event: <kind>`, `data: <JSON>` и пустую строку.
`content` несёт `{len:N}` — накопленную длину ответа, `tool` — `{name:...}`.
Это прогресс, а не текстовые токены. Терминальные события несут
`{status:"completed"}` или другой терминальный статус и закрывают поток.
После завершения прочитайте `runs.get` для полного результата.

При восстановлении используйте `after = последний id + 1`. Сервер также
понимает `Last-Event-ID`; явный `after` имеет приоритет. При отсутствующей
ленте завершённого прогона может прийти синтетический терминальный `id: -1`;
следующий курсор тогда `0`. Комментарии keepalive не являются событиями.
SDK не выполняет бесконечное переподключение. EOF до терминального события
следует обработать как обрыв, сохранив последний курсор.

Если контекст изменился между постановкой в очередь и исполнением, прогон
может завершиться `failed/context_changed` до хода. Новый admission создаётся
новым запросом. После рестарта выполнявшийся прогон может оставаться
`running` до своего дедлайна, затем стать `failed/interrupted`; повтор такого
прогона требует учесть возможные уже выполненные действия.

## Память и контекст разговора

`memory:write` не подразумевает `memory:read`; операции записи требуют оба.
`files:read`/`files:write` дают доступ к файлам разговора и не открывают
постоянную Память. Scope `memory:read` требуется для чтения связанной с ней
истории и результата даже после снятия подключения. Для сохранённого
write-подключения при запуске нужны оба Memory scope, в том числе если ACL
сузился до read или коллекция пуста. Сервер повторно проверяет текущие ACL.

`conversations.create({})` создаёт разговор без сообщения и запуска модели.
Необязательные поля — `ttl_seconds`, `workspace_directory_id`, `memory_refs`.
Элемент `memory_refs` задаёт `access_mode: read|write` и ровно одну цель:
`locator: {directory_id,folder_id?}` либо `collection_id` своей коллекции.
ID должны быть canonical UUID. Допускается до 100 целей без дублей; выбранный
workspace не подключается повторно отдельной ссылкой.

Ответ `201` содержит `conversation_id`, `expires_at`, `workspace`,
`references`. GET context и операции выбора workspace возвращают тот же
снапшот контекста без создания разговора. Без выбранного workspace
`workspace.directory_id` отсутствует, а `references` равно `[]`.
`workspace` остаётся объектом; отсутствие ID не следует заменять выдуманным
UUID или `null`. У reference на коллекцию есть `collection_id`, а locator
может содержать пустой `directory_id`: коллекция не является одной папкой.
Признаки `can_choose`, `can_release`, `can_write`, `can_remove`,
`can_change_mode`, `access_denied`, `resource_denied` рассчитывает сервер.

Выбрать личный workspace или снять его можно до первого сообщения/файла.
Повтор того же выбора допустим; замена занятой папки или параллельная
мутация может дать `409`. Снятие workspace возвращает **200 со снапшотом**;
удаление memory reference — **204 без тела**. Изменение контекста во время
активного хода ограничивается серверной блокировкой.

`memory.browse` без родителя возвращает корни. `directory_id` и необязательный
`folder_id` открывают папку. `q` задаёт глобальный поиск имени/пути и не
совмещается с родителем. `target_kind: folder|file` применим только к поиску.
`sort` — `name|created_at`, `direction` — `asc|desc`, `limit` — 1–100.
`origin` — `personal|project|chat|synced|shared`. Для `candidates: true` нужен
`q`; этот режим не совмещается с `cursor`, родителем и `origin`.
Ответ содержит `entries`, `complete`, `materialization_file_limit`, иногда
`breadcrumbs`, `next_cursor`, `pinned_roots`. Следующий cursor непрозрачен и
используется с теми же параметрами поиска. Предел материализации берётся из
ответа конкретной установки.

Коллекции и их состав доступны для чтения. Bearer API не создаёт, не
переименовывает и не меняет коллекции. Для постоянной записи:

| Операция | Запрос | Ответ |
|---|---|---|
| `memory.createRoot` | `{name}` | `201`, директория с `id` |
| `memory.createFolder` | `{directory_id,path}` | `201`, папка с `id`, `directory_id`, `path` |
| `memory.upload` | Multipart: `directory_id`, `file`; необязательные `path`, `conflict_policy` | `201`, `{file,version}` |
| `memory.download` | ID файла и query `directory_id`; при необходимости `download=1` | Байты файла |

Путь upload по умолчанию — имя файла. `conflict_policy: create` отклоняет
конфликт, `rename` выбирает свободное имя. `file.id` и `version.id` различны.
Для Memory download нужен **ID файла**, а не версии. Query `format` позволяет
запросить поддерживаемое сервером представление; обычная загрузка байтов не
задаёт этот параметр. Сохранённые корни, файлы и версии переживают удаление
разговора и его TTL.

## Файлы разговора

`files.upload` отправляет multipart с повторяющимся полем `file` и
необязательными `conversation_id`, `ttl_seconds`. Ответ содержит
`conversation_id`, `expires_at`, `files: [{id,name,size}]`.
Этот `id` — **ID версии**, пригодный для `files: [{id}]` в следующем ходе
**того же разговора**. Передача версии в другой разговор или повторная
привязка к другому сообщению приводит к `404 invalid_file`: действует
правило первого использования.

Native chat принимает также `{name,mime,content_base64}`. Элемент вложения
задаёт ровно один источник: `id` или `content_base64`. Async принимает только
ID и отклоняет inline-файл с `400 use_file_upload`. Для нового использования
уже привязанного файла загрузите новую версию.

Артефакты ответа имеют `{name,download_url}` и не являются входными file ID.
Скачивание SDK строится по `conversation_id` и относительному `path`; ключ не
следует прикреплять к произвольному внешнему `download_url`. После удаления
разговора его URL артефакта недоступен. Сохранённый в личной папке файл
остаётся доступен через Memory API с текущим ACL.

## OpenAI-совместимый фасад

`openai.models` возвращает `{object:"list",data:[...]}`. При доступном только
агенте каталог содержит `iskra`. При включённом raw-режиме — `iskra-agent`,
`iskra-llm`, `iskra-llm-fast`, `iskra-llm-balanced`, `iskra-llm-powerful`.
`iskra` остаётся алиасом агента. Каталог моделей не заменяет проверку scope
`llm:raw` для вызова raw-моделей.

Агент принимает `messages`, `model`, `stream`, `stream_options.include_usage`
и расширения `conversation_id`, `policy`, `iskra_exec`. Ответ сохраняет
OpenAI `choices`, `usage` и расширения Искры: `conversation_id`, `files`,
`interaction`. История первого запроса используется для инициализации
разговора; последующие ходы используют его серверную историю.

| Возможность | `iskra` / `iskra-agent` | `iskra-llm*` |
|---|---|---|
| Минимальные scopes | `chat:run` | `chat:run` + `llm:raw` |
| Серверный разговор и инструменты Искры | Да | Прокси-запрос без серверного разговора |
| `conversation_id`, `policy`, `iskra_exec` | Поддерживаются | Отклоняются |
| Клиентские `tools` | Отклоняются | Передаются через gateway |
| `response_format` | Только `text` | `text` или `json_object` |
| `json_schema` | Отклоняется | Отклоняется |

Оба режима отклоняют `n > 1`, audio, нетекстовые modalities и logprobs.
В агентском режиме sampling-поля не управляют серверным агентским конвейером.
Для structured output по JSON Schema используйте native chat/runs.

OpenAI SSE отличается от runs: каждое `data` содержит completion chunk,
а `data: [DONE]` завершает поток. Промежуточный `finish_reason` может быть
`null`. Расширения Искры появляются в финальном chunk; при `include_usage`
отдельный usage chunk имеет пустой `choices`. Ошибка после начала стрима
может прийти `data: {"error":...}` при уже отправленном HTTP 200; она не
является успешным completion chunk.

## Публикация Apps

`apps.create` принимает multipart `bundle` и необязательное поле `title`.
`apps.publishVersion` принимает `bundle` для известного app ID. Query
`activate` по умолчанию `true`; `false` публикует без запроса активации.
Бандл должен соответствовать формату Apps конкретной версии сервера.

Ответ содержит `id`, `slug`, `version`, `state`, `activated`,
`approval_pending`, иногда `current_version`. Готовая публикация возвращает
`201`; проверяемая — `202`, `state: probing`. Успешное сохранение версии
не всегда означает смену активной версии.

`409 approval_required` означает: версия **уже опубликована**, но публичная
активация требует одобрения. Problem `params` содержит `version` и, если есть,
`current_version`; app ID и `state` в эту ошибку не добавляются. Сохраните
известный app ID, получите одобрение и выполните необходимое действие в
интерфейсе. Повторная публикация той же неизменяемой версии не заменяет
активацию.

`apps.get` требует query `version` и возвращает состояние ровно этой
публикации своего приложения: `id`, `slug`, `title`, `access`, `status`,
`current_version?`, `approved_version?`, `publication`.
Последний объект содержит `version`, `state`, `activate_on_ready`, иногда
`probe_error`, `outcome`. У GET `publication.state` принимает `pending`,
`ready`, `purged`, `pruned`: это другой словарь, чем `state: probing` ответа
POST. Отклонённая проверка запуска остаётся `pending` с непустым
`probe_error`. Готовая или вытесненная версия (`ready`/`pruned`) сохраняет
outcome `activated`, `not_requested` или `approval_pending`.
Чтение не включает секреты, логи,
экземпляры приложения или список других версий.

## Ошибки, повторы и время

HTTP-ошибка сохраняет статус, машинный код, request ID, `Retry-After` и
исходное тело. Три формата API:

| Формат | Основные поля |
|---|---|
| Problem JSON | `type`, `title`, `status`, `detail`, `instance`, `code`, `action`, `request_id`, `params` |
| Native | `{error:{code,message}}`, иногда верхнеуровневые `conversation_id`, `answer` |
| OpenAI | `{error:{message,type,code}}` |

Problem `detail` может быть пустым; машинный смысл остаётся в `code`,
`action`, `params`. HTML или некорректный JSON от прокси также должен давать
HTTP-ошибку со статусом и ограниченным текстом. Сетевая ошибка и timeout
отличаются от ответа HTTP с кодом отказа.

Native `422 structured_output_failed` означает, что ход состоялся, но
приведение к JSON Schema не удалось: тело сохраняет `conversation_id` и
исходный `answer`. Async отражает это как `status: failed`,
`error.code: structured_output_failed`, `result: {answer:...}`, без `output`.
Сохраняйте частичный результат при обработке ошибки.

Автоматические повторы SDK отключены. У `POST /api/v1/chat` и OpenAI agent
`Idempotency-Key` дедуплицирует **создание разговора**, а не исполнение хода:
повтор может создать ещё один ход. Повтор `POST /api/v1/runs` с тем же ключом
возвращает прежний `run_id`; для нового исполнения терминально завершённой
задачи нужен новый ключ. Upload, создание разговора и публикация Apps не
имеют обещания безопасного автоматического повтора.

`429` и `503 platform_cooldown` могут сопровождаться `Retry-After`.
Учтите этот интервал перед осознанным повтором. После сетевого обрыва
изменяющего запроса сначала выясните, принят ли он сервером. Во время
обновления чтение статуса, отмена и обслуживание разговоров остаются отдельными
операциями; cooldown блокирует приём новых ходов.

Документированный HTTP timeout SDK по умолчанию — **120 секунд**, его можно
изменить. `runs.wait` имеет отдельный общий deadline. В данном снимке сервера
синхронный ход ограничен 90 секундами, async-прогон — 15 минутами от создания.
TTL разговора по умолчанию 1 час, максимум 24 часа; он независим от срока
ключа, дедлайна прогона и времени ожидания клиента. Эти серверные значения
относятся к описанному снимку и не заменяют проверку установленного релиза.
