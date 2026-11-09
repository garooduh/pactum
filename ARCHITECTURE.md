# Архитектура Pactum

Этот документ описывает текущее состояние репозитория и реализованные в нём потоки. Это не целевая архитектура и не план рефакторинга.

## System overview

Приложение — небольшой same-origin web stack с одним аккаунтом. Frontend раздаётся reverse proxy, API сохраняет доменные данные в SQL-базе, а неизменяемые выпуски документов — в файловом каталоге.

```text
Browser
  ├─ GET static assets ───────────────→ Caddy или Nginx ─→ React SPA
  └─ /api/* + HttpOnly session cookie → reverse proxy
                                           ↓
                                    FastAPI (1 worker)
                                      ├─ Pydantic validation
                                      ├─ SQLAlchemy ──────→ PostgreSQL / SQLite
                                      └─ document issue
                                           ├─ DOCX template + snapshot
                                           ├─ OOXML transformation ─→ DATA_DIR/<issue-id>/contract.docx
                                           └─ LibreOffice ──────────→ DATA_DIR/<issue-id>/contract.pdf
```

В API нет controller/service/repository hierarchy: route handlers в `backend/app/main.py` напрямую вызывают validation, SQLAlchemy и document functions. Во frontend нет URL router или внешнего state manager: `App` и дочерние компоненты в `frontend/src/main.tsx` управляют состоянием через React hooks.

## Components

| Компонент | Ответственность | Расположение и точки входа | Важные зависимости |
| --- | --- | --- | --- |
| React SPA | вход, профиль, реестр, редактор, autosave, выпуск/скачивание | `frontend/index.html` → `frontend/src/main.tsx` | `api.ts`, `types.ts`, `money.ts`, `requisites.ts`, React, decimal.js |
| HTTP API | security middleware, auth, CRUD, generation orchestration | `backend/app/main.py:create_app` | FastAPI, schemas, database, documents |
| Validation/domain data | DTO, defaults, реквизиты, позиции, деньги, generation validation | `backend/app/schemas.py`, `backend/app/defaults.py` | Pydantic, `Decimal` |
| Persistence | ORM tables, engine, session factory | `backend/app/database.py:connect` | SQLAlchemy, Psycopg/SQLite |
| Document pipeline | slot replacement, repeated item rows, DOCX persistence, PDF conversion | `backend/app/documents.py` | `zipfile`, `lxml`, LibreOffice CLI |
| Templates | исходники, рабочие версии, active manifest | `templates/source/`, `templates/*-v*.docx`, `templates/manifest.json` | `scripts/prepare_templates.py` |
| Gateway/runtime | static files, TLS/security headers, `/api` proxy, services | `Dockerfile`, `compose.yaml`, `deploy/` | Caddy или Nginx/systemd |
| Operations | test/package/deploy, rollback, backups, QA artifacts | `scripts/` | Bash, SSH, systemd, PostgreSQL tools, tar, sha256sum |

## Frontend architecture

### Entry point and navigation

`frontend/index.html` содержит `#root` и загружает `/src/main.tsx`. В конце `main.tsx` вызывается `createRoot(...).render(<App />)`.

`App` хранит:

- auth/bootstrap state;
- текущий view (`home`, `history`, `profile`, `editor`);
- профиль и замечания к исходным реквизитам;
- список договоров, поиск, pagination и активный договор;
- общий busy/error state и mobile menu.

Навигация не меняет URL. Перед сменой view `beforeLeave` позволяет текущему редактору или профилю сохранить несохранённые данные.

### UI organization

Большинство UI находится в одном `main.tsx`:

- `Button`, `ErrorBox`, `Field`, `Section` — локальные primitives;
- `PartyFields` — общая форма стороны;
- `Login` — вход и повторный вход после истечения сессии;
- `ProfileView` — профиль исполнителя и подтверждение реквизитов;
- `Editor` — четыре шага договора, autosave, validation summary, generation и versions;
- `App` — bootstrap, реестр, CRUD и view orchestration.

`style.css` — единый stylesheet, включая responsive breakpoints. Отдельных каталогов pages/components/features/hooks в текущей структуре нет.

### State and autosave

Используются только `useState`, `useRef`, `useEffect` и `useCallback`. В `Editor`:

1. изменения остаются в локальном `data`;
2. через 800 мс запускается `flush`;
3. запросы сериализуются через `inflight`;
4. PUT отправляет текущую `revision` и полный `ContractData`;
5. успешный ответ повышает локальную revision;
6. `409` помечает редактор как blocked, чтобы не перезаписать более новую версию;
7. событие `online` инициирует повторную попытку, а `beforeunload` предупреждает о несохранённых данных.

