import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import fetch_hasil_patologi_records


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def select(self, *_args, **_kwargs):
        self.calls.append(("select", _args, _kwargs))
        return self

    def order(self, *_args, **_kwargs):
        self.calls.append(("order", _args, _kwargs))
        return self

    def limit(self, value):
        self.calls.append(("limit", value))
        return self

    def execute(self):
        return types.SimpleNamespace(data=list(self.rows))


class FakeSupabaseClient:
    def __init__(self, rows):
        self.rows = rows
        self.table_calls = []

    def table(self, name):
        self.table_calls.append(name)
        return FakeQuery(self.rows)


def test_fetch_hasil_patologi_records_uses_supabase_table(monkeypatch):
    fake_client = FakeSupabaseClient([
        {"id": "1", "nomor_pa": "PA-001", "kesimpulan": "Negatif"},
    ])
    import api

    monkeypatch.setattr(api, "supabase", fake_client)

    records = fetch_hasil_patologi_records(limit=1)

    assert records == [{"id": "1", "nomor_pa": "PA-001", "kesimpulan": "Negatif"}]
    assert fake_client.table_calls == ["hasil_patologi"]


def test_list_my_hasil_patologi_allows_doctor_to_see_all_records(monkeypatch):
    import api

    class FakeQuery:
        def __init__(self, rows):
            self.rows = rows
            self.eq_calls = []

        def select(self, *_args, **_kwargs):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, value):
            return self

        def eq(self, column, value):
            self.eq_calls.append((column, value))
            return self

        def execute(self):
            return types.SimpleNamespace(data=list(self.rows), error=None)

    class FakeSupabaseClient:
        def __init__(self, rows):
            self.rows = rows
            self.query = FakeQuery(rows)

        def table(self, name):
            assert name == "hasil_patologi"
            return self.query

    fake_client = FakeSupabaseClient([
        {"id": "h1", "user_id": "doc-1", "kesimpulan": "Negatif"},
        {"id": "h2", "user_id": "doc-2", "kesimpulan": "Positif"},
    ])

    monkeypatch.setattr(api, "supabase", fake_client)
    monkeypatch.setattr(api, "get_user_from_access_token", lambda token: {"id": "doc-1", "user_metadata": {"role": "dokter"}})

    client = api.app.test_client()
    response = client.get('/api/hasil-patologi/me', headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["count"] == 2
    assert payload["records"][0]["id"] == "h1"
    assert fake_client.query.eq_calls == []


def test_extract_medical_fields_from_text_detects_medical_classification():
    import api

    text = "Pemeriksaan imunohistokimia menunjukkan ER positif, HER2 negatif. Grade 2. Tumor ganas."
    result = api.extract_medical_fields_from_text(text)

    assert result["bukan_tumor"] == 0
    assert result["perilaku_tumor"] == 3
    assert result["grade"] == 2
    assert "ER positif" in result["imuno_histokimia"]


def test_looks_like_ihc_case_preserves_microscopic_description():
    import api

    raw_text = "Pemeriksaan imunohistokimia menunjukkan ER positif, PR positif, HER2 negatif. Mikroskopik terlihat sel tumor pleomorfik dan mitosis meningkat."

    assert api._looks_like_ihc_case(raw_text)
    assert "sel tumor pleomorfik" in api._infer_microscopic_description(raw_text)


def test_process_report_writes_ihc_request_to_pendaftaran_table(monkeypatch):
    import api

    class FakeQuery:
        def __init__(self, client, table_name):
            self.client = client
            self.table_name = table_name
            self._payload = None
            self._update_payload = None
            self._eq = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, column, value):
            self._eq = (column, value)
            return self

        def limit(self, value):
            return self

        def insert(self, payload):
            self._payload = payload
            return self

        def update(self, payload):
            self._update_payload = payload
            return self

        def execute(self):
            if self.table_name == "pendaftaran_pa" and self._eq and self._update_payload is not None:
                self.client.updated_pendaftaran_payloads.append(self._update_payload)
                return types.SimpleNamespace(data=[{"id": self._eq[1], "permintaan_ihc": self._update_payload.get("permintaan_ihc")}], error=None)
            if self.table_name == "pendaftaran_pa" and self._eq:
                return types.SimpleNamespace(data=[{"id": self._eq[1], "nomor_pa": "PA-001"}], error=None)
            if self.table_name == "hasil_patologi" and self._payload is not None:
                self.client.inserted_payloads.append(self._payload)
                return types.SimpleNamespace(data=[{"id": "hasil-1"}], error=None)
            return types.SimpleNamespace(data=[], error=None)

    class FakeSupabaseClient:
        def __init__(self):
            self.inserted_payloads = []
            self.updated_pendaftaran_payloads = []

        def table(self, name):
            return FakeQuery(self, name)

    fake_client = FakeSupabaseClient()
    monkeypatch.setattr(api, "supabase", fake_client)
    monkeypatch.setattr(api, "fetch_pendaftaran_with_pasien", lambda no_kunjungan: {"id": "pendaftaran-1", "nomor_pa": "PA-001"})
    monkeypatch.setattr(api, "call_ai_api", lambda prompt: "{}")
    monkeypatch.setattr(api, "extract_json", lambda text: {})
    monkeypatch.setattr(api, "extract_medical_fields_from_text", lambda text: {"bukan_tumor": 0, "perilaku_tumor": 3, "grade": 2, "imuno_histokimia": "ER positif", "topography": "C50.9", "morphology": "M8140/3"})
    monkeypatch.setattr(api, "_looks_like_ihc_case", lambda text, jenis_pemeriksaan=None: True)
    monkeypatch.setattr(api, "_infer_microscopic_description", lambda text: "sel tumor pleomorfik dengan mitosis meningkat")
    monkeypatch.setattr(api, "generate_nomor_pa", lambda: "PA.26.0001")

    client = api.app.test_client()
    response = client.post(
        "/process-report",
        json={"text": "Pemeriksaan imunohistokimia menunjukkan ER positif.", "user_id": "user-1", "no_kunjungan": "KJ-001"},
    )

    assert response.status_code == 201
    assert fake_client.updated_pendaftaran_payloads == [{"permintaan_ihc": "IHC"}]
    assert "permintaan_ihc" not in fake_client.inserted_payloads[0]


