# API Reference · 接口说明

The local Flask application exposes JSON endpoints under `/api`. The static GitHub Pages demo does not provide these endpoints; it uses `localStorage` in the browser.

本接口文档描述本地 Flask 版本。GitHub Pages 静态演示版不提供这些 HTTP 接口，它把数据保存在浏览器 `localStorage` 中。

## Common record

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

`student_id`、`name`、`gender`、`age`、`class_name` 必填。`phone` 可为空。

## Endpoints

### `GET /api/health`

Returns a simple service check:

```json
{"ok": true, "service": "student-management", "mode": "api"}
```

### `GET /api/students`

Query parameters:

| Parameter | Default | Description |
| --- | ---: | --- |
| `q` | empty | Match `student_id` or `name` |
| `gender` | empty | Exact match: `男`, `女`, or `其他` |
| `class_name` | empty | Exact class match |
| `page` | `1` | 1-based page number |
| `page_size` | `10` | Page size from `1` to `100` |

Example: `GET /api/students?q=张&page=1&page_size=10`

Response fields include `data`, `students`, `items`, `classes`, `class_names`, `total`, and `pagination`:

```json
{
  "ok": true,
  "data": [{"student_id": "2026001", "name": "张三", "gender": "男", "age": 18, "class_name": "计算机科学1班", "phone": ""}],
  "total": 1,
  "pagination": {"page": 1, "page_size": 10, "total": 1, "pages": 1}
}
```

### `GET /api/students/<student_id>`

Returns one record. A missing ID returns `404` with `code: "not_found"`.

### `POST /api/students`

Request body: one complete JSON record. A duplicate ID returns `409` with `code: "duplicate_student_id"`.

```bash
curl -X POST http://127.0.0.1:8000/api/students \
  -H 'Content-Type: application/json' \
  -d '{"student_id":"2026001","name":"张三","gender":"男","age":18,"class_name":"计算机科学1班","phone":""}'
```

Success status: `201`.

### `PUT /api/students/<student_id>`

Request body: one or more fields to update. The URL ID is immutable; sending a different `student_id` is rejected.

```json
{"name": "张三（已更新）", "age": 19}
```

Success status: `200`.

### `DELETE /api/students/<student_id>`

Deletes and returns the removed record. A missing ID returns `404`.

### `GET /api/stats`

Returns dashboard counters:

```json
{
  "ok": true,
  "data": {"total": 2, "male": 1, "female": 1, "classes": 1}
}
```

### `POST /api/students/import`

Use multipart form data with field name `file` or `csv`:

```bash
curl -X POST http://127.0.0.1:8000/api/students/import \
  -F 'file=@演示导入学生信息.csv'
```

The file must contain the following columns in this order:

```text
student_id,name,gender,age,class_name,phone
```

Chinese aliases such as `学号,姓名,性别,年龄,班级,联系电话` are accepted. The whole file is parsed and validated before the data file is replaced. Any error returns `400` and leaves existing records unchanged.

### `GET /api/students/export`

Returns all records as a UTF-8 CSV with BOM and the download filename `students.csv`.

## Validation errors

Expected errors follow this shape:

```json
{
  "ok": false,
  "error": {
    "code": "validation_error",
    "message": "年龄必须是 1 到 120 之间的整数",
    "details": {"field": "age"}
  },
  "code": "validation_error",
  "message": "年龄必须是 1 到 120 之间的整数"
}
```

Common codes:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| `validation_error` | `400` | Missing or invalid input |
| `invalid_csv` | `400` | CSV cannot be parsed or has no records |
| `duplicate_student_id` | `409` | ID already exists or is repeated in a batch |
| `not_found` | `404` | Student ID does not exist |
| `invalid_json` | `500` | Stored JSON is malformed |
| `storage_error` | `500` | File read/write failed |