Профиль сохраняется явно и также подключается к `beforeLeave`; его mutation тоже защищена revision.

### API access and errors

`frontend/src/api.ts` — единственная fetch abstraction. Она:

- добавляет `/api` к path;
- отправляет JSON, same-origin credentials и `X-Pact-Request: 1`;
- превращает transport/HTTP errors в `ApiError(status, message, fields)`;
- посылает browser event `pact-session-expired` при `401` вне login/bootstrap.

Download links используют обычный same-origin `<a>` и session cookie. TypeScript response/request types описаны вручную в `types.ts`.

### Forms, validation and calculations

`Field` отображает inline error/hint и ARIA attributes. `PartyFields` переиспользуется для исполнителя и контрагента. `requisites.ts` нормализует пробельные символы, сохраняет ведущие нули и проверяет длину/ASCII digits.

`money.ts` использует `decimal.js`, принимает точку или запятую и повторяет серверные ограничения. Итог — сумма уже округлённых до копейки строк. Client checks улучшают UX, но окончательная проверка выпуска выполняется backend.

## Backend architecture

### Application lifecycle

`backend/app/main.py:create_app(database_url=None, data_dir=None, secure_cookie=None)` — factory для production и изолированных тестов. Она создаёт engine/session factory через `database.connect` и определяет storage path.

FastAPI lifespan:

1. создаёт storage directory;
2. вызывает `Base.metadata.create_all`;
3. создаёт `SchemaVersion(id=1)`, если marker отсутствует;
4. bootstrap-ит `Account(id=1)` из environment;
5. создаёт singleton `Supplier(id=1)` из `DEFAULT_PROFILE`;
6. после аварийного прерывания пересчитывает статусы `generating`/`converting` по наличию DOCX/PDF;
7. при shutdown освобождает engine.

OpenAPI schema, Swagger UI и ReDoc отключены.

### HTTP/API layer

Все handlers объявлены внутри `create_app` в `main.py`. Они синхронные и сами открывают SQLAlchemy sessions/transactions. Общие локальные helpers преобразуют ORM rows в JSON, находят договор и проверяют сессию.

Application-wide middleware для изменяющих методов:

- требует `X-Pact-Request: 1`;
- при наличии `Origin` сверяет его с `APP_ORIGIN` или request base URL;
- ограничивает body до 1 MB;
- добавляет `no-store`, `nosniff`, frame denial и same-origin referrer policy.

### Business/domain logic

`schemas.py` задаёт Pydantic models `Party`, `Profile`, `Item`, `Specification`, `ContractData`, `SaveContract`, `Login`, `Generate`. Базовая model запрещает extra fields, trim-ит строки и отклоняет control characters.

Ключевая логика:

- `validate_party` — обязательность и формат реквизитов по типу стороны;
- `numeric` — допустимый формат количества и цены;
- `totals` — line totals и общий итог через `Decimal`/`ROUND_HALF_UP`;
- `validate_generation` — полная готовность профиля и договора к выпуску;
- совместимость старых черновиков: legacy `prepayment_percent` и `balance_terms` остаются в schema и document renderer.

Черновик можно сохранять неполным. Полная validation запускается только при generation.

### Persistence

Handlers выполняют прямые `select`, `update`, `delete` и `db.get`. Для конкурентной записи используются conditional updates по `revision`; для generation/deletion — row locking через `with_for_update` там, где он нужен.

### Document generation

`documents.py:generate_docx`:

1. выбирает шаблон по `ContractData.type` через `manifest.json`;
2. строит mapping реквизитов, условий оплаты и totals;
3. открывает DOCX как ZIP и изменяет только `word/document.xml`;
4. находит template row с `{{item_name}}`, клонирует её для каждой позиции и заменяет разрешённые `{{slot}}`;
5. переносит остальные package parts без изменений;
6. записывает временный файл и атомарно заменяет destination.

Пользовательский текст подставляется за один проход и XML-экранируется библиотекой, поэтому `{{...}}` внутри пользовательских значений не становится template code.

`convert_pdf` сериализует конвертацию process-local `threading.Lock`, запускает headless LibreOffice с отдельным временным profile и timeout 90 секунд, проверяет результат и атомарно сохраняет PDF. Ошибка PDF оставляет готовый DOCX и статус `pdf_failed`, который допускает retry.

Generation выполняется синхронно в HTTP request. Runtime использует один Uvicorn worker, что вместе с lock ограничивает одновременную нагрузку на LibreOffice.

## Data flows

### 1. Login and bootstrap

