"""Student information service used by the local Flask application.

The course assignment asks for a small function-oriented application.  This
module keeps the data and file handling in one place so that the HTTP layer and
the command-line entry point can share exactly the same validation rules.

Records are persisted as a JSON list in :data:`DATA_FILE`.  All writes go
through a temporary file followed by ``os.replace``; a failed write therefore
does not leave a partially written JSON file behind.  The public functions
raise :class:`StudentServiceError` for expected, user-facing errors instead of
leaking ``KeyError``, ``JSONDecodeError`` or regular-expression errors to the
caller.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import tempfile
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Callable, TextIO, TypeAlias


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "students.json"

# ``STUDENTS_FILE`` and ``DEFAULT_DATA_FILE`` are convenient aliases for code
# that wants to inspect or override the default location during a test.
STUDENTS_FILE = DATA_FILE
DEFAULT_DATA_FILE = DATA_FILE

STUDENT_FIELDS = (
    "student_id",
    "name",
    "gender",
    "age",
    "class_name",
    "phone",
)
CSV_FIELDS = STUDENT_FIELDS

_CSV_HEADER_ALIASES = {
    "学号": "student_id",
    "姓名": "name",
    "性别": "gender",
    "年龄": "age",
    "班级": "class_name",
    "联系电话": "phone",
    "电话": "phone",
}
StudentValue: TypeAlias = str | int
StudentRecord: TypeAlias = dict[str, StudentValue]

_FIELD_SET = frozenset(STUDENT_FIELDS)
_PHONE_PATTERN = re.compile(r"^[0-9 -]+$")
_AGE_PATTERN = re.compile(r"^[0-9]+$")
_MISSING = object()


class StudentServiceError(Exception):
    """An expected service-layer error with a JSON-friendly representation.

    ``code`` is stable enough for a frontend to branch on; ``message`` is
    already suitable for displaying to a user.  ``details`` may contain a
    field name, CSV row number, or a list of validation errors.
    """

    DEFAULT_STATUS_CODES = {
        "validation_error": 400,
        "duplicate_student_id": 409,
        "not_found": 404,
        "invalid_json": 500,
        "invalid_csv": 400,
        "storage_error": 500,
    }

    def __init__(
        self,
        code: str,
        message: str,
        details: Any = None,
        status_code: int | None = None,
    ) -> None:
        self.code = str(code)
        self.message = str(message)
        self.details = details
        self.status_code = (
            int(status_code)
            if status_code is not None
            else self.DEFAULT_STATUS_CODES.get(self.code, 400)
        )
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        """Return the error shape used by Flask and tests."""

        result: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.details is not None:
            result["details"] = self.details
        return result

    def __str__(self) -> str:
        if self.details is None:
            return self.message
        return f"{self.message} ({self.details})"


def _data_path(file_path: str | os.PathLike[str] | None = None) -> Path:
    """Resolve an optional data path while retaining a patchable default."""

    if file_path is not None:
        return Path(file_path).expanduser()
    # Use DATA_FILE instead of a value captured at import time so tests and
    # small deployments can override it with ``student_service.DATA_FILE``.
    return Path(DATA_FILE).expanduser()


def _storage_error(message: str, details: Any = None) -> StudentServiceError:
    return StudentServiceError("storage_error", message, details, 500)


def _validation_error(
    message: str,
    *,
    field: str | None = None,
    row: int | None = None,
    details: Any = None,
) -> StudentServiceError:
    payload: dict[str, Any] = {}
    if field is not None:
        payload["field"] = field
    if row is not None:
        payload["row"] = row
    if details is not None:
        if isinstance(details, Mapping):
            payload.update(details)
        else:
            payload["reason"] = details
    return StudentServiceError("validation_error", message, payload or None, 400)


def _text_value(value: Any, field: str, *, row: int | None = None) -> str:
    """Convert a scalar form/CSV value to trimmed text.

    Numeric IDs are accepted because browsers often serialize an ID input as
    a number.  Containers and booleans are rejected instead of becoming
    surprising strings such as ``"{'id': 1}"`` or ``"True"``.
    """

    if value is None or isinstance(value, (bool, Mapping, list, tuple, set)):
        raise _validation_error(
            f"{field}不能为空",
            field=field,
            row=row,
            details="a scalar value is required",
        )
    text = str(value).strip()
    if not text:
        raise _validation_error(f"{field}不能为空", field=field, row=row)
    return text


def _age_value(value: Any, *, row: int | None = None) -> int:
    if isinstance(value, bool):
        raise _validation_error("年龄必须是整数", field="age", row=row)
    if isinstance(value, int):
        age = value
    elif isinstance(value, str):
        text = value.strip()
        if not _AGE_PATTERN.fullmatch(text):
            raise _validation_error("年龄必须是整数", field="age", row=row)
        age = int(text)
    else:
        # Deliberately reject floats such as 18.0.  The API contract says an
        # integer and silently truncating a float would hide bad input.
        raise _validation_error("年龄必须是整数", field="age", row=row)
    if not 1 <= age <= 120:
        raise _validation_error(
            "年龄必须是 1 到 120 之间的整数",
            field="age",
            row=row,
        )
    return age


def _phone_value(value: Any, *, row: int | None = None) -> str:
    # 联系电话是可选字段；when supplied it is restricted to the simple
    # characters accepted by the CSV and browser forms.
    if value is None or (isinstance(value, str) and not value.strip()):
        return ""
    phone = _text_value(value, "phone", row=row)
    if not _PHONE_PATTERN.fullmatch(phone) or not any(ch.isdigit() for ch in phone):
        raise _validation_error(
            "联系电话只能包含数字、空格和连字符",
            field="phone",
            row=row,
        )
    return phone


def _normalize_student(
    student: Mapping[str, Any],
    *,
    row: int | None = None,
    partial: bool = False,
) -> StudentRecord:
    """Validate and normalize one record or one update payload."""

    if not isinstance(student, Mapping):
        raise _validation_error(
            "学生记录必须是对象",
            row=row,
            details="mapping expected",
        )

    unknown = sorted(set(student) - _FIELD_SET, key=str)
    if unknown:
        raise _validation_error(
            "学生记录包含未知字段",
            row=row,
            details={"unknown_fields": unknown},
        )

    if not partial:
        missing = [field for field in STUDENT_FIELDS if field not in student]
        if missing:
            raise _validation_error(
                "学生记录缺少必填字段",
                row=row,
                details={"missing_fields": missing},
            )

    result: StudentRecord = {}
    for field in STUDENT_FIELDS:
        if field not in student:
            continue
        value = student[field]
        if field == "age":
            result[field] = _age_value(value, row=row)
        elif field == "phone":
            result[field] = _phone_value(value, row=row)
        else:
            result[field] = _text_value(value, field, row=row)

    return result


def validate_student(
    student: Mapping[str, Any], *, row: int | None = None
) -> StudentRecord:
    """Validate one complete student record and return its normalized copy."""

    return _normalize_student(student, row=row)


def _ensure_unique(records: Iterable[Mapping[str, Any]]) -> list[StudentRecord]:
    normalized: list[StudentRecord] = []
    seen: dict[str, int] = {}
    for index, record in enumerate(records, start=1):
        normalized_record = _normalize_student(record, row=index)
        student_id = str(normalized_record["student_id"])
        if student_id in seen:
            raise StudentServiceError(
                "duplicate_student_id",
                f"学号 {student_id} 重复",
                {"student_id": student_id, "first_row": seen[student_id], "row": index},
                409,
            )
        seen[student_id] = index
        normalized.append(normalized_record)
    return normalized


def _atomic_write_json(records: list[StudentRecord], path: Path) -> None:
    """Write JSON atomically in the destination directory."""

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temp_file:
                temp_name = temp_file.name
                json.dump(
                    records,
                    temp_file,
                    ensure_ascii=False,
                    indent=2,
                    separators=(",", ": "),
                )
                temp_file.write("\n")
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_name, path)
            temp_name = None
        finally:
            if temp_name is not None:
                try:
                    os.unlink(temp_name)
                except FileNotFoundError:
                    pass
    except OSError as exc:
        raise _storage_error("无法保存学生数据", {"path": str(path), "reason": str(exc)}) from exc


def student_load(
    file_path: str | os.PathLike[str] | None = None,
) -> list[StudentRecord]:
    """Load all students from JSON, creating an empty file on first run.

    A malformed or structurally invalid existing file raises
    ``StudentServiceError(code='invalid_json')``.  It is intentionally not
    replaced automatically, so a user can recover the original data.
    """

    path = _data_path(file_path)
    if not path.exists():
        _atomic_write_json([], path)
        return []

    try:
        with path.open("r", encoding="utf-8-sig") as data_file:
            raw = json.load(data_file)
    except json.JSONDecodeError as exc:
        raise StudentServiceError(
            "invalid_json",
            "学生数据文件不是有效的 JSON",
            {"path": str(path), "line": exc.lineno, "column": exc.colno},
            500,
        ) from exc
    except OSError as exc:
        raise _storage_error("无法读取学生数据", {"path": str(path), "reason": str(exc)}) from exc

    if not isinstance(raw, list):
        raise StudentServiceError(
            "invalid_json",
            "学生数据文件必须包含 JSON 数组",
            {"path": str(path)},
            500,
        )
    try:
        return _ensure_unique(raw)
    except StudentServiceError:
        raise
    except (TypeError, ValueError) as exc:
        raise StudentServiceError(
            "invalid_json",
            "学生数据文件中的记录格式无效",
            {"path": str(path), "reason": str(exc)},
            500,
        ) from exc


def student_save(
    students: Iterable[Mapping[str, Any]],
    file_path: str | os.PathLike[str] | None = None,
) -> list[StudentRecord]:
    """Validate and atomically save all records, returning normalized copies."""

    if students is None or isinstance(students, (str, bytes, Mapping)):
        raise _validation_error("students 必须是学生记录数组")
    try:
        normalized = _ensure_unique(students)
    except StudentServiceError:
        raise
    except (TypeError, ValueError) as exc:
        raise _validation_error("students 必须是学生记录数组", details=str(exc)) from exc
    _atomic_write_json(normalized, _data_path(file_path))
    return [record.copy() for record in normalized]


def _records_for_operation(
    students: Iterable[Mapping[str, Any]] | None,
    file_path: str | os.PathLike[str] | None,
) -> tuple[list[StudentRecord], bool]:
    """Return normalized records and whether the file should be persisted."""

    if students is None:
        return student_load(file_path), True
    try:
        records = _ensure_unique(students)
    except StudentServiceError:
        raise
    except (TypeError, ValueError) as exc:
        raise _validation_error("students 必须是学生记录数组", details=str(exc)) from exc
    return records, file_path is not None


def _finish_operation(
    records: list[StudentRecord],
    students: Iterable[Mapping[str, Any]] | None,
    file_path: str | os.PathLike[str] | None,
    should_persist: bool,
) -> list[StudentRecord]:
    if should_persist:
        saved = student_save(records, file_path)
    else:
        saved = [record.copy() for record in records]
    if isinstance(students, list):
        students[:] = [record.copy() for record in saved]
    return saved


def student_show(
    students: Iterable[Mapping[str, Any]] | str | None = None,
    student_id: str | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
) -> list[StudentRecord] | StudentRecord | None:
    """List students or return one by ID.

    ``student_show("2024001")`` is accepted as shorthand for a single-ID
    lookup, while ``student_show(records, "2024001")`` works for callers that
    already have an in-memory list.  A missing ID returns ``None`` so an HTTP
    layer can choose its own 404 response shape.
    """

    if isinstance(students, str) and student_id is None:
        student_id = students
        students = None
    records, _ = _records_for_operation(students, file_path)  # type: ignore[arg-type]
    if student_id is None:
        return [record.copy() for record in records]
    lookup_id = _text_value(student_id, "student_id")
    for record in records:
        if record["student_id"] == lookup_id:
            return record.copy()
    return None


def student_insert(
    student: Mapping[str, Any] | None = None,
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
    **fields: Any,
) -> StudentRecord:
    """Insert one student and return the normalized inserted record.

    If ``students`` is omitted, the default JSON file is loaded and saved.
    If an in-memory list is supplied, it is updated in place; persistence is
    performed only when ``file_path`` is explicitly provided.
    """

    # Supporting ``student_insert(records, payload)`` costs little and keeps
    # this function friendly to the common teaching-example calling style.
    if not isinstance(student, Mapping) and isinstance(students, Mapping):
        student, students = students, student  # type: ignore[assignment]
    payload: dict[str, Any]
    if student is None:
        payload = {}
    elif isinstance(student, Mapping):
        payload = dict(student)
    else:
        raise _validation_error("student 必须是对象")
    payload.update(fields)
    if not payload:
        raise _validation_error("请提供学生信息")
    new_record = _normalize_student(payload)
    records, should_persist = _records_for_operation(students, file_path)
    if any(record["student_id"] == new_record["student_id"] for record in records):
        raise StudentServiceError(
            "duplicate_student_id",
            f"学号 {new_record['student_id']} 已存在",
            {"student_id": new_record["student_id"]},
            409,
        )
    records.append(new_record)
    _finish_operation(records, students, file_path, should_persist)
    return new_record.copy()


def student_delete(
    student_id: str,
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
) -> StudentRecord:
    """Delete one student by ID and return the removed record."""

    lookup_id = _text_value(student_id, "student_id")
    records, should_persist = _records_for_operation(students, file_path)
    for index, record in enumerate(records):
        if record["student_id"] == lookup_id:
            removed = records.pop(index)
            _finish_operation(records, students, file_path, should_persist)
            return removed.copy()
    raise StudentServiceError(
        "not_found",
        f"找不到学号为 {lookup_id} 的学生",
        {"student_id": lookup_id},
        404,
    )


def student_update(
    student_id: str,
    updates: Mapping[str, Any] | None = None,
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
    **fields: Any,
) -> StudentRecord:
    """Update a student by ID and return the normalized complete record.

    Updates are partial, but ``student_id`` remains immutable.  Supplying the
    same ID is harmless; supplying a different ID is rejected explicitly.
    """

    lookup_id = _text_value(student_id, "student_id")
    if updates is not None and not isinstance(updates, Mapping):
        raise _validation_error("updates 必须是对象")
    payload: dict[str, Any] = dict(updates or {})
    payload.update(fields)
    if "student_id" in payload:
        requested_id = _text_value(payload["student_id"], "student_id")
        if requested_id != lookup_id:
            raise _validation_error(
                "学号不能在修改时更换",
                field="student_id",
                details={"expected": lookup_id, "received": requested_id},
            )
        payload.pop("student_id")
    if not payload:
        raise _validation_error("请提供至少一个需要修改的字段")

    records, should_persist = _records_for_operation(students, file_path)
    for index, record in enumerate(records):
        if record["student_id"] == lookup_id:
            merged: dict[str, Any] = record.copy()
            merged.update(payload)
            updated = _normalize_student(merged)
            records[index] = updated
            _finish_operation(records, students, file_path, should_persist)
            return updated.copy()
    raise StudentServiceError(
        "not_found",
        f"找不到学号为 {lookup_id} 的学生",
        {"student_id": lookup_id},
        404,
    )


def _read_csv_source(source: Any) -> tuple[str, str | None]:
    """Read a CSV source and return text plus an optional display path."""

    # A string containing line breaks is CSV content, not a path.  This also
    # makes the natural ``student_import_csv(csv_text, ...)`` call work.  For
    # a one-line string, an existing path still wins; a non-existing string is
    # treated as content so callers can pass a header-only CSV and receive a
    # useful CSV validation error rather than an OS path-length error.
    if isinstance(source, str) and ("\n" in source or "\r" in source):
        return source.removeprefix("\ufeff"), None

    if isinstance(source, (str, os.PathLike)):
        source_path = Path(source).expanduser()
        if isinstance(source, str) and not source_path.exists() and "," in source:
            return source.removeprefix("\ufeff"), None
        try:
            data = source_path.read_bytes()
        except OSError as exc:
            raise StudentServiceError(
                "invalid_csv",
                "无法读取 CSV 文件",
                {"path": str(source_path), "reason": str(exc)},
                400,
            ) from exc
        try:
            return data.decode("utf-8-sig"), str(source_path)
        except UnicodeDecodeError as exc:
            raise StudentServiceError(
                "invalid_csv",
                "CSV 文件必须使用 UTF-8 编码",
                {"path": str(source_path)},
                400,
            ) from exc

    if isinstance(source, bytes):
        try:
            return source.decode("utf-8-sig"), None
        except UnicodeDecodeError as exc:
            raise StudentServiceError(
                "invalid_csv",
                "CSV 数据必须使用 UTF-8 编码",
                None,
                400,
            ) from exc

    if hasattr(source, "read"):
        try:
            value = source.read()
        except OSError as exc:
            raise StudentServiceError("invalid_csv", "无法读取 CSV 数据", str(exc), 400) from exc
        if isinstance(value, bytes):
            try:
                return value.decode("utf-8-sig"), None
            except UnicodeDecodeError as exc:
                raise StudentServiceError("invalid_csv", "CSV 数据必须使用 UTF-8 编码", None, 400) from exc
        if isinstance(value, str):
            return value.removeprefix("\ufeff"), None
        raise StudentServiceError("invalid_csv", "CSV 数据必须是文本或字节", None, 400)

    raise StudentServiceError(
        "invalid_csv",
        "CSV 来源必须是路径、文本、字节或可读文件对象",
        None,
        400,
    )


def _parse_csv(text: str) -> list[StudentRecord]:
    if not text.strip():
        raise StudentServiceError("invalid_csv", "CSV 文件不能为空", None, 400)
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None:
        raise StudentServiceError("invalid_csv", "CSV 缺少表头", None, 400)
    headers = [header.strip() if header is not None else "" for header in reader.fieldnames]
    canonical_headers = [_CSV_HEADER_ALIASES.get(header, header) for header in headers]
    missing = [field for field in CSV_FIELDS if field not in canonical_headers]
    extra = [field for field in canonical_headers if field not in _FIELD_SET]
    if missing or extra or len(canonical_headers) != len(set(canonical_headers)):
        details: dict[str, Any] = {}
        if missing:
            details["missing_fields"] = missing
        if extra:
            details["unknown_fields"] = extra
        if len(canonical_headers) != len(set(canonical_headers)):
            details["duplicate_headers"] = headers
        raise StudentServiceError("invalid_csv", "CSV 表头必须与学生字段一致", details, 400)

    parsed: list[StudentRecord] = []
    for row_number, row in enumerate(reader, start=2):
        # DictReader uses None as a key for extra cells and None as a value for
        # missing cells.  Both are rejected with a useful row number.
        if None in row:
            raise StudentServiceError(
                "invalid_csv",
                f"CSV 第 {row_number} 行列数不正确",
                {"row": row_number},
                400,
            )
        if any(value is None for value in row.values()):
            raise StudentServiceError(
                "invalid_csv",
                f"CSV 第 {row_number} 行列数不正确",
                {"row": row_number},
                400,
            )
        # Re-map in the canonical field order.  This permits harmless column
        # reordering while keeping the stored schema stable.
        candidate = {
            field: row.get(headers[index], "")
            for index, field in enumerate(canonical_headers)
            if field in _FIELD_SET
        }
        try:
            parsed.append(_normalize_student(candidate, row=row_number))
        except StudentServiceError as exc:
            if exc.details is None:
                details = {"row": row_number}
            elif isinstance(exc.details, Mapping):
                details = dict(exc.details)
                details.setdefault("row", row_number)
            else:
                details = {"row": row_number, "reason": exc.details}
            raise StudentServiceError(exc.code, exc.message, details, exc.status_code) from exc
    if not parsed:
        raise StudentServiceError("invalid_csv", "CSV 文件没有学生记录", None, 400)
    try:
        return _ensure_unique(parsed)
    except StudentServiceError as exc:
        raise StudentServiceError(exc.code, exc.message, exc.details, exc.status_code) from exc


def student_import_csv(
    source: Any,
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
    replace: bool = False,
) -> list[StudentRecord]:
    """Import CSV records atomically and return the complete saved dataset.

    By default imported rows are appended to existing students.  Set
    ``replace=True`` to replace the dataset.  Parsing and validation happen
    before the single ``student_save`` call, so an invalid row leaves the
    original JSON file and in-memory list untouched.
    """

    text, _ = _read_csv_source(source)
    imported = _parse_csv(text)
    if students is None:
        existing = student_load(file_path)
        target_list: Iterable[Mapping[str, Any]] | None = None
    else:
        existing, _ = _records_for_operation(students, None)
        target_list = students
    candidate = imported if replace else existing + imported
    saved = student_save(candidate, file_path)
    if isinstance(target_list, list):
        target_list[:] = [record.copy() for record in saved]
    return [record.copy() for record in saved]


def student_export_csv(
    students: Iterable[Mapping[str, Any]] | None = None,
    destination: str | os.PathLike[str] | TextIO | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
) -> str:
    """Return a UTF-8-with-BOM CSV and optionally write it to ``destination``.

    The returned string begins with ``\ufeff`` so it can be encoded directly
    with UTF-8 and opened correctly by common spreadsheet software.  A path
    destination is written atomically; a text file object is written in place.
    """

    records = student_load(file_path) if students is None else _ensure_unique(students)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=list(CSV_FIELDS), lineterminator="\n")
    writer.writeheader()
    writer.writerows(records)
    content = "\ufeff" + output.getvalue()

    if destination is None:
        return content
    if isinstance(destination, (str, os.PathLike)):
        path = Path(destination).expanduser()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_name: str | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8-sig",
                    newline="",
                    dir=path.parent,
                    prefix=f".{path.name}.",
                    suffix=".tmp",
                    delete=False,
                ) as temp_file:
                    temp_name = temp_file.name
                    temp_file.write(output.getvalue())
                    temp_file.flush()
                    os.fsync(temp_file.fileno())
                os.replace(temp_name, path)
                temp_name = None
            finally:
                if temp_name is not None:
                    try:
                        os.unlink(temp_name)
                    except FileNotFoundError:
                        pass
        except OSError as exc:
            raise _storage_error("无法导出 CSV 文件", {"path": str(path), "reason": str(exc)}) from exc
    elif hasattr(destination, "write"):
        try:
            # A text stream receives the BOM explicitly.  Binary streams are
            # also supported for Flask/tests that pass BytesIO.
            try:
                destination.write(content)
            except TypeError:
                destination.write(content.encode("utf-8"))
        except (OSError, TypeError) as exc:
            raise _storage_error("无法写入 CSV 数据", str(exc)) from exc
    else:
        raise _validation_error("destination 必须是路径或可写文件对象")
    return content


def get_student_stats(
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Compute dashboard counters from the same normalized records."""

    records = student_load(file_path) if students is None else _ensure_unique(students)
    male_values = {"男", "male", "m"}
    female_values = {"女", "female", "f"}
    male_count = sum(str(record["gender"]).strip().lower() in male_values for record in records)
    female_count = sum(str(record["gender"]).strip().lower() in female_values for record in records)
    return {
        "total": len(records),
        "male": male_count,
        "female": female_count,
        "classes": len({record["class_name"] for record in records}),
    }


