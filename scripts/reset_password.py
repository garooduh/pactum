"""Run inside the API container. Revoke all existing sessions on reset."""
from getpass import getpass
from argon2 import PasswordHasher
from sqlalchemy import delete
from app.database import connect, Account, SessionToken, LoginAttempt
password=getpass('Новый пароль (не менее 12 символов): ')
if len(password)<12: raise SystemExit('Пароль слишком короткий')
if password!=getpass('Повторите пароль: '): raise SystemExit('Пароли не совпали')
engine, Session=connect()
with Session.begin() as db:
    account=db.get(Account,1)
    if not account: raise SystemExit('Сначала запустите приложение')
    account.password_hash=PasswordHasher().hash(password)
    db.execute(delete(SessionToken));db.execute(delete(LoginAttempt))
print('Пароль изменён. Все сеансы завершены.')
