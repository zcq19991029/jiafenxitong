"""离线检查 Git 索引中的路径与文本；不输出命中的个人信息。"""
from pathlib import Path, PurePosixPath
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
GIT = os.environ.get('GIT_EXE') or shutil.which('git')
if not GIT:
    bundled = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'
    GIT = str(bundled) if bundled.exists() else None

def git(*args):
    if not GIT:
        raise RuntimeError('找不到 Git；请设置 GIT_EXE')
    return subprocess.check_output([GIT, *args], cwd=ROOT)

def forbidden(name):
    p = PurePosixPath(name)
    return (name == 'data.js' or p.parts[0] in ('教学材料', '效果预览', '_shots', '迁移记录', '项目归档')
            or 'node_modules' in p.parts
            or (p.name.startswith('_shot') and p.suffix == '.html'))

def main():
    raw = (ROOT / 'data.js').read_text(encoding='utf-8-sig')
    seed = json.loads(raw.split('window.SEED_DATA', 1)[1].split('=', 1)[1].strip().rstrip(';'))
    people = [m for c in seed['classes'] for m in c.get('roster', [])]
    people += [m for c in seed['classes'] for g in c.get('groups', []) for m in g.get('members', [])]
    tokens = {str(m.get(k, '')).strip() for m in people for k in ('name', 'sid')}
    tokens.discard('')
    # Full identifiers are checked regardless of length (the current source uses 11 digits).
    matcher = re.compile('|'.join(re.escape(t) for t in sorted(tokens, key=len, reverse=True))) if tokens else None
    paths = git('ls-files', '-z').decode('utf-8').split('\0')
    hits = 0
    for name in filter(None, paths):
        if forbidden(name):
            print(f'{name}: 路径禁止提交')
            hits += 1
            continue
        blob = git('show', ':' + name)
        if b'\0' in blob:
            continue
        try:
            text = blob.decode('utf-8-sig')
        except UnicodeDecodeError:
            if PurePosixPath(name).suffix.lower() not in ('.png', '.jpg', '.jpeg', '.ico', '.pdf', '.xlsx'):
                print(f'{name}: 无法解码，需人工确认')
                hits += 1
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if matcher and matcher.search(line):
                print(f'{name}:{number}: 命中个人信息黑名单')
                hits += 1
    print('OK: 0 命中' if not hits else f'FAIL: {hits} 命中')
    return bool(hits)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, IndexError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f'FAIL: 检查未完成 ({type(exc).__name__})')
        sys.exit(1)