```text
App mount
→ GET /api/me
→ SHA-256(cookie token) lookup in sessions
→ GET /api/profile + GET /api/contracts
→ profile/list in App state
```

При отсутствии valid cookie UI показывает `Login`:

```text
Login form
→ POST /api/login
→ global 15-minute attempt limit
→ Argon2 password verification + constant-time username comparison
→ random token; only SHA-256 digest stored in DB
→ HttpOnly, SameSite=Strict session cookie for 7 days
```

### 2. Edit and release a contract

```text
Editor field change
→ local ContractData
→ 800 ms autosave
→ PUT /api/contracts/{id} with revision
→ conditional SQL UPDATE
→ new revision returned

Generate action
→ flush pending autosave
→ POST /api/contracts/{id}/generate with revision + request_id
→ row lock + validate_generation
→ Issue(snapshot, template_version, generating)
→ template slots/items → persisted DOCX
→ LibreOffice → persisted PDF
→ Issue status ready or pdf_failed
→ version list/download links
```

Повтор того же `request_id` возвращает созданный `Issue`, а не создаёт вторую версию.

### 3. Search, copy and delete

```text
Search input (250 ms debounce)
→ GET /api/contracts?q=...&offset=...
→ escaped ILIKE over denormalized number/customer
→ up to 50 rows with issue metadata
```

Copy создаёт новый UUID и JSON-копию, очищает номер/дату и не переносит versions. Delete contract проверяет revision и отсутствие активной generation, удаляет связанные `Issue` rows вручную, затем удаляет их directories. Delete issue аналогично удаляет одну version и её directory.

## Domain areas

| Область | Назначение | Frontend | Backend / data / API |
| --- | --- | --- | --- |
| Доступ | один локальный аккаунт и session lifecycle | `Login`, bootstrap/logout в `App`, `api.ts` expiry event | `Account`, `SessionToken`, `LoginAttempt`; `/login`, `/me`, `/logout` |
| Исполнитель | singleton профиль ИП и подтверждение реквизитов | `ProfileView`, `PartyFields` | `Supplier.data/revision`, `Profile`, `DEFAULT_PROFILE`; `/profile` |
| Договоры | черновики двух типов, поиск, autosave, copy/delete | list views, `Editor`, `types.ts` | `Contract`, `ContractData`; `/contracts*` |
| Позиции и расчёты | товары/работы, quantities, prices и totals | `money.ts`, step 3 editor | `Item`, `Specification`, `numeric`, `totals` |
| Выпуски | immutable snapshot, template version, DOCX/PDF lifecycle | version list, `DownloadLinks`, retry/delete | `Issue`, `documents.py`; `/generate`, `/issues*` |
| Шаблоны | source preservation и versioned working artifacts | UI выбирает `simple`/`full` через тип договора | `templates/`, manifest, `prepare_templates.py` |

## Database

Production-конфигурация использует PostgreSQL через `postgresql+psycopg`; локальные tests/development могут передать SQLite URL. `database.connect` включает `pool_pre_ping`, а для SQLite добавляет `check_same_thread=False`.

Таблицы:

- `accounts` — singleton account id, unique username, Argon2 hash;
- `sessions` — SHA-256 token digest и expiry;
- `login_attempts` — timestamps для общего rate limit;
- `supplier` — singleton JSON profile и revision;
- `contracts` — UUID string, JSON contract, revision, денормализованные number/customer, ISO string timestamps;
- `issues` — UUID, contract id, unique request id, source revision, immutable JSON snapshot, template version, status и creation time;
- `schema_version` — текущий marker `id=1`.

ORM relationships и foreign keys не объявлены. Жизненный цикл `Contract → Issue → files` поддерживает application code. Binary документы в БД не хранятся.

Миграционного инструмента нет. `create_all` создаёт отсутствующие таблицы, но не изменяет существующую schema. Deployment script сознательно не делает автоматических/обратных миграций, поэтому любое изменение schema требует отдельного проекта миграции, backup и rollback plan.

В pytest fixtures SQLite используется по умолчанию. При `TEST_DATABASE_URL` тест создаёт уникальную PostgreSQL schema и удаляет её после fixture.

## API

