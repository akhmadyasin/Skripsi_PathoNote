from backend.user_status import get_account_is_active


def test_defaults_to_active_when_status_is_missing():
    assert get_account_is_active({}) is True
    assert get_account_is_active({"user_metadata": {}}) is True
    assert get_account_is_active({"raw_user_meta_data": {}}) is True


def test_reads_falsey_values_as_inactive():
    assert get_account_is_active({"user_metadata": {"is_active": False}}) is False
    assert get_account_is_active({"user_metadata": {"is_active": 0}}) is False
    assert get_account_is_active({"raw_user_meta_data": {"is_active": "false"}}) is False


def test_reads_truthy_values_as_active():
    assert get_account_is_active({"user_metadata": {"is_active": True}}) is True
    assert get_account_is_active({"user_metadata": {"is_active": "true"}}) is True
