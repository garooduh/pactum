import hashlib
import shutil
import os
from pathlib import Path
import secrets
import time
from uuid import uuid4
from contextlib import asynccontextmanager

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select, delete, update, func
from sqlalchemy.exc import IntegrityError

from .database import Base, Account, SessionToken, LoginAttempt, Supplier, Contract, Issue, SchemaVersion, connect, now
from .schemas import Profile, ContractData, SaveContract, Login, Generate, validate_generation, validate_party
from .defaults import DEFAULT_PROFILE, SOURCE_NOTES
from .documents import generate_docx, convert_pdf, template_info

HASHER=PasswordHasher()
COOKIE='pact_session'

def create_app(database_url=None, data_dir=None, secure_cookie=None):
    engine, Session = connect(database_url)
    storage=Path(data_dir or os.getenv('DATA_DIR','/data'))
    secure=secure_cookie if secure_cookie is not None else os.getenv('COOKIE_SECURE','true')=='true'

    @asynccontextmanager
    async def lifespan(app):
        storage.mkdir(parents=True,exist_ok=True)
        # v1 is the initial schema. Later releases must explicitly migrate before startup.
        Base.metadata.create_all(engine)
        with Session.begin() as db:
            version=db.get(SchemaVersion,1)
            if version is None: db.add(SchemaVersion(id=1))
            if not db.get(Account,1):
                password_hash=os.getenv('ADMIN_PASSWORD_HASH','')
                try: HASHER.check_needs_rehash(password_hash)
                except (InvalidHashError, VerificationError): raise RuntimeError('Set ADMIN_PASSWORD_HASH using scripts/password_hash.py') from None
                db.add(Account(id=1,username=os.getenv('ADMIN_USERNAME','admin'),password_hash=password_hash))
            if not db.get(Supplier,1): db.add(Supplier(id=1,data=DEFAULT_PROFILE.model_dump(exclude={'revision'}),revision=0))
            # A crashed generator retains a downloadable DOCX and offers a PDF retry.
            for issue in db.scalars(select(Issue).where(Issue.status.in_(['generating','converting']))):
                folder=storage/issue.id
                issue.status='ready' if (folder/'contract.pdf').exists() else ('pdf_failed' if (folder/'contract.docx').exists() else 'failed')
        yield
        engine.dispose()

    app=FastAPI(title='Пакт — договоры',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.Session=Session
    app.state.storage=storage

    @app.middleware('http')
    async def security(request: Request, call_next):
        if request.method in ['POST','PUT','PATCH','DELETE']:
            # Same-origin custom header forces cross-origin clients through denied preflight.
            if request.headers.get('x-pact-request')!='1':
                return JSONResponse({'detail':'Запрос отклонён'},status_code=403)
            origin=request.headers.get('origin')
            expected=os.getenv('APP_ORIGIN','').rstrip('/')
            if origin and origin.rstrip('/')!=(expected or str(request.base_url).rstrip('/')):
                return JSONResponse({'detail':'Запрос с другого сайта отклонён'},status_code=403)
            try: length=int(request.headers.get('content-length','0'))
            except ValueError: return JSONResponse({'detail':'Некорректный запрос'},status_code=400)
            if length>1_000_000: return JSONResponse({'detail':'Слишком большой запрос'},status_code=413)
            body=await request.body()
            if len(body)>1_000_000: return JSONResponse({'detail':'Слишком большой запрос'},status_code=413)
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['X-Frame-Options']='DENY'
        response.headers['Referrer-Policy']='same-origin'
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's default payload includes user input. Return only field locations.
        fields={'.'.join(str(x) for x in err['loc'][1:]):'Проверьте значение поля' for err in exc.errors()}
        return JSONResponse({'detail':{'message':'Проверьте введённые данные','fields':fields}},status_code=422)

    def authenticated(request: Request):
        token=request.cookies.get(COOKIE,'')
        digest=hashlib.sha256(token.encode()).hexdigest()
        with Session() as db:
            session=db.get(SessionToken,digest)
            if not session or session.expires<time.time(): raise HTTPException(401,'Войдите в личный кабинет')
        return digest

    def profile_value(row): return {**row.data,'revision':row.revision}
    def issue_value(issue):
        return {'id':issue.id,'contract_id':issue.contract_id,'revision':issue.revision,'created_at':issue.created_at,'status':issue.status,'template_version':issue.template_version,'has_docx':(storage/issue.id/'contract.docx').exists(),'has_pdf':(storage/issue.id/'contract.pdf').exists()}
    def contract_value(row,db,details=True):
        issues=list(db.scalars(select(Issue).where(Issue.contract_id==row.id).order_by(Issue.created_at.desc())))
        value={'id':row.id,'revision':row.revision,'created_at':row.created_at,'updated_at':row.updated_at,'number':row.number,'customer':row.customer,'type':row.data['type'],'date':row.data['date'],'issues':[issue_value(i) for i in issues]}
        if details: value['data']=row.data
        return value
    def get_contract(db,contract_id):
        row=db.get(Contract,contract_id)
        if not row: raise HTTPException(404,'Договор не найден')
        return row

    @app.get('/api/health')
    def health():
        with Session() as db: db.execute(select(1))
        return {'status':'ok'}

    @app.post('/api/login')
    def login(payload:Login, response:Response):
        with Session.begin() as db:
            account=db.scalar(select(Account).where(Account.id==1).with_for_update())
            db.execute(delete(LoginAttempt).where(LoginAttempt.timestamp<time.time()-900))
            attempts=db.scalar(select(func.count()).select_from(LoginAttempt))
            if attempts>=10: raise HTTPException(429,'Слишком много попыток. Повторите через 15 минут.')
            db.add(LoginAttempt(timestamp=time.time()))
            # Commit failed attempts too; do not raise until the transaction is committed.
            try: valid=HASHER.verify(account.password_hash,payload.password) and secrets.compare_digest(account.username.encode(),payload.username.encode())
            except (VerificationError, InvalidHashError): valid=False
            if valid:
                db.execute(delete(LoginAttempt))
                db.execute(delete(SessionToken).where(SessionToken.expires<time.time()))
                token=secrets.token_urlsafe(48)
                db.add(SessionToken(token_hash=hashlib.sha256(token.encode()).hexdigest(),expires=time.time()+7*86400))
        if not valid: raise HTTPException(401,'Неверный логин или пароль')
        response.set_cookie(COOKIE,token,httponly=True,secure=secure,samesite='strict',max_age=7*86400,path='/')
        return {'ok':True}

    @app.get('/api/me',dependencies=[Depends(authenticated)])
    def me(): return {'username':os.getenv('ADMIN_USERNAME','admin')}

    @app.post('/api/logout')
    def logout(response:Response, token=Depends(authenticated)):
        with Session.begin() as db: db.execute(delete(SessionToken).where(SessionToken.token_hash==token))
        response.delete_cookie(COOKIE,path='/',secure=secure,httponly=True,samesite='strict')
        return {'ok':True}

    @app.get('/api/profile',dependencies=[Depends(authenticated)])
    def profile():
        with Session() as db: return {'profile':profile_value(db.get(Supplier,1)),'source_notes':SOURCE_NOTES}

    @app.put('/api/profile',dependencies=[Depends(authenticated)])
    def save_profile(payload:Profile):
        if payload.party.kind!='ip': raise HTTPException(422,'Профиль исполнителя предназначен для ИП')
        if payload.verified:
            errors=validate_party(payload.party,'supplier')
            if errors: raise HTTPException(422,{'message':'Проверьте реквизиты исполнителя','fields':errors})
        with Session.begin() as db:
            result=db.execute(update(Supplier).where(Supplier.id==1,Supplier.revision==payload.revision).values(data=payload.model_dump(exclude={'revision'}),revision=payload.revision+1))
            if not result.rowcount: raise HTTPException(409,'Профиль изменён на другом устройстве. Обновите страницу.')
            return profile_value(db.get(Supplier,1))

    @app.get('/api/contracts',dependencies=[Depends(authenticated)])
    def list_contracts(q:str='',offset:int=0):
        with Session() as db:
            query=select(Contract)
            if q:
                escaped=q[:100].replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
                query=query.where(Contract.number.ilike(f'%{escaped}%',escape='\\') | Contract.customer.ilike(f'%{escaped}%',escape='\\'))
            rows=db.scalars(query.order_by(Contract.updated_at.desc()).offset(max(0,offset)).limit(50))
            return [contract_value(row,db,False) for row in rows]

    @app.post('/api/contracts',dependencies=[Depends(authenticated)])
    def create_contract(payload:ContractData):
        with Session.begin() as db:
            row=Contract(id=str(uuid4()),data=payload.model_dump(),number=payload.number,customer=payload.customer.short_name or payload.customer.full_name,revision=0)
            db.add(row); db.flush()
            return contract_value(row,db)

    @app.get('/api/contracts/{contract_id}',dependencies=[Depends(authenticated)])
    def read_contract(contract_id:str):
        with Session() as db: return contract_value(get_contract(db,contract_id),db)

    @app.put('/api/contracts/{contract_id}',dependencies=[Depends(authenticated)])
    def save_contract(contract_id:str,payload:SaveContract):
        with Session.begin() as db:
            get_contract(db,contract_id)
            result=db.execute(update(Contract).where(Contract.id==contract_id,Contract.revision==payload.revision).values(data=payload.data.model_dump(),revision=payload.revision+1,number=payload.data.number,customer=payload.data.customer.short_name or payload.data.customer.full_name,updated_at=now()))
            if not result.rowcount: raise HTTPException(409,'Договор изменён на другом устройстве. Скопируйте ваши изменения или перезагрузите договор.')
            return contract_value(db.get(Contract,contract_id),db)

    @app.delete('/api/contracts/{contract_id}',dependencies=[Depends(authenticated)])
    def delete_contract(contract_id:str, revision:int):
        with Session.begin() as db:
            row=db.scalar(select(Contract).where(Contract.id==contract_id).with_for_update())
            if not row: raise HTTPException(404,'Договор не найден')
            if row.revision!=revision: raise HTTPException(409,'Договор изменён. Обновите список перед удалением.')
            versions=list(db.scalars(select(Issue).where(Issue.contract_id==contract_id).with_for_update()))
            if any(i.status in ['generating','converting'] for i in versions):
                raise HTTPException(409,'Дождитесь завершения формирования документов')
            folders=[storage/i.id for i in versions]
            for issue in versions: db.delete(issue)
            db.delete(row)
        for folder in folders: shutil.rmtree(folder,ignore_errors=True)
        return {'deleted':True}

    @app.delete('/api/issues/{issue_id}',dependencies=[Depends(authenticated)])
    def delete_issue(issue_id:str):
        with Session.begin() as db:
            candidate=db.get(Issue,issue_id)
            if not candidate: raise HTTPException(404,'Версия не найдена')
            db.scalar(select(Contract).where(Contract.id==candidate.contract_id).with_for_update())
            issue=db.scalar(select(Issue).where(Issue.id==issue_id).with_for_update().execution_options(populate_existing=True))
            if not issue: raise HTTPException(404,'Версия не найдена')
            if issue.status in ['generating','converting']: raise HTTPException(409,'Дождитесь завершения формирования документов')
            db.delete(issue)
        shutil.rmtree(storage/issue_id,ignore_errors=True)
        return {'deleted':True}

    @app.post('/api/contracts/{contract_id}/copy',dependencies=[Depends(authenticated)])
    def copy_contract(contract_id:str):
        with Session.begin() as db:
            old=get_contract(db,contract_id)
            data={**old.data,'number':'','date':''}
            row=Contract(id=str(uuid4()),data=data,number='',customer=old.customer,revision=0)
            db.add(row); db.flush()
            return contract_value(row,db)

    @app.post('/api/contracts/{contract_id}/generate',dependencies=[Depends(authenticated)])
    def generate(contract_id:str,payload:Generate):
        with Session.begin() as db:
            db.scalar(select(Contract).where(Contract.id==contract_id).with_for_update())
            row=get_contract(db,contract_id)
            previous=db.scalar(select(Issue).where(Issue.request_id==payload.request_id))
            if previous:
                if previous.contract_id!=contract_id: raise HTTPException(409,'Ключ запроса уже использован')
                return issue_value(previous)
            if row.revision!=payload.revision: raise HTTPException(409,'Сначала сохраните текущие изменения')
            supplier=Profile(**profile_value(db.get(Supplier,1))); data=ContractData(**row.data)
            errors=validate_generation(data,supplier)
            if errors: raise HTTPException(422,{'message':'Заполните обязательные поля перед формированием','fields':errors})
            issue=Issue(id=str(uuid4()),contract_id=contract_id,request_id=payload.request_id,revision=row.revision,snapshot={'contract':data.model_dump(),'supplier':supplier.model_dump()},template_version=template_info(data.type)['version'],status='generating')
            db.add(issue); db.flush(); issue_id=issue.id
        folder=storage/issue_id
        try:
            generate_docx(data,supplier,folder/'contract.docx')
            with Session.begin() as db: db.get(Issue,issue_id).status='converting'
            try: convert_pdf(folder/'contract.docx',folder/'contract.pdf'); status='ready'
            except (OSError, RuntimeError, TimeoutError, __import__('subprocess').SubprocessError): status='pdf_failed'
        except Exception:
            status='failed'
        with Session.begin() as db:
            issue=db.get(Issue,issue_id); issue.status=status
            return issue_value(issue)

    @app.post('/api/issues/{issue_id}/retry-pdf',dependencies=[Depends(authenticated)])
    def retry_pdf(issue_id:str):
        with Session.begin() as db:
            issue=db.scalar(select(Issue).where(Issue.id==issue_id).with_for_update())
            if not issue: raise HTTPException(404,'Версия не найдена')
            if issue.status=='ready': return issue_value(issue)
            if issue.status!='pdf_failed': raise HTTPException(409,'Эту версию сейчас нельзя преобразовать')
            issue.status='converting'
        folder=storage/issue_id
        try: convert_pdf(folder/'contract.docx',folder/'contract.pdf'); status='ready'
        except (OSError, RuntimeError, TimeoutError, __import__('subprocess').SubprocessError): status='pdf_failed'
        with Session.begin() as db:
            issue=db.get(Issue,issue_id); issue.status=status
            return issue_value(issue)

    @app.get('/api/issues/{issue_id}/files/{format}',dependencies=[Depends(authenticated)])
    def download(issue_id:str,format:str):
        if format not in ['docx','pdf']: raise HTTPException(404,'Файл не найден')
        with Session() as db:
            issue=db.get(Issue,issue_id)
            if not issue: raise HTTPException(404,'Версия не найдена')
            path=storage/issue.id/f'contract.{format}'
            if not path.exists(): raise HTTPException(404,'Файл ещё не готов')
            number=issue.snapshot['contract']['number']
            safe=''.join(c for c in number if c.isalnum() or c in '-_')[:60] or 'без-номера'
            return FileResponse(path,filename=f'Договор-{safe}.{format}',media_type='application/pdf' if format=='pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return app

# Factory invocation keeps tests isolated and avoids implicit DB connections on import.
