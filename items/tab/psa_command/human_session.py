"""Human-only PSA session broker. Never imported by the MCP bridge.

Passwords are transient input. The website JWT stays in this tab's encrypted,
per-Kairos-user store and is never put in chat, tools, snapshots or settings.
"""
import base64
import json
import re
import threading
import uuid
from datetime import datetime,timezone
from urllib.parse import urlsplit
from . import catalog

CAPABILITIES=('schools:import','outreach:read','outreach:prepare','outreach:send','library:manage','commissions:manage','team:manage')
UUID=r'[A-Za-z0-9_-]{1,100}'
READS=re.compile(rf'^/api/(?:outreach/campaign-plans(?:/{UUID}(?:/summary)?)?|agent-outreach-drafts(?:/{UUID})?|outreach/(?:limits|worker|templates|template-assets|sequences|sequence-originals|sequence-enrollments)|profile)$')
WRITES=re.compile(rf'^/api/(?:outreach/campaign-plans/{UUID}/(?:approve|pause|resume|cancel|refresh)|email-settings|agent-outreach-drafts/{UUID}/(?:refresh|approve|revoke)|outreach/(?:templates|templates/seed-winter-2027|template-imports/{UUID}/commit|sequences|sequence-enrollments/(?:preview|commit)|sequence-enrollments/\d+/cancel|sequence-steps/\d+/(?:preview|approve)))$')

def origin(base):
    base=catalog.check_base_url(base,'psa')
    if urlsplit(base).path!='/api/agent/v1':raise ValueError('Use the PSA API address ending in /api/agent/v1')
    parsed=urlsplit(base)
    if parsed.hostname not in catalog.LOCAL_HOSTS and (parsed.hostname!='psa-sales-backend.onrender.com' or parsed.port not in (None,443)):
        raise ValueError('Password sign-in is limited to the PSA production API or a local test server')
    return base[:-len('/api/agent/v1')]