def test_process_report_still_saves_result_when_pendaftaran_update_fails(monkeypatch):
    import api

    class FakeQuery:
        def __init__(self, client, table_name):
            self.client = client
            self.table_name = table_name
            self._payload = None
            self._update_payload = None
            self._eq = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, column, value):
            self._eq = (column, value)
            return self

        def limit(self, value):
            return self

        def insert(self, payload):
            self._payload = payload
            return self

        def update(self, payload):
            self._update_payload = payload
            return self

        def execute(self):
            if self.table_name == "pendaftaran_pa" and self._eq and self._update_payload is not None:
                return types.SimpleNamespace(data=[], error=types.SimpleNamespace(message="column does not exist"))
            if self.table_name == "hasil_patologi" and self._payload is not None:
                self.client.inserted_payloads.append(self._payload)
                return types.SimpleNamespace(data=[{"id": "hasil-1"}], error=None)
            return types.SimpleNamespace(data=[], error=None)

    class FakeSupabaseClient:
        def __init__(self):
            self.inserted_payloads = []

        def table(self, name):
            return FakeQuery(self, name)

    fake_client = FakeSupabaseClient()
    monkeypatch.setattr(api, "supabase", fake_client)
    monkeypatch.setattr(api, "fetch_pendaftaran_with_pasien", lambda no_kunjungan: {"id": "pendaftaran-1", "nomor_pa": "PA-001"})
    monkeypatch.setattr(api, "call_ai_api", lambda prompt: "{}")
    monkeypatch.setattr(api, "extract_json", lambda text: {})
    monkeypatch.setattr(api, "extract_medical_fields_from_text", lambda text: {"bukan_tumor": 0, "perilaku_tumor": 3, "grade": 2, "imuno_histokimia": "ER positif", "topography": "C50.9", "morphology": "M8140/3"})
    monkeypatch.setattr(api, "_looks_like_ihc_case", lambda text, jenis_pemeriksaan=None: True)
    monkeypatch.setattr(api, "_infer_microscopic_description", lambda text: "sel tumor pleomorfik dengan mitosis meningkat")
    monkeypatch.setattr(api, "generate_nomor_pa", lambda: "PA.26.0001")

    client = api.app.test_client()
    response = client.post(
        "/process-report",
        json={"text": "Pemeriksaan imunohistokimia menunjukkan ER positif.", "user_id": "user-1", "no_kunjungan": "KJ-001"},
    )

    assert response.status_code == 201
    assert fake_client.inserted_payloads[0]["pendaftaran_id"] == "pendaftaran-1"


def test_process_report_coerces_numeric_fields(monkeypatch):
    import api

    class FakeQuery:
        def __init__(self, client, table_name):
            self.client = client
            self.table_name = table_name
            self._payload = None
            self._update_payload = None
            self._eq = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, column, value):
            self._eq = (column, value)
            return self

        def limit(self, value):
            return self

        def insert(self, payload):
            self._payload = payload
            return self

        def update(self, payload):
            self._update_payload = payload
            return self

        def execute(self):
            if self.table_name == "hasil_patologi" and self._payload is not None:
                self.client.inserted_payloads.append(self._payload)
                return types.SimpleNamespace(data=[{"id": "hasil-1"}], error=None)
            return types.SimpleNamespace(data=[], error=None)

    class FakeSupabaseClient:
        def __init__(self):
            self.inserted_payloads = []

        def table(self, name):
            return FakeQuery(self, name)

    fake_client = FakeSupabaseClient()
    monkeypatch.setattr(api, "supabase", fake_client)
    monkeypatch.setattr(api, "fetch_pendaftaran_with_pasien", lambda no_kunjungan: {"id": "pendaftaran-1", "nomor_pa": "PA-001"})
    monkeypatch.setattr(api, "call_ai_api", lambda prompt: "{}")
    monkeypatch.setattr(api, "extract_json", lambda text: {"PERILAKU_TUMOR": "3", "GRADE": "2", "BUKAN_TUMOR": "0"})
    monkeypatch.setattr(api, "extract_medical_fields_from_text", lambda text: {"bukan_tumor": "1", "perilaku_tumor": "3", "grade": "2", "imuno_histokimia": "ER positif", "topography": "C50.9", "morphology": "M8140/3"})
    monkeypatch.setattr(api, "_looks_like_ihc_case", lambda text, jenis_pemeriksaan=None: False)
    monkeypatch.setattr(api, "_infer_microscopic_description", lambda text: "")
    monkeypatch.setattr(api, "generate_nomor_pa", lambda: "PA.26.0001")

    client = api.app.test_client()
    response = client.post(
        "/process-report",
        json={"text": "Laporan sederhana.", "user_id": "user-1", "no_kunjungan": "KJ-001"},
    )

    assert response.status_code == 201
    assert fake_client.inserted_payloads[0]["bukan_tumor"] == 1
    assert fake_client.inserted_payloads[0]["perilaku_tumor"] == 3
    assert fake_client.inserted_payloads[0]["grade"] == 2
