# CampusFlow · 校园学生信息管理系统

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.1%2B-000000?logo=flask&logoColor=white)
![License](https://img.shields.io/badge/license-not--specified-lightgrey)

一个面向程序设计课程大作业的学生信息管理系统。项目同时提供 Flask 本地接口版和无需服务器的 GitHub Pages 静态演示版，覆盖学生档案的增删改查、搜索筛选、统计、CSV 导入导出和命令行菜单。

> 在线演示 / Live demo：[CampusFlow GitHub Pages](https://kanfanle233.github.io/campus-student-management-system/)

> **Project nickname / 项目昵称：蹦迪项目**  
> The repository name uses the functional product name `campus-student-management-system`, while the course project can still be referred to as “蹦迪项目”.

[中文](#中文) · [English](#english) · [项目截图](#项目截图--screenshots) · [快速开始](#快速开始--quick-start)

---

## 中文

### 项目简介

CampusFlow 将课程要求的函数式数据处理与一个可操作的管理界面连接起来：

- Flask 提供本地 HTTP 接口，默认监听 `127.0.0.1:8000`。
- `student_service.py` 集中处理校验、JSON 持久化、CRUD、CSV 和统计逻辑。
- `web/` 是连接 Flask API 的响应式管理界面。
- `docs/` 是可以发布到 GitHub Pages 的浏览器静态演示，数据保存在当前浏览器的 `localStorage` 中，不依赖 Python 服务。
- `main.py` 保留课程作业常见的 Python 启动入口；`student_main()` 提供命令行菜单。

### 功能清单

| 模块 | 已实现功能 |
| --- | --- |
| 仪表盘 | 学生总数、男女生人数、班级数量、最近添加记录 |
| 学生档案 | 列表、姓名/学号搜索、性别/班级筛选、分页、详情、添加、修改、删除 |
| 数据工具 | UTF-8 CSV 导入、UTF-8 BOM CSV 导出、整批校验、错误行提示 |
| 数据层 | JSON 文件持久化、原子写入、重复学号检查、字段和年龄/电话校验 |
| 静态演示 | GitHub Pages 友好的相对资源路径、浏览器 `localStorage`、内置演示数据 |
| 命令行 | 显示、添加、删除、修改、重新加载、保存和退出 |

### 项目截图 · Screenshots

截图来自 `docs/` 静态演示版，使用内置样例数据，便于在 GitHub 页面直接展示界面。

![CampusFlow dashboard / 仪表盘](/docs/assets/screenshots/dashboard.png)

![CampusFlow student records / 学生档案](/docs/assets/screenshots/students.png)

![CampusFlow data center / 数据中心](/docs/assets/screenshots/data-center.png)

### 流程图 · Workflow

![System workflow / 系统业务流程图](/docs/assets/flowchart.svg)

### 架构图 · Architecture

![System architecture / 系统架构图](/docs/assets/architecture.svg)

详细说明见：

- [系统架构说明 / Architecture](docs/ARCHITECTURE.md)
- [接口说明 / API Reference](docs/API.md)
- [使用与演示指南 / User Guide](docs/USER_GUIDE.md)

### 快速开始 · Quick Start

#### 1. 安装依赖

建议使用 Python 3.10 或更高版本：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

#### 2. 启动本地 Flask 版

```bash
python main.py
```

打开 <http://127.0.0.1:8000/>。首次启动会自动创建或读取 `data/students.json`。如需更换端口：

```bash
PORT=8001 python main.py
```

#### 3. 运行静态演示版

静态版不请求 Flask API，直接使用 `docs/` 中的 HTML/CSS/JavaScript：

```bash
python3 -m http.server 4173 --directory docs
```

打开 <http://127.0.0.1:4173/>。发布到 GitHub Pages 时，在仓库设置中选择默认分支的 `/docs` 目录；页面已经使用相对资源路径，可以适配仓库子路径。

### 测试与检查

```bash
python -m pytest -q
python -m compileall -q app.py main.py student_service.py tests
python scripts/build_pages.py --check
```

重新构建静态发布目录：

```bash
python scripts/build_pages.py
```

### 数据规则

后端和前端都遵守以下规则：

- `student_id`、`name`、`gender`、`age`、`class_name` 为必填字段。
- 学号不能重复；修改时不能更换学号。
- 年龄必须是 `1—120` 的整数。
- 性别为 `男`、`女` 或 `其他`。
- 联系电话可以留空；填写时只能使用数字、空格和连字符。
- CSV 表头顺序为 `student_id,name,gender,age,class_name,phone`，同时兼容中文表头别名。
- CSV 导入先读取并校验全部记录；任何错误都会拒绝整批导入，原 JSON 数据保持不变。

### HTTP 接口概览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/students` | 搜索、筛选、分页查询 |
| `GET` | `/api/students/<student_id>` | 查询单条记录 |
| `POST` | `/api/students` | 添加学生 |
| `PUT` | `/api/students/<student_id>` | 修改学生 |
| `DELETE` | `/api/students/<student_id>` | 删除学生 |
| `GET` | `/api/stats` | 获取仪表盘统计 |
| `POST` | `/api/students/import` | 导入 CSV |
| `GET` | `/api/students/export` | 导出 CSV |

完整请求、响应和错误字段见 [docs/API.md](docs/API.md)。

### 目录结构

```text
.
├── app.py                       # Flask 路由和 HTTP 错误响应
├── main.py                      # 本地启动入口
├── student_service.py           # 校验、CRUD、JSON、CSV、统计和命令行函数
├── data/students.json           # 默认学生数据文件
├── web/                         # 本地 Flask 版前端
├── docs/                        # GitHub Pages 静态发布目录
│   ├── assets/                  # 静态版 CSS、JavaScript、图表和截图
│   ├── index.html
│   ├── API.md
│   ├── ARCHITECTURE.md
│   └── USER_GUIDE.md
├── scripts/build_pages.py       # 静态目录检查和构建脚本
├── tests/                       # pytest 测试
├── 演示导入学生信息.csv          # CSV 导入示例
└── requirements.txt
```

### 参考与致谢

界面信息层级参考了 [Yogndrr/MERN-School-Management-System](https://github.com/Yogndrr/MERN-School-Management-System) 的校园管理类产品形态；本项目的页面代码、图标、数据和业务逻辑均为独立实现。

---

## English

### Overview

CampusFlow is a student information management system built for a Python programming course project. It combines a Flask API application with a browser-only static demo that can be published through GitHub Pages.

- Flask serves the local HTTP API at `127.0.0.1:8000` by default.
- `student_service.py` owns validation, CRUD operations, JSON persistence, CSV transfer, statistics, and the command-line functions required by the assignment.
- `web/` contains the API-connected responsive frontend.
- `docs/` contains a self-contained GitHub Pages bundle backed by browser `localStorage`.
- `main.py` is the local entry point, and `student_main()` provides the course-style CLI menu.

### Features

| Area | Included |
| --- | --- |
| Dashboard | Total students, gender counts, class count, and recent records |
| Student records | Search, gender/class filters, pagination, details, create, update, and delete |
| Data tools | UTF-8 CSV import/export, full-file validation, and row-level error details |
| Data layer | JSON persistence, atomic writes, duplicate-ID checks, and field validation |
| Static demo | Relative asset paths, `localStorage`, and seeded sample data |
| CLI | List, create, delete, update, reload, save, and exit |

### Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

Open <http://127.0.0.1:8000/>. Use `PORT=8001 python main.py` to select another port.

### Run the static demo

```bash
python3 -m http.server 4173 --directory docs
```

Open <http://127.0.0.1:4173/>. The static demo does not call the Flask API; it stores changes in the current browser's `localStorage`.

### Validation rules

- `student_id`, `name`, `gender`, `age`, and `class_name` are required.
- Student IDs must be unique and cannot be changed during an update.
- Age must be an integer from `1` to `120`.
- Gender must be `男`, `女`, or `其他` in the current UI.
- Phone numbers are optional and accept digits, spaces, and hyphens.
- CSV uses `student_id,name,gender,age,class_name,phone` in that order and accepts the documented Chinese aliases.
- CSV import validates the complete batch before writing; invalid input leaves the original JSON data untouched.

### Tests

```bash
python -m pytest -q
python -m compileall -q app.py main.py student_service.py tests
python scripts/build_pages.py --check
```

### Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [User Guide](docs/USER_GUIDE.md)
- [Workflow diagram](docs/flowchart.svg)
- [Architecture diagram](docs/architecture.svg)

### Repository

The planned public repository is [`kanfanle233/campus-student-management-system`](https://github.com/kanfanle233/campus-student-management-system).

## Project status

The repository is ready for course demonstration and local deployment. Authentication, multi-user permissions, production database migrations, and automated deployment are outside the current assignment scope.

---

## License

No license has been selected for this course project yet. All rights remain with the project author unless a license file is added later.
