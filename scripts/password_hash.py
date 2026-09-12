#!/usr/bin/env python3
from getpass import getpass
from argon2 import PasswordHasher
password=getpass('Новый пароль (не менее 12 символов): ')
if len(password)<12: raise SystemExit('Пароль слишком короткий')
if password!=getpass('Повторите пароль: '): raise SystemExit('Пароли не совпали')
print("ADMIN_PASSWORD_HASH='"+PasswordHasher().hash(password)+"'")
