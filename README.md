# Pactum

«Pactum» — однопользовательское веб-приложение для подготовки договоров поставки и договоров на изготовление. Пользователь заполняет реквизиты сторон и условия сделки, а приложение сохраняет черновик и формирует версионированные DOCX и PDF по подготовленным шаблонам.

## Возможности

- единый подтверждаемый профиль исполнителя-ИП;
- покупатели/заказчики двух типов: организация и индивидуальный предприниматель;
- договор поставки с перечнем товаров и расчётом стоимости;
- договор на изготовление с расширенной спецификацией, описанием и условиями;
- условия оплаты: 100% предоплата или произвольный текст;
- автоматическое сохранение черновика с контролем конфликтов по ревизии;
- поиск по номеру и контрагенту, копирование и удаление договоров;
- история выпущенных версий, отдельное удаление версии и скачивание DOCX/PDF;
- повторная конвертация PDF из уже сохранённого DOCX.

Каждая выпущенная версия хранит снимок договора и профиля исполнителя, ревизию договора и версию шаблона. Изменение черновика, профиля или шаблона не изменяет уже сформированные файлы.

## Технологии

### Frontend

- React 19 и React DOM;
- TypeScript 5.8 в strict mode;
- Vite 6;
- `decimal.js` для точных денежных расчётов;
- Lucide React для иконок;
- Vitest.

### Backend

- Python, FastAPI и Uvicorn;
- Pydantic для DTO и validation;
- SQLAlchemy 2 и Psycopg 3;
- Argon2 для хеширования пароля;
- прямое изменение OOXML через ZIP/XML и `lxml`;
- LibreOffice Writer (`soffice`) для конвертации DOCX в PDF;
- pytest и HTTPX для тестов.

### Данные и инфраструктура

- PostgreSQL в production, SQLite как локальная и тестовая альтернатива;
- файловое хранилище выпущенных DOCX/PDF;
- Docker multi-stage build, Docker Compose и Caddy;
- native deployment на Debian/LXC через systemd и Nginx также хранится в репозитории.

## Структура проекта

```text
backend/
  app/                  FastAPI, Pydantic/SQLAlchemy-модели, генерация документов
  tests/                pytest API-, validation- и document-тесты
frontend/
  src/                  React UI, API client, типы, расчёты и Vitest-тесты
  public/               статические файлы
templates/
  source/               исходные документы, не изменяемые генератором
  *-v*.docx             рабочие версионированные шаблоны
  manifest.json         активные файлы, версии и SHA-256 исходников
scripts/                template QA, password, backup и deployment scripts
scripts/tests/          тест native deployment transaction
deploy/                 Caddy, Nginx и systemd-конфигурация
docs/                   deployment и template-документация
compose.yaml            PostgreSQL + API + Caddy/static frontend
Dockerfile              frontend, API и gateway build stages
```

Подробная карта модулей и потоков данных находится в [ARCHITECTURE.md](ARCHITECTURE.md).

## Требования

Для запуска через Compose нужны:

- Docker Engine и Docker Compose v2;
- домен с DNS-записью на сервер;
- доступные извне порты 80 и 443 для Caddy и ACME.

Для локальной разработки нужны:

- Python с модулем `venv` и `pip`;
- Node.js и npm;
- LibreOffice Writer/`soffice`, если нужно реально получать PDF;
- PostgreSQL для production-подобного запуска либо SQLite для локальной работы и тестов.

Репозиторий не задаёт отдельный диапазон версий локальных Python/Node. Dockerfile фиксирует образы Python 3.12 и Node 22; документированная native-установка работает на Python 3.11.

## Установка