def _interactive_record(input_fn: Callable[[str], str]) -> dict[str, str]:
    return {
        "student_id": input_fn("学号："),
        "name": input_fn("姓名："),
        "gender": input_fn("性别："),
        "age": input_fn("年龄："),
        "class_name": input_fn("班级："),
        "phone": input_fn("联系电话："),
    }


def student_infoprocess(
    action: str | None = None,
    payload: Any = None,
    students: Iterable[Mapping[str, Any]] | None = None,
    *,
    file_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Dispatch one high-level operation and return a structured result.

    The function is useful to a Flask route that wants one stable dispatch
    point, and to :func:`student_main`.  Expected errors still raise
    :class:`StudentServiceError`; successful results have ``ok/action/data``.
    """

    if action is None:
        return {"ok": True, "action": "list", "data": student_show(students, file_path=file_path)}
    normalized_action = str(action).strip().lower()
    aliases = {
        "list": "show",
        "query": "show",
        "get": "show",
        "add": "insert",
        "create": "insert",
        "remove": "delete",
        "edit": "update",
        "import": "import_csv",
        "export": "export_csv",
        "stats": "statistics",
    }
    normalized_action = aliases.get(normalized_action, normalized_action)

    if normalized_action == "show":
        if isinstance(payload, Mapping):
            query_id = payload.get("student_id")
        else:
            query_id = payload
        data = student_show(students, query_id, file_path=file_path)
    elif normalized_action == "insert":
        data = student_insert(payload, students, file_path=file_path)
    elif normalized_action == "delete":
        data = student_delete(str(payload), students, file_path=file_path)
    elif normalized_action == "update":
        if not isinstance(payload, Mapping):
            raise _validation_error("update 操作需要包含 student_id 的对象")
        if "student_id" not in payload:
            raise _validation_error("update 操作缺少 student_id", field="student_id")
        update_payload = dict(payload)
        query_id = update_payload.pop("student_id")
        data = student_update(query_id, update_payload, students, file_path=file_path)
    elif normalized_action == "import_csv":
        if isinstance(payload, Mapping):
            source = payload.get("source")
            replace = bool(payload.get("replace", False))
        else:
            source = payload
            replace = False
        if source is None:
            raise _validation_error("import_csv 操作缺少 CSV 来源")
        data = student_import_csv(source, students, file_path=file_path, replace=replace)
    elif normalized_action == "export_csv":
        destination = payload if isinstance(payload, (str, os.PathLike)) else None
        data = student_export_csv(students, destination, file_path=file_path)
    elif normalized_action == "statistics":
        data = get_student_stats(students, file_path=file_path)
    else:
        raise _validation_error(
            "不支持的操作",
            details={"action": normalized_action},
        )
    return {"ok": True, "action": normalized_action, "data": data}


def student_main(
    *,
    file_path: str | os.PathLike[str] | None = None,
    input_fn: Callable[[str], str] = input,
    output_fn: Callable[[str], Any] = print,
) -> list[StudentRecord]:
    """Run the assignment's simple command-line menu until the user exits."""

    records = student_load(file_path)
    menu = (
        "\n学生信息管理系统\n"
        "1. 显示学生\n"
        "2. 添加学生\n"
        "3. 删除学生\n"
        "4. 修改学生\n"
        "5. 重新加载\n"
        "6. 保存\n"
        "0. 退出"
    )
    while True:
        output_fn(menu)
        choice = input_fn("请选择：").strip()
        try:
            if choice == "0":
                # Every mutating operation already saves, but save once more
                # on exit to make the persistence guarantee obvious.
                records = student_save(records, file_path)
                output_fn("已保存，程序结束。")
                return records
            if choice == "1":
                shown = student_show(records)
                output_fn(json.dumps(shown, ensure_ascii=False, indent=2))
            elif choice == "2":
                inserted = student_insert(_interactive_record(input_fn), records, file_path=file_path)
                output_fn(f"已添加：{inserted['name']}")
            elif choice == "3":
                removed = student_delete(input_fn("要删除的学号："), records, file_path=file_path)
                output_fn(f"已删除：{removed['name']}")
            elif choice == "4":
                lookup_id = input_fn("要修改的学号：")
                updates = {
                    "name": input_fn("姓名（留空保留原值）："),
                    "gender": input_fn("性别（留空保留原值）："),
                    "age": input_fn("年龄（留空保留原值）："),
                    "class_name": input_fn("班级（留空保留原值）："),
                    "phone": input_fn("联系电话（留空保留原值）："),
                }
                updates = {key: value for key, value in updates.items() if value.strip()}
                updated = student_update(lookup_id, updates, records, file_path=file_path)
                output_fn(f"已修改：{updated['name']}")
            elif choice == "5":
                records = student_load(file_path)
                output_fn(f"已加载 {len(records)} 条记录。")
            elif choice == "6":
                records = student_save(records, file_path)
                output_fn(f"已保存 {len(records)} 条记录。")
            else:
                output_fn("无效选项，请重试。")
        except StudentServiceError as exc:
            output_fn(f"操作失败：{exc.message}")


__all__ = [
    "BASE_DIR",
    "DATA_DIR",
    "DATA_FILE",
    "STUDENTS_FILE",
    "DEFAULT_DATA_FILE",
    "STUDENT_FIELDS",
    "CSV_FIELDS",
    "StudentRecord",
    "StudentServiceError",
    "validate_student",
    "student_load",
    "student_save",
    "student_show",
    "student_insert",
    "student_delete",
    "student_update",
    "student_import_csv",
    "student_export_csv",
    "get_student_stats",
    "student_infoprocess",
    "student_main",
]
