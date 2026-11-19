#!/usr/bin/env python3
"""Run every normal backend unit suite on a Git archive; publish counts, never Jest logs."""
import collections
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GUARD = 'test/support/mission-25c-network-guard.cjs'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def run(source, run_id):
    if not re.fullmatch(r'[a-f0-9]{40}', source) or not re.fullmatch(r'[a-z][a-z0-9]{3,15}', run_id):
        raise ValueError('Expected a full commit hash and unused lowercase run ID')
    subprocess.run(['git', 'merge-base', '--is-ancestor', source, 'HEAD'], cwd=ROOT, check=True)
    dest = ROOT / 'docs/integration/evidence/p2p-parity' / (run_id + '.json')
    report = dict(id=run_id, source=source, guard=GUARD, heapMiB=2048, state='SETTING_UP',
                  started=now(), batches=[])

    def save():
        tmp = dest.with_suffix(f'.{os.getpid()}.tmp')
        tmp.write_text(json.dumps(report, indent=2) + '\n')
        tmp.replace(dest)

    with dest.open('x') as f:
        json.dump(report, f)
    work = Path(tempfile.mkdtemp(prefix='arena-parity-unit-'))
    try:
        archive = work / 'source.tar'
        subprocess.run(['git', 'archive', '-o', archive, source], cwd=ROOT, check=True)
        subprocess.run(['tar', '-xf', archive], cwd=work, check=True)
        archive.unlink()
        for cmd in (['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund'],
                    ['node', 'scripts/prepare-pg-test-env.js', '--create-if-missing']):
            subprocess.run(cmd, cwd=work, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        env = {k: os.environ[k] for k in ('HOME', 'PATH')}
        guard = str(work / GUARD)
        env.update(NODE_OPTIONS='--require=' + guard, NODE_ENV='test', TZ='UTC', DB_HOST='127.0.0.1')
        jest = ['node', '--max-old-space-size=2048', '-r', guard, 'node_modules/jest/bin/jest.js',
                '--config', 'jest.config.js', '--runInBand']
        paths = json.loads(subprocess.check_output(jest + ['--listTests', '--json'], cwd=work, env=env))
        files = sorted(str(Path(p).relative_to(work)) for p in paths)
        if not files or len(set(files)) != len(files) or not all(re.fullmatch(r'(?:src|test)/[\w./-]+\.spec\.ts', p) for p in files):
            raise ValueError('Unexpected discovery')
        report.update(state='RUNNING', discovered=len(files))
        save()
        for n in range(0, len(files), 40):
            group = files[n:n+40]
            result = work / 'result.json'
            result.unlink(missing_ok=True)
            batch = dict(start=now(), suites={p: 'NO_RESULT' for p in group})
            report['batches'].append(batch)
            save()
            with (work / f'{n}.log').open('xb') as log:
                p = subprocess.run(jest + ['--silent', '--json', '--outputFile', result,
                                           '--runTestsByPath', *group], cwd=work, env=env,
                                   stdout=log, stderr=subprocess.STDOUT)
            batch.update(exit=p.returncode, finished=now(), ok=False)
            if result.is_file():
                j = json.loads(result.read_text())
                found = [str(Path(s['name']).relative_to(work)) for s in j['testResults']]
                if sorted(found) != group:
                    raise ValueError('Jest result inventory mismatch')
                passed = failed = skipped = 0
                for file, s in zip(found, j['testResults']):
                    c = collections.Counter(a['status'] for a in s['assertionResults'])
                    other = sum(c.values()) - c['passed'] - c['failed']
                    batch['suites'][file] = dict(status=s['status'], passed=c['passed'], failed=c['failed'], other=other)
                    passed += c['passed']
                    failed += c['failed']
                    skipped += other
                batch.update(passed=passed, failed=failed, skipped=skipped,
                             ok=p.returncode == 0 and bool(j['success']) and j['numPassedTestSuites'] == len(group)
                             and passed == j['numTotalTests'] and failed == skipped == 0
                             and all(s['status'] == 'passed' and s['passed'] > 0 for s in batch['suites'].values()))
            save()
            print(f"{run_id} batch {len(report['batches'])}: ok={batch['ok']} passed={batch.get('passed')}", flush=True)
        report['state'] = 'PASS' if all(b['ok'] for b in report['batches']) else 'FAIL'
        return 0 if report['state'] == 'PASS' else 1
    except Exception:
        report['state'] = 'ERROR'
        raise
    finally:
        report['finished'] = now()
        save()
        if report['state'] == 'PASS':
            shutil.rmtree(work)
        else:
            print(f'Private diagnostics: {work}', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: p2p-acceptance-unit.py <exact commit> <unused run ID>')
    os.umask(0o077)
    sys.exit(run(*sys.argv[1:]))
