from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_max_length=10000)

    @field_validator('*', mode='before')
    @classmethod
    def clean_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value):
                raise ValueError('Недопустимый символ в тексте')
        return value

class Party(Model):
    kind: Literal['company', 'ip'] = 'company'
    full_name: str = ''
    short_name: str = ''
    address: str = ''
    inn: str = ''
    kpp: str = ''
    registration: str = ''
    bank: str = ''
    account: str = ''
    correspondent: str = ''
    bik: str = ''
    phone: str = ''
    email: str = ''
    representative: bool = True
    position: str = ''
    position_genitive: str = ''
    person: str = ''
    person_genitive: str = ''
    signature: str = ''
    basis: str = ''

    @field_validator('inn', 'kpp', 'registration', 'account', 'correspondent', 'bik', mode='before')
    @classmethod
    def normalize_requisite(cls, value):
        # Accept numbers copied with spaces, without numeric conversion or truncation.
        return re.sub(r'\s+', '', value) if isinstance(value, str) else value

class Profile(Model):
    party: Party
    verified: bool = False
    revision: int = 0

class Item(Model):
    name: str = ''
    unit: str = 'шт.'
    quantity: str = '1'
    price: str = ''
    material: str = ''
    dimensions: str = ''
    tolerance: str = ''

class Specification(Model):
    number: str = '1'
    items: list[Item] = Field(default_factory=lambda: [Item()], max_length=200)
    description: str = ''
    notes: str = ''
    coating: str = ''
    color: str = ''
    deadline: str = ''
    delivery: str = ''
    installation: str = ''

class ContractData(Model):
    type: Literal['simple', 'full'] = 'simple'
    number: str = Field(default='', max_length=100)
    date: str = ''
    city: str = 'Москва'
    title: str = ''
    payment_option: Literal['prepayment', 'other'] | None = None
    payment_other: str = ''
    # Kept for contracts created before payment_option was introduced.
    prepayment_percent: str = '100'
    balance_terms: str = 'в течение 3 банковских дней после передачи товара (результата работ)'
    customer: Party = Field(default_factory=Party)
    specification: Specification = Field(default_factory=Specification)

class SaveContract(Model):
    revision: int
    data: ContractData

class Login(Model):
    username: str = Field(max_length=100)
    password: str = Field(max_length=1024)

class Generate(Model):
    revision: int
    request_id: str = Field(pattern=r'^[a-zA-Z0-9-]{16,64}$')

CENT = Decimal('0.01')

def numeric(value: str, *, quantity=False) -> Decimal:
    normalized = value.replace(' ', '').replace('\u00a0', '').replace(',', '.')
    if not re.fullmatch(r'\d{1,12}(\.\d{1,3})?' if quantity else r'\d{1,12}(\.\d{1,2})?', normalized):
        raise ValueError('Введите число: до 3 знаков после запятой для количества, до 2 для цены')
    try:
        amount = Decimal(normalized)
    except InvalidOperation:
        raise ValueError('Введите число')
    if quantity and amount <= 0:
        raise ValueError('Количество должно быть больше нуля')
    return amount

def totals(spec: Specification):
    lines = [(numeric(i.quantity, quantity=True) * numeric(i.price)).quantize(CENT, rounding=ROUND_HALF_UP) for i in spec.items]
    return lines, sum(lines, Decimal('0.00'))

def validate_party(p: Party, prefix: str) -> dict[str, str]:
    errors = {}
    required = ['full_name', 'short_name', 'address', 'inn', 'registration', 'bank', 'account', 'correspondent', 'bik', 'signature']
    if p.kind == 'company':
        required += ['kpp']
    if p.kind == 'company' or p.representative:
        required += ['position', 'position_genitive', 'person', 'person_genitive', 'basis']
    for key in required:
        if not getattr(p, key):
            errors[f'{prefix}.{key}'] = 'Заполните поле'
    for key, lengths in [('inn', [10] if p.kind == 'company' else [12]), ('kpp', [9]), ('registration', [13] if p.kind == 'company' else [15]), ('account', [20]), ('correspondent', [20]), ('bik', [9])]:
        value = getattr(p, key)
        if key == 'kpp' and p.kind == 'ip':
            continue
        if value and (not value.isascii() or not value.isdigit() or len(value) not in lengths):
            errors[f'{prefix}.{key}'] = (f'Нужно {lengths[0]} цифр, введено {len(value)}' if value.isascii() and value.isdigit() else 'Допустимы только цифры от 0 до 9')
    if p.email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', p.email):
        errors[f'{prefix}.email'] = 'Проверьте адрес почты'
    return errors

def payment_percent(value: str) -> int:
    if not re.fullmatch(r'[0-9]{1,3}', value) or not 0 <= int(value) <= 100:
        raise ValueError('Введите целый процент от 0 до 100')
    return int(value)

def validate_generation(data: ContractData, profile: Profile):
    errors = validate_party(data.customer, 'customer')
    if data.payment_option == 'other':
        if not data.payment_other.strip():
            errors['payment_other'] = 'Укажите условия оплаты'
    elif data.payment_option is None:
        # Validate legacy drafts that still use a percentage and balance term.
        try:
            percent = payment_percent(data.prepayment_percent)
            if percent < 100 and not data.balance_terms.strip():
                errors['balance_terms'] = 'Укажите срок оплаты остатка'
        except ValueError as error:
            errors['prepayment_percent'] = str(error)
    errors.update(validate_party(profile.party, 'supplier'))
    if not profile.verified:
        errors['supplier.verified'] = 'Проверьте и подтвердите профиль исполнителя'
    for key in ['number', 'city', 'date']:
        if not getattr(data, key):
            errors[key] = 'Заполните поле'
    try:
        date.fromisoformat(data.date)
    except ValueError:
        errors['date'] = 'Укажите корректную дату'
    if data.type == 'full':
        for key in ['title']:
            if not getattr(data, key):
                errors[key] = 'Заполните поле'
        spec = data.specification
        for key in ['number', 'description', 'deadline', 'delivery', 'installation']:
            if not getattr(spec, key):
                errors[f'specification.{key}'] = 'Заполните поле'
        if not spec.items:
            errors['specification.items'] = 'Добавьте хотя бы одну позицию'
        for index, item in enumerate(spec.items):
            for key in ['name', 'unit']:
                if not getattr(item, key):
                    errors[f'specification.items.{index}.{key}'] = 'Заполните поле'
            for key in ['quantity', 'price']:
                try:
                    numeric(getattr(item, key), quantity=key == 'quantity')
                except ValueError as error:
                    errors[f'specification.items.{index}.{key}'] = str(error)
    return errors
