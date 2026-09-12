import pytest
from app.schemas import Party, validate_party

@pytest.mark.parametrize('kind,key,length', [('company','inn',10),('ip','inn',12),('company','registration',13),('ip','registration',15),('company','kpp',9),('ip','bik',9),('ip','account',20),('ip','correspondent',20)])
def test_requisite_lengths(kind,key,length):
    for size in [length-1,length,length+1]:
        value='0'+'1'*(size-1)
        p=Party(kind=kind,**{key:value})
        assert getattr(p,key)==value
        assert (f'customer.{key}' in validate_party(p,'customer')) == (size!=length)

def test_pasted_spaces_and_leading_zeroes():
    p=Party(account=' 00123\u00a045678\u202f90123 45678\n')
    assert p.account=='00123456789012345678'
    assert 'customer.account' not in validate_party(p,'customer')

@pytest.mark.parametrize('value',['12345a789','12345-789','１２３４５６７８９'])
def test_invalid_characters_are_not_silently_removed(value):
    p=Party(bik=value)
    assert p.bik==value
    assert 'customer.bik' in validate_party(p,'customer')