Из корня репозитория:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
```

`backend/requirements-dev.txt` включает production-зависимости из `backend/requirements.txt`. Frontend-зависимости воспроизводимо устанавливаются из `frontend/package-lock.json`.

На этой рабочей машине тестовое окружение установлено постоянно в каталоге
проекта: Python 3.11 — `.tools/python`, backend-пакеты — `.venv-test`,
Node.js 22 — `.tools/node-v22.23.4-linux-x64`, frontend-пакеты —
`frontend/node_modules`. Playwright находится в `.tools/ui-qa`, его Chromium —
в `.tools/playwright-browsers`. Каталоги исключены из Git; повторная установка
перед каждым запуском не нужна. Исходное окружение `.venv` сохранено.

Запуск установленных проверок из корня проекта:

```sh
export PATH="$PWD/.tools/node-v22.23.4-linux-x64/bin:$PATH"
PYTHONPATH=backend .venv-test/bin/python -m pytest backend/tests -q
.venv-test/bin/python -m unittest discover -s scripts/tests -p 'test*.py' -v
npm --prefix frontend test
npm --prefix frontend run build
```

Для обновления backend-пакетов используйте
`.venv/bin/uv pip install --python .venv-test/bin/python -r backend/requirements-dev.txt`.
На другой машине с Python 3.11 окружение можно создать через
`python3.11 -m venv .venv-test` и установить пакеты через
`.venv-test/bin/pip install -r backend/requirements-dev.txt`.
Node.js 22 требуется добавить в PATH перед `npm --prefix frontend ci`.
Браузерная QA и установка её пакетов описаны ниже. В ограниченном sandbox
FastAPI TestClient может зависать: эти проверки запускайте с разрешением на
выполнение вне sandbox.


## Конфигурация

### Compose `.env`

Создайте локальный файл из шаблона и ограничьте права:

```sh
cp .env.example .env
chmod 600 .env
```

| Переменная | Назначение |
| --- | --- |
| `DOMAIN` | публичный домен, для которого Caddy получает TLS-сертификат |
| `ACME_EMAIL` | адрес уведомлений ACME |
| `POSTGRES_PASSWORD` | пароль роли `pact` в PostgreSQL |
| `ADMIN_USERNAME` | имя единственного пользователя; Compose по умолчанию использует `admin` |
| `ADMIN_PASSWORD_HASH` | Argon2-хеш начального пароля |

Хеш содержит `$`, поэтому в `.env` его нужно оставлять в одинарных кавычках, как в `.env.example`. Не коммитьте `.env` и не вставляйте реальные секреты в документацию.

### Переменные API

| Переменная | Назначение | Значение по умолчанию |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy URL базы данных | нет; обязательна |
| `ADMIN_USERNAME` | имя bootstrap-аккаунта | `admin` |
| `ADMIN_PASSWORD_HASH` | Argon2-хеш при первом создании аккаунта | нет |
| `APP_ORIGIN` | допустимый origin изменяющих запросов | base URL входящего API-запроса |
| `COOKIE_SECURE` | выдавать session cookie только по HTTPS | `true` |
| `DATA_DIR` | каталог выпущенных файлов | `/data` |
| `TEMPLATES_DIR` | каталог рабочих шаблонов | `templates/` в корне репозитория |
| `LIBREOFFICE_BIN` | executable LibreOffice CLI | `soffice` |

После bootstrap изменение `ADMIN_PASSWORD_HASH` в окружении не меняет пароль существующего аккаунта. Для Compose пароль меняется интерактивно командой:

```sh
docker compose exec api python scripts/reset_password.py
```

Команда также завершает все активные сессии.

## Локальная разработка

Создайте Argon2-хеш пароля длиной не менее 12 символов:

```sh
.venv/bin/python scripts/password_hash.py
```

Запустите API с SQLite, подставив полученный хеш:

```sh
DATABASE_URL=sqlite:////tmp/pact-dev.db \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD_HASH='полученный_хеш' \
APP_ORIGIN=http://127.0.0.1:5173 \
COOKIE_SECURE=false \
DATA_DIR=.data \
PYTHONPATH=backend \
.venv/bin/uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8000
```

В другом терминале запустите frontend:

```sh
npm --prefix frontend run dev
```

Vite обслуживает UI на `http://127.0.0.1:5173` и проксирует `/api` на `http://127.0.0.1:8000`. Отдельных frontend environment variables нет: клиент всегда обращается к относительному `/api`.

## Docker Compose

1. Подготовьте `.env` и задайте случайный `POSTGRES_PASSWORD`.
2. Соберите образы:

   ```sh
   docker compose build
   ```

3. Получите Argon2-хеш и перенесите выведенную строку в `.env`:

   ```sh
   docker compose run --rm --no-deps api python scripts/password_hash.py
   ```

