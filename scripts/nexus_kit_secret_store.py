from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat
import tempfile

DEFAULT_PATH = Path.home() / ".openclaw" / "kit" / "connector-secrets.json"
NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


def secret_path() -> Path:
    raw = os.environ.get("NEXUS_CONNECTOR_SECRETS_FILE", "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_PATH


def validate_file(path: Path) -> None:
    if not path.exists():
        return
    st = path.lstat()
    if stat.S_ISLNK(st.st_mode):
        raise RuntimeError("Refusing connector secret store symlink.")
    if not stat.S_ISREG(st.st_mode):
        raise RuntimeError("Connector secret store must be a regular file.")
    if os.name != "nt":
        if st.st_uid != os.geteuid():
            raise RuntimeError("Connector secret store must be owned by the current user.")
        if stat.S_IMODE(st.st_mode) & 0o077:
            raise RuntimeError("Connector secret store must not grant group or world access.")


def load(path: Path | None = None) -> dict[str, str]:
    path = path or secret_path()
    validate_file(path)
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("Connector secret store must contain a JSON object.")
    return {str(k): str(v) for k, v in value.items() if isinstance(v, str) and v}


def save(values: dict[str, str], path: Path | None = None) -> None:
    path = path or secret_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(path.parent, 0o700)

    fd, tmp_name = tempfile.mkstemp(prefix=".connector-secrets-", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        if os.name != "nt":
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(values, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        if os.name != "nt":
            os.chmod(path, 0o600)
        validate_file(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def get(name: str) -> str | None:
    env_value = os.environ.get(name)
    if env_value:
        return env_value
    return load().get(name)


def source(name: str) -> str | None:
    if os.environ.get(name):
        return "environment"
    if name in load():
        return "protected connector store"
    return None


def set_secret(name: str, value: str) -> None:
    if not NAME_RE.fullmatch(name):
        raise ValueError("Secret name must be an uppercase environment-style identifier.")
    if not value:
        raise ValueError("Secret value must not be empty.")
    values = load()
    values[name] = value
    save(values)


def import_file(name: str, source_path: str | Path, max_bytes: int = 1024 * 1024) -> None:
    path = Path(source_path).expanduser().resolve(strict=False)
    try:
        st = path.lstat()
    except FileNotFoundError as exc:
        raise ValueError("Source file does not exist.") from exc

    if path.is_symlink():
        raise ValueError("Refusing to import a secret from a symbolic link.")
    if not path.is_file():
        raise ValueError("Secret import source must be a regular file.")
    if st.st_size > max_bytes:
        raise ValueError("Secret import source is larger than the allowed size.")

    try:
        value = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Secret import source must be UTF-8 text.") from exc

    if not value.strip():
        raise ValueError("Secret import source is empty; nothing was changed.")

    set_secret(name, value)
