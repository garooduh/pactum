# Рабочее размещение — 07.09.2026

URL: https://pact-gen.bobserver.ru

- Приложение: Debian 12 LXC, 192.168.1.206, `/opt/pact`, systemd `pact.service`.
- Python 3.11, PostgreSQL 15, UTF8, LibreOffice 7.4.7. Один worker, последовательная PDF-конвертация; frontend собран локально.
- Внутренний Nginx: порт 8080. API: только 127.0.0.1:8000. PostgreSQL: локальный интерфейс.
- Внешний Nginx: 192.168.1.11, `/etc/nginx/sites-available/pact-gen.bobserver.ru`.
- HTTPS Let's Encrypt, автоматическое продление `certbot.timer`, HTTP перенаправляется на HTTPS.
- Секреты: `/etc/pact.env` (600). Первичные данные входа: `/root/pact-login.txt` (600).
- Документы: `/var/lib/pact/documents`. База `pact`, роль `pact`.
- Копии: `/var/backups/pact`, ежедневный `pact-backup.timer` в 03:30 по времени сервера. Копия от 07.09.2026 выполнена успешно. Вынос копий на другой сервер не настроен.

Проверены вход браузером через публичный HTTPS, health через внешний TLS reverse proxy, реальная генерация и скачивание обоих форматов обоих договоров через API рабочего приложения. Контрольные документы удалены по их конкретным UUID, исходный непроверенный профиль восстановлен. Проверена работа LibreOffice от пользователя pact. База при установке создана явно UTF8: исходный кластер LXC имел SQL_ASCII.

Для смены пароля от root на сервере приложения:

```sh
/opt/pact/.venv/bin/python - <<'PYTHON'
import os, runpy, sys
from pathlib import Path
for line in Path('/etc/pact.env').read_text().splitlines():
    key, value = line.split('=', 1)
    os.environ[key] = value
sys.path.insert(0, '/opt/pact/backend')
runpy.run_path('/opt/pact/scripts/reset_password.py', run_name='__main__')
PYTHON
```

Скрипт запрашивает новый пароль через терминал и завершает прежние сеансы. `/etc/pact.env` читается как EnvironmentFile, не через shell: Argon2-хеш содержит знаки `$`.

Обновление: удаление договора со всеми версиями (с проверкой ревизии), удаление отдельной версии, запрет удаления в процессе генерации. Новые поля черновика: prepayment_percent (целый процент 0–100, по умолчанию 100), balance_terms (срок оплаты остатка). Шаблоны v2 изменяют только пункт оплаты и блоки подписей: перед ними 3 дополнительных пустых строки, блок подписи не разбивается. Уже выпущенные файлы не перегенерируются. Схема БД не меняется. Удалённые файлы могут сохраняться в ранее созданных резервных копиях.
