from .schemas import Party, Profile

DEFAULT_PROFILE = Profile(party=Party(
    kind='ip', full_name='Индивидуальный предприниматель Бобров Тимофей Дмитриевич',
    short_name='ИП Бобров Т.Д.', inn='503831150903', registration='325774600590281',
    bank='АО «ТБанк»', bik='044525974', account='40802810200008681350',
    email='Snab-c@list.ru', phone='+7-985-222-0135',
    representative=False, person='Бобров Тимофей Дмитриевич', signature='Бобров Т.Д.',
))
SOURCE_NOTES = [
    {'field': 'address', 'label': 'Адрес', 'full': '117321, Москва г., Профсоюзная ул., д. 152/4, кв.124', 'simple': '141232, Россия, Ул.Профсоюзная, д. 152, кв.124'},
    {'field': 'bank', 'label': 'Банк', 'full': 'АО «ТБанк»', 'simple': 'Не заполнен'},
    {'field': 'account', 'label': 'Расчётный счёт', 'full': '40802810200008681350', 'simple': 'Не заполнен'},
    {'field': 'bik', 'label': 'БИК', 'full': '044525974', 'simple': 'Не заполнен'},
    {'field': 'correspondent', 'label': 'Корреспондентский счёт', 'full': 'Не заполнен', 'simple': 'Не заполнен'},
]
