import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

import yaml


@dataclass
class ApplicationConfig:
    scan_paths: List[str]
    scan_interval_seconds: int


def load_application_config() -> ApplicationConfig:
    default_paths = ["/opt", "/srv", "/var/www"]
    default_interval = 60

    config_path = Path(os.getenv("DUMBDOCKER_CONFIG_PATH", "/app/config.yml"))
    paths = default_paths
    interval = default_interval

    if config_path.exists():
        try:
            config_data = yaml.safe_load(config_path.read_text()) or {}
            app_config = config_data.get("applications", {})
            paths = app_config.get("scanPaths") or paths
            interval = int(app_config.get("scanIntervalSeconds") or interval)
        except Exception:
            pass

    env_paths = os.getenv("APPLICATION_SCAN_PATHS")
    env_interval = os.getenv("APPLICATION_SCAN_INTERVAL_SECONDS")
    if env_paths:
        paths = [p.strip() for p in env_paths.split(",") if p.strip()]
    if env_interval:
        interval = int(env_interval)

    return ApplicationConfig(scan_paths=paths, scan_interval_seconds=max(5, interval))
