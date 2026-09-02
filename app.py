"""Local Flask web application for the student information system."""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_from_directory

from student_service import (
    DATA_FILE,
    STUDENT_FIELDS,
    StudentServiceError,
    get_student_stats,
    student_delete,
    student_export_csv,
    student_import_csv,
    student_insert,
    student_load,
    student_show,
    student_update,
)


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
SERVER_PORT = int(os.environ.get("PORT", "8000"))

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")
app.config["JSON_AS_ASCII"] = False


def _error_response(error: StudentServiceError) -> tuple[Any, int]:
    """Return one predictable error shape for the browser and API clients."""

    payload = {
        "ok": False,
        "error": error.to_dict(),
        "code": error.code,
        "message": error.message,
    }
    return jsonify(payload), error.status_code


def _json_object() -> dict[str, Any]:
    """Read an object payload, accepting an optional ``student`` wrapper."""

    payload = request.get_json(silent=True)
    if isinstance(payload, dict) and isinstance(payload.get("student"), dict):
        payload = payload["student"]
    if not isinstance(payload, dict):
        raise StudentServiceError(
            "validation_error",
            "请求体必须是 JSON 对象",
            {"expected_fields": list(STUDENT_FIELDS)},
            400,
        )
    return payload


def _filtered_students() -> list[dict[str, Any]]:
    records = student_load(DATA_FILE)
    query = request.args.get("q", "").strip().casefold()
    gender = request.args.get("gender", "").strip()
    class_name = request.args.get("class_name", "").strip()
    if query:
        records = [
            record
            for record in records
            if query in str(record["student_id"]).casefold()
            or query in str(record["name"]).casefold()
        ]
    if gender:
        records = [record for record in records if str(record["gender"]) == gender]
    if class_name:
        records = [
            record for record in records if str(record["class_name"]) == class_name
        ]
    return records


def _class_names(records: list[dict[str, Any]]) -> list[str]:
    return sorted({str(record["class_name"]) for record in records if record.get("class_name")})


@app.get("/")
def index() -> Any:
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "service": "student-management", "mode": "api"})


@app.get("/api/students")
def list_students() -> Any:
    try:
        records = _filtered_students()
        try:
            page = max(1, int(request.args.get("page", "1")))
            page_size = min(100, max(1, int(request.args.get("page_size", "10"))))
        except ValueError as exc:
            raise StudentServiceError(
                "validation_error", "page 和 page_size 必须是整数", None, 400
            ) from exc
        total = len(records)
        pages = math.ceil(total / page_size) if total else 0
        start = (page - 1) * page_size
        items = records[start : start + page_size]
        return jsonify(
            {
                "ok": True,
                "data": items,
                "students": items,
                "items": items,
                "classes": _class_names(records),
                "class_names": _class_names(records),
                "total": total,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "pages": pages,
                },
            }
        )
    except StudentServiceError as error:
        return _error_response(error)


@app.get("/api/students/<student_id>")
def get_student(student_id: str) -> Any:
    try:
        record = student_show(file_path=DATA_FILE, student_id=student_id)
        if record is None:
            raise StudentServiceError(
                "not_found", f"找不到学号为 {student_id} 的学生", {"student_id": student_id}, 404
            )
        return jsonify({"ok": True, "data": record, "student": record, **record})
    except StudentServiceError as error:
        return _error_response(error)


@app.post("/api/students")
def create_student() -> Any:
    try:
        record = student_insert(_json_object(), file_path=DATA_FILE)
        return jsonify({"ok": True, "data": record, "student": record, **record}), 201
    except StudentServiceError as error:
        return _error_response(error)


@app.put("/api/students/<student_id>")
def edit_student(student_id: str) -> Any:
    try:
        record = student_update(student_id, _json_object(), file_path=DATA_FILE)
        return jsonify({"ok": True, "data": record, "student": record, **record})
    except StudentServiceError as error:
        return _error_response(error)


@app.delete("/api/students/<student_id>")
def remove_student(student_id: str) -> Any:
    try:
        record = student_delete(student_id, file_path=DATA_FILE)
        return jsonify({"ok": True, "data": record, "student": record, **record})
    except StudentServiceError as error:
        return _error_response(error)


@app.get("/api/stats")
def stats() -> Any:
    try:
        records = student_load(DATA_FILE)
        result = get_student_stats(records)
        classes = _class_names(records)
        result = {**result, "classList": classes, "class_names": classes}
        return jsonify({"ok": True, "data": result, **result})
    except StudentServiceError as error:
        return _error_response(error)


@app.post("/api/students/import")
def import_students() -> Any:
    uploaded = request.files.get("file") or request.files.get("csv")
    if uploaded is None:
        return _error_response(
            StudentServiceError("invalid_csv", "请选择要导入的 CSV 文件", None, 400)
        )
    try:
        records = student_import_csv(uploaded.stream, file_path=DATA_FILE)
        return jsonify(
            {
                "ok": True,
                "data": records,
                "students": records,
                "count": len(records),
            }
        )
    except StudentServiceError as error:
        return _error_response(error)


@app.get("/api/students/export")
def export_students() -> Response | tuple[Any, int]:
    try:
        content = student_export_csv(file_path=DATA_FILE)
        response = Response(content.encode("utf-8"), content_type="text/csv; charset=utf-8")
        response.headers["Content-Disposition"] = "attachment; filename=students.csv"
        return response
    except StudentServiceError as error:
        return _error_response(error)


@app.errorhandler(404)
def handle_not_found(error: Any) -> Any:
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "code": "not_found", "message": "接口不存在"}), 404
    return error


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=SERVER_PORT, debug=False)
