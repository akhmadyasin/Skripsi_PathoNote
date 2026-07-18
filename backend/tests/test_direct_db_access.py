import types

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
