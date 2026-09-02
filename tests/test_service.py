from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import pytest

from student_service import (
    CSV_FIELDS,
    StudentServiceError,
    get_student_stats,
    student_delete,
    student_export_csv,
    student_import_csv,
    student_insert,
    student_load,
    student_save,
    student_show,
    student_update,
)


def record(student_id: str = "2024001", **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "student_id": student_id,
        "name": "张三",
        "gender": "男",
        "age": 18,
        "class_name": "计算机2401",
        "phone": "138 0000-0001",
    }
    value.update(overrides)
    return value


def data_path(tmp_path: Path) -> Path:
    return tmp_path / "nested" / "students.json"


def test_missing_file_is_initialized(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    assert student_load(path) == []
    assert json.loads(path.read_text(encoding="utf-8")) == []


def test_bad_json_is_structured_error_and_not_overwritten(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    path.parent.mkdir(parents=True)
    original = "{bad json"
    path.write_text(original, encoding="utf-8")

    with pytest.raises(StudentServiceError) as caught:
        student_load(path)

    assert caught.value.code == "invalid_json"
    assert caught.value.status_code == 500
    assert "code" in caught.value.to_dict()
    assert path.read_text(encoding="utf-8") == original


def test_save_normalizes_and_loads_records(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    source = [record(age="019", phone=" 139-123  ")]
    saved = student_save(source, path)
    assert saved[0]["age"] == 19
    assert saved[0]["phone"] == "139-123"
    assert student_load(path) == saved


def test_crud_with_file_is_persistent(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    inserted = student_insert(record(), file_path=path)
    assert inserted["student_id"] == "2024001"
    changed = student_update(
        "2024001",
        {"name": "李四", "age": "20"},
        file_path=path,
    )
    assert changed["name"] == "李四"
    assert changed["age"] == 20
    removed = student_delete("2024001", file_path=path)
    assert removed["name"] == "李四"
    assert student_load(path) == []


def test_crud_updates_passed_list_in_place(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    records = [record()]
    student_insert(record("2024002", name="王五"), records, file_path=path)
    assert [item["student_id"] for item in records] == ["2024001", "2024002"]
    assert student_show(records, "2024002")["name"] == "王五"
    student_update("2024002", {"phone": "139-9999"}, records, file_path=path)
    assert records[1]["phone"] == "139-9999"
    student_delete("2024001", records, file_path=path)
    assert [item["student_id"] for item in records] == ["2024002"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("student_id", ""),
        ("name", "  "),
        ("gender", None),
        ("class_name", ""),
        ("age", 0),
        ("age", 151),
        ("age", "18.0"),
        ("phone", "138(0000)"),
    ],
)
def test_validation_rejects_invalid_values(
    tmp_path: Path, field: str, value: object
) -> None:
    payload = record()
    payload[field] = value
    with pytest.raises(StudentServiceError) as caught:
        student_insert(payload, file_path=data_path(tmp_path))
    assert caught.value.code == "validation_error"
    assert caught.value.status_code == 400
    assert caught.value.details is not None


def test_duplicate_id_is_rejected_without_writing(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    student_save([record()], path)
    before = path.read_text(encoding="utf-8")
    with pytest.raises(StudentServiceError) as caught:
        student_insert(record(name="重复"), file_path=path)
    assert caught.value.code == "duplicate_student_id"
    assert path.read_text(encoding="utf-8") == before


def test_missing_update_and_delete_are_not_found(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    student_save([record()], path)
    with pytest.raises(StudentServiceError) as update_error:
        student_update("404", {"name": "不存在"}, file_path=path)
    with pytest.raises(StudentServiceError) as delete_error:
        student_delete("404", file_path=path)
    assert update_error.value.code == "not_found"
    assert delete_error.value.code == "not_found"


def test_csv_import_is_all_or_nothing(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    student_save([record()], path)
    before = path.read_text(encoding="utf-8")
    csv_text = "\ufeff" + ",".join(CSV_FIELDS) + "\n"
    csv_text += "2024002,李四,女,19,计算机2401,139-1234\n"
    csv_text += "2024003,王五,男,not-an-age,计算机2402,139-5678\n"

    with pytest.raises(StudentServiceError) as caught:
        student_import_csv(csv_text, file_path=path)

    assert caught.value.code == "validation_error"
    assert caught.value.details["row"] == 3
    assert path.read_text(encoding="utf-8") == before
    assert [item["student_id"] for item in student_load(path)] == ["2024001"]


def test_csv_duplicate_with_existing_is_all_or_nothing(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    student_save([record()], path)
    csv_text = ",".join(CSV_FIELDS) + "\n2024001,新名字,男,18,计算机2401,139-1234\n"
    with pytest.raises(StudentServiceError) as caught:
        student_import_csv(csv_text, file_path=path)
    assert caught.value.code == "duplicate_student_id"
    assert student_load(path)[0]["name"] == "张三"


def test_csv_import_and_export_round_trip(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    csv_text = ",".join(reversed(CSV_FIELDS)) + "\n"
    # Deliberately use a different column order to verify header mapping.
    row = {
        "student_id": "2024001",
        "name": "张三",
        "gender": "男",
        "age": "18",
        "class_name": "计算机2401",
        "phone": "138-0000",
    }
    csv_text += ",".join(row[field] for field in reversed(CSV_FIELDS)) + "\n"
    imported = student_import_csv(io.StringIO(csv_text), file_path=path)
    assert imported[0]["age"] == 18

    destination = tmp_path / "export" / "students.csv"
    exported = student_export_csv(file_path=path, destination=destination)
    assert exported.startswith("\ufeffstudent_id,")
    assert destination.read_bytes().startswith(b"\xef\xbb\xbf")
    assert student_import_csv(destination, file_path=tmp_path / "roundtrip.json") == imported


def test_csv_import_accepts_chinese_headers(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    csv_text = "学号,姓名,性别,年龄,班级,联系电话\n2024001,张三,男,18,计算机2401,\n"
    imported = student_import_csv(csv_text, file_path=path)
    assert imported[0]["name"] == "张三"


def test_export_to_binary_stream_and_stats(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    student_save(
        [
            record("1", gender="男", class_name="A"),
            record("2", gender="女", class_name="A"),
            record("3", gender="其他", class_name="B"),
        ],
        path,
    )
    stream = io.BytesIO()
    exported = student_export_csv(file_path=path, destination=stream)
    assert stream.getvalue().decode("utf-8-sig") == exported.removeprefix("\ufeff")
    assert get_student_stats(file_path=path) == {
        "total": 3,
        "male": 1,
        "female": 1,
        "classes": 2,
    }


def test_phone_is_optional(tmp_path: Path) -> None:
    path = data_path(tmp_path)
    inserted = student_insert(record(phone=""), file_path=path)
    assert inserted["phone"] == ""
