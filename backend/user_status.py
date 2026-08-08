def get_account_is_active(user_data: dict | None = None) -> bool:
    """Return whether an account is currently allowed to sign in.

    The app stores the flag in either user_metadata or raw_user_meta_data under
    ``is_active``. Missing or ambiguous values default to active so existing
    users keep working unless explicitly disabled.
    """
    if not user_data:
        return True

    for source in (user_data.get("user_metadata"), user_data.get("raw_user_meta_data")):
        if not isinstance(source, dict):
            continue
        if "is_active" not in source:
            continue

        value = source.get("is_active")
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"false", "0", "inactive", "disabled", "no"}:
                return False
            if normalized in {"true", "1", "active", "enabled", "yes"}:
                return True

    return True
