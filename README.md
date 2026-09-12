# Пакт — генератор договоров

React/TypeScript + FastAPI + PostgreSQL. Два исходных договора превращены в версионированные DOCX-шаблоны. PDF создаётся LibreOffice из сохранённого DOCX. Условия договора сохранены; заменяются данные сторон, заголовок и спецификация.

## Использование

Войдите личным аккаунтом. В разделе «Ваши реквизиты» проверьте расхождения исходников, заполните адрес и корреспондентский счёт и подтвердите данные. Создайте простой или полный договор. Черновик сохраняется автоматически; дождитесь статуса «Все изменения сохранены». В полном договоре заполните позиции спецификации. На последнем шаге сформируйте документы и скачайте DOCX/PDF.

Каждый выпуск хранит собственные данные, реквизиты исполнителя и SHA-256 шаблона. Изменения профиля и черновика не изменяют уже выпущенные файлы. Если PDF не сформировался, DOCX остаётся доступен, а конвертацию можно повторить. Копирование создаёт новый черновик без номера и даты. При конфликте с другой вкладкой сервер не перезаписывает более новую редакцию.

## Размещение через Docker Compose

Требуются Docker Compose v2, домен с DNS на сервер и открытые порты 80/443. Рекомендуется от 2 ГБ RAM и 10 ГБ диска.

```sh
cp .env.example .env
chmod 600 .env
docker compose build
docker compose run --rm --no-deps api python scripts/password_hash.py
openssl rand -hex 24
```

Укажите в `.env` домен, email, случайный пароль PostgreSQL и полученный Argon2-хеш в одинарных кавычках. Пароль сайта не совпадает с паролем PostgreSQL или SSH.

```sh
docker compose up -d
docker compose ps
```

Caddy выпускает HTTPS-сертификат автоматически. База и файлы находятся в именованных томах. Не выполняйте `docker compose down -v` на рабочем сервере. Аккаунт создаётся при первом запуске; изменение переменной окружения не меняет существующий пароль. Для смены используйте `docker compose exec api python scripts/reset_password.py`.

## Установка на Debian/LXC без Docker

Файлы конфигурации: `deploy/pact.service`, `deploy/nginx-app.conf`, `deploy/pact-backup.*`. Приложение размещается в `/opt/pact`, виртуальное окружение — `/opt/pact/.venv`, данные — `/var/lib/pact/documents`. Nginx обслуживает собранный `frontend/dist` на порту 8080 и передаёт `/api/` службе на 127.0.0.1:8000. Внешний reverse proxy завершает HTTPS.

Зависимости: Python 3.11+, python3-venv, PostgreSQL, libreoffice-writer, fonts-liberation, fonts-dejavu-core, nginx. Установите `backend/requirements.txt` в venv. Создайте системного пользователя `pact`, роль/базу PostgreSQL `pact` с кодировкой UTF8 (`createdb -O pact -T template0 -E UTF8 --locale=C.UTF-8 pact`). Файл `/etc/pact.env` (root:root, 600):

```ini
DATABASE_URL=postgresql+psycopg://pact:СЛУЧАЙНЫЙ_ПАРОЛЬ@127.0.0.1/pact
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=ARGON2_ХЕШ
APP_ORIGIN=https://pact-gen.bobserver.ru
COOKIE_SECURE=true
DATA_DIR=/var/lib/pact/documents
TEMPLATES_DIR=/opt/pact/templates
HOME=/var/lib/pact
```

Установите unit-файлы в `/etc/systemd/system`, конфигурацию Nginx в `sites-available` и включите ссылкой в `sites-enabled`. `systemctl daemon-reload && systemctl enable --now pact pact-backup.timer`. Проверка: `curl http://127.0.0.1:8080/api/health` и `nginx -t`. Для входа требуется HTTPS из-за защищённой cookie.

## Резервное копирование и восстановление

Docker: `sudo scripts/backup.sh`. Native: `sudo /opt/pact/scripts/backup-native.sh`. Native timer запускается ежедневно в 03:30 по времени сервера. На время согласованной копии служба приложения останавливается; после завершения или ошибки автоматически запускается. Копии содержат персональные данные; права ограничены. Сохраняйте копии также вне сервера. Автоматическое удаление старых копий не включено.

Проверка копии: из её каталога выполните `sha256sum -c SHA256SUMS`. Восстанавливайте базу и документы одной даты. Перед восстановлением сделайте копию текущего состояния.

Native (от root, замените BACKUP абсолютным путём):

```sh
systemctl stop pact
runuser -u postgres -- pg_restore --clean --if-exists --no-owner --role=pact -d pact BACKUP/database.dump
# Архив распаковывать в пустой каталог документов, сохранив прежний отдельно.
mv /var/lib/pact/documents /var/lib/pact/documents.before-restore
tar -C /var/lib/pact -xzf BACKUP/documents.tar.gz
chown -R pact:pact /var/lib/pact/documents
systemctl start pact
```

Docker: остановите API, восстановите `database.dump` через `docker compose exec -T db pg_restore --clean --if-exists --no-owner -U pact -d pact`, восстановите архив в пустой том documents через временный контейнер api, затем запустите API. Нужна та же версия приложения/схемы. `.env` или `/etc/pact.env` храните отдельно в защищённом месте.

## Разработка и проверки

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
PYTHONPATH=backend .venv/bin/pytest backend/tests -q
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
```

Для локальной разработки задайте DATABASE_URL (SQLite допустим только для разработки), ADMIN_PASSWORD_HASH, DATA_DIR, TEMPLATES_DIR и COOKIE_SECURE=false; запустите uvicorn из backend на 8000 и `npm --prefix frontend run dev` на 5173. В production COOKIE_SECURE всегда true. Для тестов PostgreSQL задайте TEST_DATABASE_URL отдельной тестовой базы: каждый тест использует и удаляет собственную схему.

`PYTHONPATH=backend .venv/bin/python scripts/qa_documents.py /tmp/pact-qa` — генератор контрольных документов. `scripts/prepare_templates.py` воспроизводит подготовку шаблонов из `templates/source`. Изменение шаблона требует новой версии, проверки условий, рендера и просмотра всех страниц. Подробности — `docs/artifact.md`.

Первая версия: один аккаунт, организации и ИП, рубли, ручной номер, без отдельного НДС и электронной подписи. Точность количества — до 3 знаков, цены — до 2. Сумма каждой строки округляется до копеек HALF_UP; итог — сумма округлённых строк. Спецификация ограничена 200 позициями. PDF-конвертация выполняется последовательно и имеет тайм-аут 90 секунд.

## Автоматизированное обновление

`./scripts/deploy.sh --check` запускает локальные проверки. `./scripts/deploy.sh` обновляет native-сервер с резервной копией и откатом при ошибке. Подключение — по SSH-ключу. [Настройка и ограничения](docs/deploy-script.md).
