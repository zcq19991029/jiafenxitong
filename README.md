# 夜夜加分助手

《电气接线原理》课堂分组、记分、个人扣分、排行、名单分配与 A4 打印工具，当前版本为夜夜加分助手 v5.2。

## 线上入口

GitHub Pages：https://zcq19991029.github.io/ye-ye-score-helper/

源码：https://github.com/zcq19991029/ye-ye-score-helper

使用时打开线上网址即可，不需要安装本地程序。Pages 仅发布网页资产和空白班级模板，不发布真实学生名单。原账号记录需要登录后从云端读取；新网址的浏览器存储与原网址相互独立，也可从原应用下载完整 JSON 后在新页面恢复。

原 WorkBuddy 云端当前拒绝 GitHub Pages 来源（预检返回 403）。真实浏览器点微信登录后，WorkBuddy 显示“当前地址暂不支持此登录方式”。需要平台支持来源 `https://zcq19991029.github.io` 和 OAuth 回调 `https://zcq19991029.github.io/ye-ye-score-helper/`，若平台不支持外部域名，则需独立云端方案。该项完成前微信登录和云同步验收不通过；Pages 登录页已明确提示，原线上入口保留。

## 发布

推送 main 后 GitHub Actions 自动运行 tools/build_pages.py，仅将允许公开的网页文件和空白模板打包到 pages-dist，再部署 GitHub Pages。不要手动将本机 data.js 或教学材料上传到 Pages。version.json 记录实际构建提交。

开发回归：先在 tools/test-runtime 运行 npm ci，然后在项目根目录运行 `node tools/test_online.mjs`。公开测试只用虚构数据；原本机完整名单回归脚本仍保留在本地。真实微信授权与跨设备云读写需要另外做账号验收。

- 根目录：静态网页源码、初始名单与校徽素材，无构建步骤。
- 教学材料/分组：七份分组表、历史备份和生成脚本。
- 教学材料/组长打分表：七份组长评分表及生成脚本。
- 教学材料/考勤原表：六份名单来源原件。
- tools：生成、测试、截图、打印工具；test-runtime 是仅开发使用的 jsdom 依赖。
- 效果预览：原预览与打印样张；临时截图及辅助页面可由工具重生成。
- 项目交接.md：当前状态。交接文档.md、WorkBuddy原始README.md：接管前原文。

## 本地打开

新克隆下来先 cp data.example.js data.js（仓库里不带真实学生名单）。Windows 也可复制 data.example.js 并将副本改名为 data.js。

双击 index.html 可查看本地界面，真实账号登录依赖原服务已登记的域名。文件夹更名不迁移浏览器存档或云端域名。

本地服务：`rtk proxy <Python路径> -m http.server 18765 --bind 127.0.0.1`。
测试：设置 TEST_URL 为 `http://127.0.0.1:18765/`，运行 `rtk proxy <Node路径> tools/test_app.mjs`。依赖位于 tools/test-runtime，可用其 package-lock.json 恢复。

名单生成：`rtk proxy <Python路径> tools/build_data.py`，需要 openpyxl、xlrd。只读取项目内教学材料；运行前备份 data.js，生成会覆盖初始名单，不影响浏览器已有记分。计分、打印和云接口详见原交接。

长期说明更新 README.md，当前状态更新项目交接.md。

## 本地 Git 与隐私检查

真实 data.js、教学材料、效果预览、迁移记录不进入 Git。原交接、原 README 和 tools/test_app.mjs 含真实姓名，原样保留在本机并排除提交；因此新克隆不包含这份 299 项私有名单回归脚本。源码注释中的姓名、学号示例已脱敏。

先暂存再运行 `rtk proxy <Python路径> tools/check_no_pii.py`，检查实际 Git 索引中的路径及文本。黑名单从本机 data.js 提取完整真实姓名和学号（当前含 11 位学号）。新克隆只有样例名单时，扫描不能宣称覆盖真实名单。

迁移清单、来源证据和本轮测试日志位于迁移记录/；临时 _shots 与两个辅助页面已清理，效果预览保留。