| Method/path | Auth | Назначение |
| --- | --- | --- |
| `GET /api/health` | нет | DB connectivity health check |
| `POST /api/login` | нет | login и session cookie |
| `GET /api/me` | да | проверка сессии |
| `POST /api/logout` | да | удалить session и cookie |
| `GET /api/profile` | да | профиль и source notes |
| `PUT /api/profile` | да | validate/save profile по revision |
| `GET /api/contracts` | да | поиск и offset pagination по 50 |
| `POST /api/contracts` | да | новый неполный draft |
| `GET /api/contracts/{id}` | да | draft и versions |
| `PUT /api/contracts/{id}` | да | полный snapshot save по revision |
| `DELETE /api/contracts/{id}?revision=` | да | удалить draft, versions и files |
| `POST /api/contracts/{id}/copy` | да | копия без номера, даты и versions |
| `POST /api/contracts/{id}/generate` | да | validation и идемпотентный выпуск |
| `DELETE /api/issues/{id}` | да | удалить одну version и files |
| `POST /api/issues/{id}/retry-pdf` | да | повторно конвертировать persisted DOCX |
| `GET /api/issues/{id}/files/{format}` | да | скачать DOCX/PDF |

Request DTO находятся в `schemas.py`; отдельных controllers/services нет. Response DTO формируются helpers `profile_value`, `contract_value` и `issue_value` и не описаны Pydantic response models. Клиентские формы и types поддерживают этот контракт вручную.

## Authentication and authorization

Реализован один локальный account `id=1`; регистрации, ролей и разграничения доступа между договорами нет. При первом startup username/hash читаются из environment и сохраняются в БД.

Успешный login создаёт криптографически случайный token на 7 дней. В `sessions` хранится только SHA-256 digest; browser получает HttpOnly, SameSite=Strict cookie, с Secure по умолчанию. Logout удаляет текущую session. Password reset меняет Argon2 hash и удаляет все sessions/login attempts.

После десяти неудачных попыток за 15 минут login блокируется. Попытки не привязаны к IP или username, поэтому limit общий для единственного аккаунта.

Изменяющие запросы защищены same-origin header/origin проверкой. Gateway добавляет CSP и другие security headers; API также добавляет базовые headers. Это не role-based authorization — authenticated user имеет доступ ко всем данным приложения.

## Configuration

Отдельного settings object нет: `create_app`, middleware и helpers читают environment напрямую.

