"""只打包允许公开的网页资产，绝不复制本机 data.js 或教学材料。"""
from pathlib import Path
import argparse
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent

def build(destination):
    out = Path(destination).resolve()
    out.mkdir(parents=True, exist_ok=True)
    allow = ['index.html', 'styles.css', 'app.js', 'cloud.js', '.nojekyll']
    for name in allow:
        shutil.copy2(ROOT / name, out / name)
    shutil.copytree(ROOT / 'assets', out / 'assets', dirs_exist_ok=True)
    # New teachers start with empty class templates. Real records come from login or JSON restore.
    text = (ROOT / 'data.example.js').read_text(encoding='utf-8')
    seed = json.loads(text.split('window.SEED_DATA =', 1)[1].strip().rstrip(';'))
    seed['source'] = '线上空白班级模板；真实记录由教师登录或导入备份恢复'
    for cls in seed['classes']:
        cls['teacher'] = ''
        cls['roster'] = []
        for group in cls['groups']:
            group['members'] = []
    (out / 'data.js').write_text('window.SEED_DATA = ' + json.dumps(seed, ensure_ascii=False) + ';\n', encoding='utf-8')
    try:
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        sha = 'local-check'
    html = (out / 'index.html').read_text(encoding='utf-8')
    for name in ('styles.css', 'data.js', 'cloud.js', 'app.js'):
        html = html.replace('"' + name + '"', '"' + name + '?v=' + sha + '"')
    html = html.replace('</head>', '<meta name="build-commit" content="' + sha + '">\n</head>')
    (out / 'index.html').write_text(html, encoding='utf-8', newline='\n')
    (out / 'version.json').write_text(json.dumps({'commit': sha, 'name': '夜夜加分助手'}, ensure_ascii=False), encoding='utf-8')
    print('Pages package:', out)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'pages-dist'))
    build(parser.parse_args().out)
