#!/usr/bin/env python3
"""Isolated nginx/API smoke test; requires Docker and locally built images."""
import json, os, pathlib, subprocess, tempfile, time, urllib.request, urllib.error, zipfile, io
repo=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='.www2-smoke-', dir=repo) as tmp:
    root=pathlib.Path(tmp); root.chmod(0o755)
    for name in ['downloads','state']:
        (root/name).mkdir(); (root/name).chmod(0o777)
    services={
      'it-api': {'image':'iqb-berlin/www2-it-api:latest','environment':{
        'DOWNLOADS_DIR':'/data/downloads','STATE_DIR':'/data/state',
        'PC_UPDATE_TOKEN':'smoke-pc-token-123456789','UPLOAD_TOKENS':'tester:smoke-upload-token-123456789',
        'PC_UPDATE_ALLOW_CIDRS':'127.0.0.1/32,198.51.100.10/32'},
        'volumes':[f'{repo}/api/src:/app/src:ro',f'{root}/downloads:/data/downloads',f'{root}/state:/data/state']},
      'web': {'image':'nginxinc/nginx-unprivileged:stable','environment':{'TRUSTED_PROXY_CIDR':'127.0.0.1/32'},
        'ports':['127.0.0.1::8080'], 'volumes':[
          f'{repo}/config/default.conf.template:/etc/nginx/templates/default.conf.template:ro',
          f'{repo}/config/assets:/usr/share/nginx/html:ro',f'{root}/downloads:/srv/www/it/dl:ro']}}
    conf=root/'compose.json'; conf.write_text(json.dumps({'services':services}))
    cmd=['docker','compose','-p','www2-smoke-'+str(os.getpid()),'-f',str(conf)]
    def run(*args):return subprocess.check_output(cmd+list(args),stderr=subprocess.STDOUT,text=True).strip()
    try:
        print(run('up','-d','--pull','never'),flush=True)
        base='http://'+run('port','web','8080')
        def request(route, data=None, headers=None, method=None):
            try:
                with urllib.request.urlopen(urllib.request.Request(base+route,data=data,headers=headers or {},method=method),timeout=5) as r:return r.status,r.read(),r.headers
            except urllib.error.HTTPError as e:return e.code,e.read(),e.headers
        for attempt in range(40):
            try:
                if request('/it/api/health')[0]==200:break
            except (OSError,urllib.error.URLError):pass
            time.sleep(.25)
        else:raise AssertionError('stack not healthy')
        assert json.loads(request('/it/api/pcs')[1])['status']=='unavailable'
        headers={'Authorization':'Bearer smoke-pc-token-123456789','Content-Type':'application/json','X-Forwarded-For':'198.51.100.10','X-Real-IP':'198.51.100.10'}
        assert request('/it/api/pcs',b'[]',headers)[0]==403, 'direct client must not spoof allowed source'
        # Local nginx request simulates an explicitly trusted proxy peer.
        result=run('exec','-T','web','curl','-sS','-o','/dev/null','-w','%{http_code}',
            '-H','Authorization: Bearer smoke-pc-token-123456789','-H','X-Forwarded-For: 198.51.100.10',
            '-H','Content-Type: application/json','--data','[".88 REMOTE"]','http://127.0.0.1:8080/it/api/pcs')
        assert result=='204', result
        assert json.loads(request('/it/api/pcs')[1])['status']=='fresh'
        state=root/'state/pcs.json'; d=json.loads(state.read_text());d['updatedAt']='2020-01-01T00:00:00Z';state.write_text(json.dumps(d))
        assert json.loads(request('/it/api/pcs')[1])['status']=='stale'
        print('PASS: real proxy trust, spoof rejection, producer POST, fresh/stale API',flush=True)
        def upload(version):
            content=io.BytesIO()
            with zipfile.ZipFile(content,'w') as z:
                z.writestr('setup.exe',version)
                z.writestr('IQB-Kodieren.application',f'<assemblyIdentity name="IQB-Kodieren.application" version="{version}" />')
                z.writestr('Application Files/'+version+'/app.exe.deploy',version)
            return request('/it/api/apps/IQB-Kodieren',content.getvalue(),{'Authorization':'Bearer smoke-upload-token-123456789','Content-Type':'application/zip'},'PUT')
        assert upload('1.0.0.0')[0]==201
        assert upload('2.0.0.0')[0]==200
        for prefix in ['/it/dl/','/institut/ab/it/','/institut/ab/']:
            status,body,headers=request(prefix+'IQB-Kodieren/setup.exe');assert status==200 and body==b'2.0.0.0'
            status,body,headers=request(prefix+'IQB-Kodieren/IQB-Kodieren.application');assert status==200
            assert headers.get_content_type()=='application/x-ms-application'
            status,body,headers=request(prefix+'IQB-Kodieren/Application%20Files/1.0.0.0/app.exe.deploy');assert status==200 and body==b'1.0.0.0'
        assert request('/it/dl/IQB-Kodieren/.publish.json')[0]==403
        assert request('/it/dl/.releases/')[0]==403
        assert json.loads(request('/it/api/apps')[1])['apps'][0]['version']=='2.0.0.0'
        assert request('/it/IQB-Kodieren/')[0]==200
        assert request('/it/available-pcs/')[0]==200
        print('PASS: two ZIP publications, relative symlinks through nginx, legacy paths, MIME types, old payloads, hidden files, app listing and pages',flush=True)
    except Exception as err:
        print(getattr(err, "output", str(err)), flush=True)
        print(run('logs','--tail','40'),flush=True)
        raise
    finally:
        print(run('down','--volumes'),flush=True)
