from __future__ import annotations

import io
from pathlib import Path

import pytest

import app as app_module


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(app_module, "DATA_FILE", tmp_path / "students.json")
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def payload(student_id: str = "2026001", **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "student_id": student_id,
        "name": "张三",
        "gender": "男",
        "age": 18,
        "class_name": "计算机2401",
        "phone": "138-0000-0001",
    }
    value.update(overrides)
    return value


def test_crud_and_pagination(client) -> None:
    response = client.post("/api/students", json=payload())
    assert response.status_code == 201
    assert response.get_json()["data"]["student_id"] == "2026001"

    duplicate = client.post("/api/students", json=payload())
    assert duplicate.status_code == 409
    assert duplicate.get_json()["error"]["code"] == "duplicate_student_id"

    client.post("/api/students", json=payload("2026002", name="李四", gender="女"))
    listed = client.get("/api/students?q=李四&page=1&page_size=1")
    assert listed.status_code == 200
    body = listed.get_json()
    assert body["total"] == 1
    assert body["data"][0]["student_id"] == "2026002"

    changed = client.put("/api/students/2026002", json={"name": "王五", "age": 19})
    assert changed.status_code == 200
    assert changed.get_json()["student"]["name"] == "王五"

    removed = client.delete("/api/students/2026001")
    assert removed.status_code == 200
    assert client.get("/api/students/2026001").status_code == 404


def test_default_server_port_is_not_macos_control_center_port() -> None:
    assert app_module.SERVER_PORT == 8000


def test_stats_import_and_export(client) -> None:
    csv_text = (
        "\ufeffstudent_id,name,gender,age,class_name,phone\n"
        "2026001,张三,男,18,计算机2401,138-0000-0001\n"
        "2026002,李四,女,19,计算机2401,139-0000-0002\n"
    )
    imported = client.post(
        "/api/students/import",
        data={"file": (io.BytesIO(csv_text.encode("utf-8")), "students.csv")},
        content_type="multipart/form-data",
    )
    assert imported.status_code == 200
    assert imported.get_json()["count"] == 2

    stats = client.get("/api/stats")
    stats_data = stats.get_json()["data"]
    assert {key: stats_data[key] for key in ("total", "male", "female", "classes")} == {
        "total": 2,
        "male": 1,
        "female": 1,
        "classes": 1,
    }
    assert stats_data["classList"] == ["计算机2401"]

    exported = client.get("/api/students/export")
    assert exported.status_code == 200
    assert exported.data.startswith(b"\xef\xbb\xbfstudent_id,")
    assert "attachment" in exported.headers["Content-Disposition"]


def test_invalid_import_keeps_existing_data(client) -> None:
    client.post("/api/students", json=payload())
    invalid_csv = (
        "student_id,name,gender,age,class_name,phone\n"
        "2026002,李四,女,not-age,计算机2401,139-0000-0002\n"
    )
    response = client.post(
        "/api/students/import",
        data={"file": (io.BytesIO(invalid_csv.encode("utf-8")), "bad.csv")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.get_json()["error"]["details"]["row"] == 2
    assert client.get("/api/students").get_json()["total"] == 1
