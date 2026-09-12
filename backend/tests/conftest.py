import os
from pathlib import Path
import pytest
from uuid import uuid4
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from app.main import create_app
from app.schemas import Party, Profile, ContractData, Specification, Item

@pytest.fixture
def supplier():
    return Profile(party=Party(kind='ip',full_name='Индивидуальный предприниматель Бобров Тимофей Дмитриевич',short_name='ИП Бобров Т.Д.',address='117321, г. Москва, ул. Профсоюзная, д. 152/4, кв. 124',inn='503831150903',registration='325774600590281',bank='Тестовый банк',account='40802810000000000001',correspondent='30101810000000000001',bik='044525001',signature='Бобров Т.Д.',representative=False),verified=True)

@pytest.fixture
def contract():
    return ContractData(type='full',number='ТЕСТ-12/26',date='2026-09-07',city='Москва',title='Изготовление металлического оборудования',customer=Party(full_name='Общество с ограниченной ответственностью «Новый заказчик»',short_name='ООО «Новый заказчик»',address='123456, г. Москва, ул. Примерная, д. 10, офис 2',inn='1234567890',kpp='123456789',registration='1234567890123',bank='Тестовый банк',account='40702810000000000001',correspondent='30101810000000000001',bik='044525001',phone='+7 900 000-00-00',email='test@example.org',position='Генеральный директор',position_genitive='генерального директора',person='Иванов Иван Иванович',person_genitive='Иванова Ивана Ивановича',signature='Иванов И.И.',basis='устава'),specification=Specification(items=[Item(name='Изготовление опорной рамы',unit='шт.',quantity='2,5',price='1234,57',material='Сталь',dimensions='500 × 800',tolerance='±2 мм'),Item(name='Защитный кожух',quantity='1',price='2500')],description='Металлическая рама для крепления оборудования.\nИзготовление по согласованному чертежу.',notes='Размеры проверить перед изготовлением.',coating='Порошковая краска',color='RAL 9016',deadline='20 рабочих дней с даты оплаты.',delivery='Самовывоз со склада исполнителя.',installation='Не входит в стоимость.'))

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('ADMIN_PASSWORD_HASH',PasswordHasher().hash('test-password-long'))
    monkeypatch.setenv('ADMIN_USERNAME','admin')
    test_url=os.getenv('TEST_DATABASE_URL')
    schema='pact_test_'+uuid4().hex
    connection=None
    if test_url:
        import psycopg
        from psycopg import sql
        connection=psycopg.connect(test_url.replace('postgresql+psycopg://','postgresql://'),autocommit=True)
        connection.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        database_url=test_url+'?options=-csearch_path%3D'+schema
    else:
        database_url='sqlite:///'+str(tmp_path/'test.db')
    app=create_app(database_url,tmp_path/'files',secure_cookie=False)
    try:
        with TestClient(app,headers={'X-Pact-Request':'1'}) as client:
            yield client
    finally:
        if connection:
            connection.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
            connection.close()

@pytest.fixture
def logged(client):
    assert client.post('/api/login',json={'username':'admin','password':'test-password-long'}).status_code==200
    return client
