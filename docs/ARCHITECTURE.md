# 系统架构说明 · Architecture

## 中文

### 1. 组件关系

项目把页面、HTTP 路由、业务函数和文件存储分开，两个前端适配器共享同一组页面操作：

| 层 | 目录/文件 | 责任 |
| --- | --- | --- |
| 界面层 | `web/` | 本地 Flask 版页面、交互和表单提示 |
| 静态演示层 | `docs/` | GitHub Pages 页面，使用浏览器 `localStorage` 保存样例数据 |
| 适配器层 | `web/app.js` | `ApiAdapter` 访问 HTTP；`LocalAdapter` 访问浏览器存储 |
| HTTP 层 | `app.py` | 路由、参数读取、状态码和统一 JSON 错误响应 |
| 业务层 | `student_service.py` | 字段校验、CRUD、CSV、统计、原子 JSON 写入、命令行菜单 |
| 存储层 | `data/students.json` | 默认数据文件；本地版启动时自动创建 |
| 质量工具 | `tests/`、`scripts/` | pytest 测试、Python 编译检查、Pages 静态资源检查 |

完整关系见 [架构图](architecture.svg)。

### 2. 本地 API 模式

1. 浏览器加载 `web/index.html`、`web/styles.css` 和 `web/app.js`。
2. `ApiAdapter` 发送 `/api/...` 请求。
3. `app.py` 读取 JSON、表单或上传文件，并调用 `student_service.py`。
4. 业务函数先标准化和校验记录，再读写 `data/students.json`。
5. 后端返回稳定的 JSON 结构；页面更新列表、统计卡片或提示消息。

业务层不依赖 Flask，因此命令行入口和 HTTP 路由可以复用同一套规则。

### 3. GitHub Pages 静态模式

`docs/` 是独立的静态发布目录：

- 资源路径全部使用相对路径。
- `docs/assets/app.js` 不调用 `fetch`、XHR 或远程 API。
- 初次打开时写入内置演示数据，后续修改写入当前站点的 `localStorage`。
- 浏览器清理站点数据，或点击“重置演示数据”，会恢复样例记录。

`scripts/build_pages.py --check` 会检查缺少文件、绝对资源、远程 URL 和服务器请求，避免把本地 Flask 版本误发布到 Pages 目录。

### 4. 数据与错误处理

学生记录包含六个字段：

```json
{
  "student_id": "2026001",
  "name": "张三",
  "gender": "男",
  "age": 18,
  "class_name": "计算机科学1班",
  "phone": "138-0000-0001"
}
```

写入 JSON 时使用临时文件、刷新磁盘并调用 `os.replace`。程序在写入失败时不会留下半份 JSON 文件。CSV 导入会在写入前完成整批解析、字段校验和学号去重；任何一行失败都不会覆盖原文件。

预期业务错误统一由 `StudentServiceError` 表达，并携带 `code`、`message`、`details` 和 HTTP 状态码。前端可以根据 `message` 和字段详情显示提示，而不需要处理底层的 `KeyError`、`JSONDecodeError` 或正则表达式异常。

### 5. 选择 JSON 文件的原因

课程项目数据量小，JSON 便于直接查看、提交和演示；原子写入覆盖了本项目最需要的写入安全。并发用户、权限、复杂查询和大数据量不在当前项目范围内，正式部署时应换用数据库并增加身份认证。

## English

### Components

The project separates the UI, HTTP routes, business functions, and persistence layer. Both frontends expose the same user-facing operations through replaceable adapters:

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `web/` | Flask-connected page, interactions, and form feedback |
| Static demo | `docs/` | GitHub Pages bundle backed by browser `localStorage` |
| Adapter | `web/app.js` | `ApiAdapter` for HTTP and `LocalAdapter` for local storage |
| HTTP | `app.py` | Routes, input parsing, status codes, and JSON errors |
| Domain/service | `student_service.py` | Validation, CRUD, CSV, statistics, atomic JSON writes, and CLI |
| Storage | `data/students.json` | Default local data file |
| Quality checks | `tests/`, `scripts/` | pytest, compile checks, and static-bundle validation |

### Local API flow

The browser sends `/api/...` requests to `app.py`. The Flask layer delegates all record validation and persistence to `student_service.py`, which reads or atomically replaces `data/students.json`. CLI callers use the same service functions, so validation rules do not diverge between the two entry points.

### GitHub Pages flow

The `docs/` bundle is self-contained. It uses relative assets, seeded demo records, and `localStorage`; it does not call the Flask API. The build checker rejects server requests, remote URLs, and absolute HTML asset paths before publishing.

### Persistence and scope

Records contain `student_id`, `name`, `gender`, `age`, `class_name`, and `phone`. JSON writes go through a temporary file and `os.replace`. CSV import validates the complete batch before one save operation, so a bad row leaves the previous dataset unchanged. JSON is appropriate for this small classroom project; authentication, concurrent writes, migrations, and production-scale querying are intentionally out of scope.