class HumanSession:
    def __init__(self,api,save_connection,transport=None):
        self.api,self.save_connection,self.transport=api,save_connection,transport
        self.lock=threading.Lock()
    def status(self,user):
        entry=self.api.read_json('human-session.json',{}).get(user)
        if not entry:return {'connected':False}
        return {'connected':entry['expires_at']>datetime.now(timezone.utc).timestamp(),
            'employee':entry['employee'],'expires_at':datetime.fromtimestamp(entry['expires_at'],timezone.utc).isoformat(),
            'key_id':entry['key_id']}
    def _call(self,root,token,method,path,body=None,params=None):
        from urllib.parse import urlencode
        url=root+path
        if params:url+='?'+urlencode({k:v for k,v in params.items() if v is not None})
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        status,data=(self.transport or catalog.urllib_transport)(method,url,headers,body)
        if status>=400:
            # Never echo remote login errors, tokens or credential values.
            if status==401:raise catalog.ApiError('Sign in to PSA again inside Kairos.',401)
            if path=='/api/login':raise catalog.ApiError('PSA sign-in failed. Check your email and password.',status)
            raise catalog.ApiError(f'PSA {status}: '+str(data.get('error','Request failed'))[:250],status)
        return data
    def connect(self,user,base,email,password,capabilities,scope='read',days=30,confirm_send=False,create_key=True):
        root=origin(base)
        full_access=scope=='full'
        if not isinstance(email,str) or not isinstance(password,str) or not email.strip() or not password:raise ValueError('Enter your PSA email and password')
        if scope not in ('read','write','full') or type(days) is not int or days not in (7,30,90):raise ValueError('Choose valid access and expiry')
        if not isinstance(capabilities,list) or any(c not in CAPABILITIES for c in capabilities):raise ValueError('Choose valid optional permissions')
        if scope != 'full' and 'outreach:send' in capabilities and confirm_send is not True:raise ValueError('Explicitly delegate approved sending')
        login=self._call(root,None,'POST','/api/login',{'email':email,'password':password})
        token=login['access_token'];employee=login['user']
        # The private sign-in form explicitly describes this preset. Determine
        # admin-only grants from the authenticated employee, never a UI claim.
        if scope == 'full':
            scope='write'
            admin_only={'library:manage','commissions:manage','team:manage'}
            capabilities=[cap for cap in CAPABILITIES if employee.get('admin') or cap not in admin_only]
            confirm_send=True
        # Display/storage expiry only. The PSA API validates the JWT on every call.
        try:
            encoded=token.split('.')[1];expires=float(json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))['exp'])
        except (ValueError,KeyError,IndexError,TypeError):raise ValueError('PSA returned an invalid session')
        old=self.api.read_json('human-session.json',{}).get(user)
        if not create_key:
            if not old or old['root']!=root or old['employee']['id']!=employee['id']:raise ValueError('Sign in as the previously connected employee, or explicitly create a new connection')
            keys=self._call(root,token,'GET','/api/agent-keys')['items']
            if not any(k['id']==old['key_id'] and not k.get('expired') and not k.get('revoked') for k in keys):raise ValueError('Your old key is inactive. Explicitly create a new connection.')
            if full_access:
                self._call(root,token,'POST','/api/agent-keys/'+str(old['key_id'])+'/full-access',{'confirm_full_access':True})
            entry={**old,'token':self.api.encrypt(token),'expires_at':expires,'employee':{k:employee.get(k) for k in ('id','name','email','admin','mail_connected')}}
            with self.lock:
                sessions=self.api.read_json('human-session.json',{});sessions[user]=entry;self.api.write_json('human-session.json',sessions)
            return self.status(user)
        made=self._call(root,token,'POST','/api/agent-keys',{'name':'Kairos PSA Command','scope':scope,'expires_in_days':days,
            'capabilities':capabilities,'confirm_send':confirm_send})
        entry={'root':root,'token':self.api.encrypt(token),'key_id':made['id'],'expires_at':expires,
            'employee':{k:employee.get(k) for k in ('id','name','email','admin','mail_connected')}}
        try:
            self.save_connection(user,'psa',base,made['key'])
            with self.lock:
                all_sessions=self.api.read_json('human-session.json',{});all_sessions[user]=entry
                self.api.write_json('human-session.json',all_sessions)
        except Exception:
            # Do not leave a freshly delegated key usable after failed setup.
            self._call(root,token,'DELETE','/api/agent-keys/'+str(made['id']))
            raise
        return {**self.status(user),'one_time_key':made['key'],'capabilities':made.get('capabilities',[])}
    def disconnect(self,user):
        with self.lock:
            sessions=self.api.read_json('human-session.json',{});sessions.pop(user,None)
            self.api.write_json('human-session.json',sessions)
        return {'connected':False}
    def revoke_connection(self,user):
        """Human button only: revoke this connection server-side before forgetting it.

        On network failure keep the session and key so the person can retry.
        Other installations/keys are never revoked implicitly.
        """
        entry=self.api.read_json('human-session.json',{}).get(user)
        if not entry or not self.status(user)['connected']:
            raise catalog.ApiError('Sign in to PSA inside Kairos before revoking this connection.',401)
        self._call(entry['root'],self.api.decrypt(entry['token']),'DELETE','/api/agent-keys/'+str(entry['key_id']))
        self.save_connection(user,'psa',clear=True)
        self.disconnect(user)
        return {'connected':False,'revoked':True}

    def request(self,user,method,path,body=None,params=None):
        if not ((method=='GET' and READS.fullmatch(path)) or (method=='POST' and WRITES.fullmatch(path)) or (method=='PUT' and re.fullmatch(r'/api/outreach/templates/\d+',path))):
            raise ValueError('This is not a supported human approval operation')
        if params and (not isinstance(params,dict) or set(params)-{'page','per_page','q','workspace'}):raise ValueError('Unsupported filters')
        if params and 'workspace' in params and params['workspace'] not in ('school','business'):raise ValueError('Choose school or business workspace')
        if method=='POST' and not isinstance(body,dict):raise ValueError('Supply the reviewed operation')
        if path=='/api/email-settings' and (set(body)!={'email_password'} or not isinstance(body['email_password'],str)):raise ValueError('Only your mail app password is accepted')
        entry=self.api.read_json('human-session.json',{}).get(user)
        if not entry or not self.status(user)['connected']:raise catalog.ApiError('Sign in to PSA inside Kairos first.',401)
        return self._call(entry['root'],self.api.decrypt(entry['token']),method,path,body,params)

    def upload(self,user,kind,filename,encoded,workspace='school'):
        if workspace not in ('school','business'):raise ValueError('Choose school or business workspace')
        if kind not in ('pdf','templates'):raise ValueError('Choose PDF catalog or template import')
        extension='.pdf' if kind=='pdf' else '.json'
        if not isinstance(filename,str) or not re.fullmatch(r'[A-Za-z0-9 _.-]{1,150}',filename) or not filename.lower().endswith(extension):raise ValueError('Choose a valid '+extension+' filename')
        limit=10*1024*1024 if kind=='pdf' else 1024*1024
        if not isinstance(encoded,str) or len(encoded)>((limit+2)//3)*4:raise ValueError('File is too large')
        try:raw=base64.b64decode(encoded,validate=True)
        except ValueError:raise ValueError('Invalid upload')
        if len(raw)>limit or (kind=='pdf' and not raw.startswith(b'%PDF-')):raise ValueError('Invalid or oversized file')
        entry=self.api.read_json('human-session.json',{}).get(user)
        if not entry or not self.status(user)['connected']:raise catalog.ApiError('Sign in to PSA inside Kairos first.',401)
        boundary='psa-'+uuid.uuid4().hex
        mime='application/pdf' if kind=='pdf' else 'application/json'
        data=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()+raw+f'\r\n--{boundary}--\r\n'.encode())
        path='/api/outreach/template-assets' if kind=='pdf' else '/api/outreach/template-imports/preview'
        headers={'Authorization':'Bearer '+self.api.decrypt(entry['token']),'Content-Type':'multipart/form-data; boundary='+boundary,'X-PSA-Workspace':workspace}
        status,result=(self.transport or catalog.urllib_transport)('POST',entry['root']+path,headers,data)
        if status>=400:raise catalog.ApiError('PSA upload failed: '+str(result.get('error','Request failed'))[:200],status)
        return result
