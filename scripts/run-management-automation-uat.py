#!/usr/bin/env python3
"""Run Gerda management automation with the live Talk2Me UAT Passenger environment.

This wrapper never prints or persists process environment values. It finds the
running Talk2Me UAT lsnode process, copies its environment in memory, validates
the UAT safety markers, and execs the normal Node automation runner.
"""

import glob
import os
import sys

APP_ROOT = "/home/uent/public_html/talk2me"
NODE = "/opt/alt/alt-nodejs22/root/usr/bin/node"
RUNNER = os.path.join(APP_ROOT, "scripts", "run-management-automation.js")
EXPECTED_CMD = b"lsnode:/home/uent/public_html/talk2me/"
ALLOWED_MODES = {
    "morning-mailbox",
    "attendance-0900",
    "tasks-1600",
    "weekly-reminder-1530",
    "weekly-report-1700",
}


def read_proc_env(pid):
    env = {}
    with open(f"/proc/{pid}/environ", "rb") as handle:
        for item in handle.read().split(b"\0"):
            if not item or b"=" not in item:
                continue
            key, value = item.split(b"=", 1)
            env[key.decode("utf-8", "ignore")] = value.decode("utf-8", "ignore")
    return env


def find_uat_process():
    candidates = []
    for cmd_path in glob.glob("/proc/[0-9]*/cmdline"):
        pid = cmd_path.split("/")[2]
        try:
            with open(cmd_path, "rb") as handle:
                cmdline = handle.read()
            if EXPECTED_CMD not in cmdline:
                continue
            env = read_proc_env(pid)
            if (
                env.get("UAT_MODE", "").lower() == "true"
                and env.get("DB_NAME") == "uent_Crm"
                and env.get("DB_USER") == "uent_Crm-Uat"
                and env.get("PRIVATE_UPLOAD_DIR") == "/home/uent/talk2me_uat_private_uploads"
            ):
                candidates.append((int(pid), pid, env))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    if not candidates:
        raise RuntimeError("No healthy Talk2Me UAT Passenger process with the expected UAT environment was found.")
    candidates.sort(reverse=True)
    return candidates[0][1], candidates[0][2]


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ALLOWED_MODES:
        modes = "|".join(sorted(ALLOWED_MODES))
        raise SystemExit(f"Usage: {sys.argv[0]} <{modes}>")

    mode = sys.argv[1]
    _pid, env = find_uat_process()

    os.chdir(APP_ROOT)
    argv = [NODE, RUNNER, mode]
    os.execve(NODE, argv, env)


if __name__ == "__main__":
    main()