- `DATABASE_URL` — engine URL;
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` — bootstrap account;
- `APP_ORIGIN`, `COOKIE_SECURE` — request/cookie security;
- `DATA_DIR` — filesystem issues;
- `TEMPLATES_DIR` — active template directory;
- `LIBREOFFICE_BIN` — converter executable.

Compose дополнительно использует `DOMAIN`, `ACME_EMAIL` и `POSTGRES_PASSWORD`. `.env.example` содержит только placeholders для Compose. Vite не имеет runtime environment configuration и проксирует `/api` только в dev mode.

## Infrastructure

### Compose/Caddy

`Dockerfile` имеет три stages:

- `web`: Node 22, `npm ci`, TypeScript/Vite build;
- `api`: Python 3.12 slim, LibreOffice/fonts, Python dependencies, non-root user `pact`;
- `gateway`: Caddy 2 с frontend dist и `deploy/Caddyfile`.

`compose.yaml` запускает PostgreSQL 17 Alpine, API и gateway. API не публикует host port, ждёт healthy DB, монтирует document volume и ограничен 1536 MB. Gateway публикует 80/443 TCP и 443 UDP, получает TLS и проксирует API.

### Native Debian/LXC

`deploy/pact.service` запускает один Uvicorn worker от пользователя `pact` на `127.0.0.1:8000`. `deploy/nginx-app.conf` раздаёт `frontend/dist` на внутреннем порту 8080 и проксирует `/api/`. Отдельный внешний Nginx завершает TLS и пересылает трафик в LXC.

`scripts/deploy.sh` создаёт immutable local snapshot, ставит зависимости во временное venv, запускает проверки, собирает frontend и runtime archive, затем передаёт его по SSH. `deploy-remote.sh` проверяет hashes, создаёт server venv, блокирует параллельный backup/deploy, останавливает запись, делает backup, переключает release symlinks и выполняет health check. При ошибке он возвращает прежние paths; данные не откатываются.

### Backups and CI/CD

`backup.sh` предназначен для Compose, `backup-native.sh` — для systemd/PostgreSQL установки. Оба временно останавливают API, сохраняют database dump, documents archive и template manifest. Native timer запускает backup ежедневно в 03:30.

`.github/workflows/ci.yml` выполняет проверки и сборку на GitHub-hosted Ubuntu runners. Pull request получает только CI; успешные push в `main` и ручные запуски из `main` публикуют release с runtime archive. Отдельная release job получает `contents: write` и `id-token: write`, подписывает точный проверенный архив через Sigstore OIDC и публикует выпуск только после загрузки всех файлов.

В production `pact-update.timer` каждые пять минут запускает установленный root-owned `/usr/local/sbin/pact-pull-deploy`. Он скачивает публичный release без credentials, проверяет Cosign bundle с точным identity workflow `ci.yml@refs/heads/main`, проверяет metadata подписанного архива и запрещает downgrade по `(run_id, run_attempt)`. Только после проверки запускается вложенный `deploy-remote.sh` в отдельной systemd service. Неудавшийся выпуск блокируется до явного `--retry`; предыдущий успешный marker сохраняется. Шаблоны с отличающимся содержимым требуют ручной проверки. Self-hosted Actions runners и входящий доступ из GitHub в домашнюю сеть не используются.

Updater, pinned Cosign и timer устанавливаются отдельно администратором; runtime release не перезаписывает этот trust boundary. Старый локальный SSH deploy остаётся доступен как ручной путь. Подробности — `docs/deploy-script.md`.

## Important architectural conventions

- Same-origin frontend/API contract; абсолютные API URLs не используются.
- Server-side validation является окончательной; incomplete draft разрешён, invalid issue — нет.
- Все идентификаторы/реквизиты и decimal inputs остаются строками, чтобы сохранять ведущие нули и точность.
- Contract/profile writes используют revision-based optimistic concurrency.
- Generation request идемпотентен по `request_id`.
- Выпущенная version неизменяема: snapshot, template version и persisted files не пересобираются при изменении draft/profile.
- Template files версионируются через content hash в manifest; исходники в `templates/source` не изменяются.
- DOCX сначала пишется во временный файл, PDF — во временный target; финальная замена атомарна.
- PDF retry использует точный persisted DOCX, а не текущий draft.
- Database и document files резервируются вместе при остановленных writers.
- Runtime — один worker; scaling требует пересмотра process-local PDF lock и синхронной generation.

## Known inconsistencies

- Репозиторий содержит две deployment topology. `README`/Compose используют произвольный `DOMAIN` и Caddy, а подтверждённая рабочая установка — native systemd/Nginx. Изменения deployment нельзя автоматически переносить между ними.
- Канонический адрес — `pactum.qbob.ru`. Сохранённые `deploy/nginx-app.conf` и `deploy/nginx-reverse-proxy.conf` используют его; переадресации со старых доменов настроены на внешнем Nginx отдельно.
- `SchemaVersion` существует, но migration framework и migrations отсутствуют; marker `1` сам по себе не обновляет schema.
- Backend response shapes и frontend TypeScript interfaces дублируются вручную. OpenAPI отключён, поэтому compile-time/generated contract check отсутствует.
- `documents.py` напрямую импортирует `lxml`, однако `backend/requirements.txt` не фиксирует его напрямую; сейчас он устанавливается как транзитивная зависимость `python-docx`, который сам в application code не импортируется.
- `frontend/tsconfig.tsbuildinfo` — generated TypeScript build metadata, но файл отслеживается Git и может давать incidental diffs после build.

### Furniture

`Furniture.tsx` использует отдельные API `/api/furniture/*` и модели
`FurnitureList`, `FurnitureCatalog`, `FurnitureIssue`. JSON списка содержит
название, кабинеты и снимки строк. Сохранение использует compare-and-swap revision;
выпуск POST фиксирует snapshot и request_id. Повтор выпуска возвращает тот же
выпуск и повторяет неудачную PDF-конвертацию. DOCX создаётся python-docx, PDF —
существующим LibreOffice converter с общим process-local lock.
Импорт XLSX выполняется ограниченным OOXML parser без исполнения формул.
Изображения адресуются SHA-256; новые файлы лежат в DATA_DIR/furniture-images,
выпуски — DATA_DIR/furniture-<uuid>. Начальные изображения поставляются в backend.
Обновление каталога не удаляет старые изображения. Все endpoints требуют auth.
Миграция v2 явно добавляет три таблицы при startup; существующие таблицы и JSON
договоров не меняются. Старый код может работать с сохранёнными новыми таблицами.

Миграция v3 добавляет nullable колонки furniture_lists.number (уникальный индекс)
и created_at (UTC ISO 8601, null у старых записей), таблицу furniture_counter
с единственной строкой id=1 и marker schema_version=3. Старые записи нумеруются
по casefold(title) с заменой ё на е, затем UUID. Счётчик увеличивается SQL UPDATE
RETURNING в одной транзакции с INSERT списка; удаление не уменьшает счётчик.
API возвращает метаданные при чтении, создании и сохранении, принимает изменения
только data/revision. JSON-снимки и выпуски остаются прежними.

Навигация сохраняется в sessionStorage: раздел, ID договора и шаг редактора либо ID списка мебели. После авторизации объекты загружаются заново через API; отсутствующие объекты возвращают пользователя к соответствующему списку.