4. Запустите stack и проверьте состояние:

   ```sh
   docker compose up -d
   docker compose ps
   docker compose logs --tail=100 api gateway
   ```

Caddy раздаёт собранный frontend, проксирует `/api/*` в API и автоматически управляет TLS. Health endpoint доступен по `https://<DOMAIN>/api/health`; PostgreSQL наружу не публикуется.

Compose создаёт named volumes:

- `database` — PostgreSQL;
- `documents` — DOCX/PDF;
- `certificates` и `caddy_config` — состояние Caddy.

Остановка без удаления данных:

```sh
docker compose down
```

Не используйте `docker compose down -v` на рабочем сервере: команда удалит volumes базы, документов и сертификатов.

## Сборка

Production frontend:

```sh
npm --prefix frontend run build
```

Команда сначала выполняет `tsc -b`, затем создаёт `frontend/dist` через Vite. Полная сборка контейнерных stages:

```sh
docker compose build
```

## Тесты

Backend API, validation и документы:

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```

По умолчанию fixtures используют SQLite. Чтобы выполнять их в изолированной PostgreSQL schema, задайте `TEST_DATABASE_URL` с PostgreSQL SQLAlchemy URL; тесты сами создают и удаляют schema.

Frontend:

```sh
npm --prefix frontend test
```

Транзакция native deployment с mock-сервисами и временными каталогами:

```sh
python3 scripts/tests/test_deploy.py
```

Полный изолированный check, включая установку зависимостей, backend/deploy/frontend tests, frontend build, проверку шаблонов и сборку release archive:

```sh
./scripts/deploy.sh --check
```

Этот режим сервер не использует.

Для генерации синтетических контрольных DOCX:

```sh
PYTHONPATH=backend .venv/bin/python scripts/qa_documents.py /tmp/pact-qa
```

Файлы содержат тестовые банковские реквизиты и не предназначены для подписания. PDF для визуальной проверки нужно получить через LibreOffice.

## Lint и typecheck

Отдельных lint-скриптов и lint-конфигураций в репозитории нет. Prettier установлен как dev dependency, но npm script для него не объявлен. Typecheck является первой частью production build:

```sh
npm --prefix frontend run build
```

Для Python отдельного static typecheck нет.

## Развёртывание

Репозиторий содержит два подтверждённых варианта:

1. `compose.yaml` + `deploy/Caddyfile` — контейнеры PostgreSQL/API/gateway и автоматический TLS.
2. Native Debian/LXC — PostgreSQL, Uvicorn под `pact.service`, внутренний Nginx и внешний TLS reverse proxy. Текущее состояние этой установки описано в [docs/deployment.md](docs/deployment.md).

Автоматизированное native-обновление выполняет `scripts/deploy.sh`: он локально тестирует и собирает неизменяемый release, передаёт его по SSH, останавливает запись, создаёт backup, переключает symlinks и делает health-check с rollback при ошибке. Полная процедура и требования к ключам находятся в [docs/deploy-script.md](docs/deploy-script.md).

Безопасная локальная проверка:

```sh
./scripts/deploy.sh --check
```

Запуск без `--check` изменяет рабочий сервер и должен выполняться только осознанно. Для изменённых DOCX-шаблонов deployment требует предварительной визуальной проверки и флага `--templates-reviewed`. CI/CD-конфигурации в репозитории нет.

## Данные и резервные копии

Compose backup:

```sh
sudo scripts/backup.sh
```

Скрипт временно останавливает API и сохраняет согласованные database dump, архив документов, template manifest и checksums. Для native-установки предназначены `scripts/backup-native.sh` и systemd timer из `deploy/`.

Резервные копии и сформированные документы содержат персональные данные. Их нужно хранить с ограниченным доступом и выносить за пределы основного сервера по отдельной эксплуатационной процедуре.

## Ограничения

- один локальный аккаунт без регистрации и ролей;
- расчёты только в рублях, отдельный учёт НДС отсутствует;
- не более 200 товарных позиций;
- количество — до трёх знаков после запятой, цена — до двух;
- сумма каждой строки округляется до копеек по `HALF_UP`, итог равен сумме округлённых строк;
- электронная подпись отсутствует;
- PDF-конвертация сериализована process-local lock и имеет timeout 90 секунд;
- schema migrations не автоматизированы.

## Документация

- [ARCHITECTURE.md](ARCHITECTURE.md) — текущая архитектура, компоненты и data flows.
- [AGENTS.md](AGENTS.md) — компактные правила работы AI/Codex-агентов с репозиторием.
- [docs/deployment.md](docs/deployment.md) — подтверждённое состояние рабочей native-установки.
- [docs/deploy-script.md](docs/deploy-script.md) — транзакционный deployment и rollback.
- [docs/artifact.md](docs/artifact.md) — контракт DOCX-шаблонов и их QA.

## GitHub Actions и автоматические обновления

Push в `main` запускает тесты backend/frontend, проверки deployment и production-сборку на GitHub. После успешного CI публикуется подписанный release. Контейнер сайта проверяет новые выпуски каждые пять минут, проверяет подпись workflow из `main` и устанавливает готовый пакет с backup, health checks и откатом. Pull request только проверяется и не публикует выпуск.

GitHub Secrets, self-hosted runner и сборка на рабочем сервере не требуются. Workflow можно также запустить вручную во вкладке Actions из `main`. Изменённые DOCX блокируют автоматическую установку до визуальной проверки администратором.

Настройка, диагностика, остановка автообновлений и повтор после ошибки: [docs/deploy-script.md](docs/deploy-script.md#github-actions).

### Списки мебели

Вкладка «Списки мебели» позволяет выбирать позиции из каталога Arkador, создавать
кабинеты, задавать целое количество и цену в рублях. Сохранённые списки
открываются с отдельного экрана. В редакторе кнопка
«Добавить мебель» у каждого кабинета открывает каталог справа, уже с выбранным
местом добавления. На телефоне каталог занимает весь экран. Количество и цена
редактируются прямо в списке; итог и выгрузка закреплены внизу. Меню `···`
содержат переименование, перенос и удаление; обновление XLSX находится в меню
каталога. Черновики автоматически сохраняются; конфликт версий требует
подтверждения загрузки сохранённой версии.
Каталог можно заменить загрузкой XLSX (до 20 МБ): лист «Изделия» с колонками
`артикул`, `наименование`, `раздел`, `размеры_ВШГ_мм`; изображения PNG извлекаются
из привязанных к строкам рисунков. Старые списки сохраняют снимки позиций.
DOCX/PDF содержат общий перечень без кабинетов и картинок; одинаковые артикулы,
названия, размеры и цены объединяются. Цена из каталога не подставляется.

### Браузерная проверка редактора мебели

Необязательная проверка на тестовых API-ответах (рабочая БД и сервер не используются).
Запустите Vite через `npm --prefix frontend run dev` и в другом терминале:

```sh
npm install --prefix .tools/ui-qa --save-exact playwright@1.58.2
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" .tools/ui-qa/node_modules/.bin/playwright install chromium
PACT_PLAYWRIGHT_MODULE="$PWD/.tools/ui-qa/node_modules/playwright/index.mjs" PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" node scripts/qa_furniture_ui.mjs
```

Скрипт проверяет редактор на 1440, 1024 и 390 px, диалоги и фокус, добавление,
переименование и перенос, суммы, автосохранение с последовательными запросами,
потерю сети, конфликты, импорт и повтор PDF. Снимки сохраняются в
`/tmp/pact-furniture-ui`. Адрес локального Vite можно изменить через `PACT_UI_URL`,
каталог снимков — через `PACT_UI_OUTPUT`. Playwright устанавливается отдельно,
зависимости production не меняются.

Каждый список мебели получает постоянный серверный номер и дату создания.
В перечне новые номера идут первыми; поиск работает по названию и номеру,
в том числе «№12». Дата отображается по Москве. У старых списков дата неизвестна;
номера назначаются по названию без учёта регистра (Ё = Е), затем UUID.
Удалённые номера не используются повторно. В DOCX/PDF эти поля не добавляются.
Перед первым запуском версии с нумерацией выполните резервное копирование,
описанное в разделе миграции v3 в docs/deploy-script.md.
