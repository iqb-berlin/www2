"""Offline regression tests using fake Docker/curl and disposable release trees."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'www2'
        self.app.mkdir()
        shutil.copytree(REPO / 'scripts', self.app / 'scripts')
        shutil.copy(REPO / 'Makefile', self.app / 'Makefile')
        # Only synthetic settings; no actual environment files are read.
        settings = 'TAG=0.1.0\nREGISTRY_PATH=\nTRAEFIK_DIR=\nSERVER_NAME=test.invalid\nPC_UPDATE_TOKEN=test-TAG-secret\nUPLOAD_TOKENS=test:another-test-secret\n'
        (self.app / '.env.www2').write_text(settings)
        (self.app / '.env.dev').write_text(settings)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'docker.jsonl'
        docker = self.bin / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['DOCKER_LOG'],'a') as f:f.write(json.dumps(args)+'\\n')
if args[:2]==['network','ls']:print('existing-network')
if 'build' in args and os.environ.get('FAIL_BUILD')=='1':sys.exit(9)
''')
        docker.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.bin)+os.pathsep+os.environ['PATH'], 'DOCKER_LOG': str(self.log)}

    def shell(self, body, fail=False):
        env = {**self.env, 'FAIL_BUILD': '1' if fail else '0'}
        return subprocess.run(['bash', '-c', body], cwd=self.app, env=env, input='y\n', text=True, capture_output=True)

    def calls(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []

    def assert_sequence(self, calls, failed=False):
        calls = [x for x in calls if x[0] == 'compose']
        operations = [next(x[i:] for i in range(len(x)) if x[i] in ('pull','build','up','down')) for x in calls]
        expected = [['pull','--ignore-buildable'], ['build','it-api']]
        if not failed: expected.append(['up','-d','--no-build','--pull','never'])
        self.assertEqual(operations, expected)
        for call in calls:
            self.assertTrue(any(x.endswith('docker-compose.www2.prod.yaml') for x in call))

    def test_production_make_without_git_checkout(self):
        for release_layout in (False, True):
            with self.subTest(release_layout=release_layout):
                if release_layout:
                    shutil.copy(self.app/'scripts/make/prod.mk', self.app/'scripts/make/www2.mk')
                    (self.app/'Makefile').write_text(f'include {self.app}/scripts/make/www2.mk\n')
                if self.log.exists(): self.log.unlink()
                result = self.shell('make www2-up')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('not a git repository', result.stderr)
                self.assert_sequence(self.calls())
                for call in self.calls():
                    if call[0]=='compose': self.assertEqual(call[call.index('--env-file')+1], str(self.app/'.env.www2'))

    def test_make_build_failure_does_not_recreate(self):
        result = self.shell('make www2-up', fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assert_sequence(self.calls(), failed=True)

    def test_installer_and_both_updater_start_paths(self):
        for script, function in [('install.sh','application_start'),('update.sh','application_reload'),('update.sh','application_restart')]:
            for failed in (False, True):
                with self.subTest(script=script, function=function, failed=failed):
                    if self.log.exists():self.log.unlink()
                    result = self.shell(f'source scripts/{script}; APP_DIR="$PWD"; {function}', fail=failed)
                    self.assertEqual(result.returncode==0, not failed, result.stderr)
                    self.assert_sequence(self.calls(), failed)

    def test_update_and_install_preserve_settings_and_downloads(self):
        (self.app/'downloads').mkdir()
        (self.app/'downloads/payload').write_bytes(b'original payload')
        for script in ('install.sh','update.sh'):
            with self.subTest(script=script):
                # A real release stores the make fragment under www2.mk.
                shutil.copy(self.app/'scripts/make/prod.mk', self.app/'scripts/make/www2.mk')
                result = self.shell(f'source scripts/{script}; APP_DIR="$PWD"; TARGET_VERSION=0.2.0-rc.1; customize_settings')
                self.assertEqual(result.returncode, 0, result.stderr)
                data=(self.app/'.env.www2').read_text()
                self.assertIn('PC_UPDATE_TOKEN=test-TAG-secret\n', data)
                self.assertIn('SERVER_NAME=test.invalid\n', data)
                self.assertIn('TAG=0.2.0-rc.1\n', data)
                self.assertEqual((self.app/'downloads/payload').read_bytes(),b'original payload')

    def test_directory_download_accepts_github_archive_prefix(self):
        archive=self.root/'release.tar.gz'
        with tarfile.open(archive,'w:gz') as tar:
            for name in ('api','api/src','api/src/server.mjs'):
                item=tarfile.TarInfo('www2-0.2.0-rc.1/'+name)
                if name.endswith('.mjs'):
                    item.size=4;tar.addfile(item,io.BytesIO(b'test'))
                else:
                    item.type=tarfile.DIRTYPE;item.mode=0o755;tar.addfile(item)
        curl=self.bin/'curl';curl.write_text('#!/bin/sh\ncat "'+str(archive)+'"\n');curl.chmod(0o755)
        for script in ('install.sh','update.sh'):
            with self.subTest(script=script):
                target=self.app/'api'
                if target.exists():shutil.rmtree(target)
                target.mkdir()
                result=self.shell(f'source scripts/{script}; TARGET_VERSION=v0.2.0-rc.1; download_dir api api')
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertEqual((target/'src/server.mjs').read_bytes(),b'test')

    def test_review_required_does_not_stop_containers(self):
        result=self.shell('source scripts/update.sh; HAS_ENV_FILE_UPDATE=true; finalize_update')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.calls(),[])


if __name__=='__main__':unittest.main()
