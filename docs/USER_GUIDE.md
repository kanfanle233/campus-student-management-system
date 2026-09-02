# 使用与演示指南 · User Guide

## 中文

### 运行本地版

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

访问 <http://127.0.0.1:8000/>。左侧菜单包含仪表盘、学生档案、导入与导出和使用说明。

### 演示学生档案

1. 进入“学生档案”，使用姓名或学号搜索。
2. 使用性别、班级下拉框组合筛选。
3. 点击“添加学生”填写必填字段，保存后返回列表。
4. 点击表格中的查看、编辑或删除按钮完成单条记录操作。
5. 删除操作会先显示确认框，确认后才会写入 JSON 文件。

### 导入和导出 CSV

进入“导入与导出”：

- 导入文件首行使用 `student_id,name,gender,age,class_name,phone`。
- 可以直接参考根目录的 `演示导入学生信息.csv`。
- 后端会先校验全部行；出现错误时会提示行号，并保留原数据。
- 导出文件使用 UTF-8 BOM，适合用 Excel 打开。

### GitHub Pages 静态版

静态版运行方式：

```bash
python3 -m http.server 4173 --directory docs
```

访问 <http://127.0.0.1:4173/>。静态版内置 8 条高中阶段示例数据，修改只写入当前浏览器的 `localStorage`；它不连接本地 Flask 服务。可以在“数据中心”点击重置，恢复初始样例。

### 命令行版

```bash
python3 -c "from student_service import student_main; student_main()"
```

命令行菜单支持显示、添加、删除、修改、重新加载、保存和退出。它和 Flask 版共用 `student_service.py` 的校验规则。

## English

### Local application

Create a virtual environment, install the single Flask dependency, and run:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

Open <http://127.0.0.1:8000/>. Use the sidebar to switch between the dashboard, student records, CSV tools, and the guide.

### Student records

Open “学生档案” to search by name or ID, combine gender and class filters, inspect details, create records, edit them, or delete them after confirmation. Required fields and duplicate IDs are checked before saving.

### CSV transfer

Open “导入与导出” and use the six-column schema:

```text
student_id,name,gender,age,class_name,phone
```

The import path validates the complete file before writing. Export uses UTF-8 with BOM and downloads `students.csv`, which can be imported again.

### Static demo

```bash
python3 -m http.server 4173 --directory docs
```

Open <http://127.0.0.1:4173/>. The static build contains eight seeded records and persists edits only in the current browser's `localStorage`; it does not call Flask.

### CLI

```bash
python3 -c "from student_service import student_main; student_main()"
```

The CLI shares validation and persistence code with the web application.
