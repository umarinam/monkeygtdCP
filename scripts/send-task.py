#!/usr/bin/env python3
"""Queue a MonkeyGTD addChild task request in gist inbox.

Usage:
  python send-task.py <ParentTaskId> <Task text...>

Environment variables:
  MGTD_GIST_ID
  MGTD_GIST_TOKEN
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import uuid
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Queue addChild request to MonkeyGTD gist inbox")
	parser.add_argument("parent_task_id", help="Parent task id")
	parser.add_argument("text_parts", nargs="+", help="Task text to append")
	parser.add_argument("--gist-id", default=os.getenv("MGTD_GIST_ID", ""), help="GitHub gist id")
	parser.add_argument("--token", default=os.getenv("MGTD_GIST_TOKEN", ""), help="GitHub token")
	parser.add_argument("--inbox-file", default="monkeygtd-inbox.ndjson", help="Inbox file inside gist")
	parser.add_argument("--source", default="python-cli", help="Source marker for queued line")
	return parser.parse_args()


def request_json(method: str, url: str, token: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
	payload = None
	headers = {
		"Accept": "application/vnd.github+json",
		"User-Agent": "MonkeyGTD-Python-CLI",
	}
	if token:
		headers["Authorization"] = f"token {token}"
	if body is not None:
		payload = json.dumps(body).encode("utf-8")
		headers["Content-Type"] = "application/json"

	req = Request(url=url, data=payload, headers=headers, method=method)
	with urlopen(req) as res:
		return json.loads(res.read().decode("utf-8"))


def request_text(url: str) -> str:
	req = Request(url=url, headers={"User-Agent": "MonkeyGTD-Python-CLI"}, method="GET")
	with urlopen(req) as res:
		return res.read().decode("utf-8")


def get_existing_inbox(meta: Dict[str, Any], inbox_file: str) -> str:
	files = meta.get("files") or {}
	file_info = files.get(inbox_file)
	if not file_info:
		return ""

	if not file_info.get("truncated"):
		return str(file_info.get("content") or "")

	raw_url = str(file_info.get("raw_url") or "")
	if not raw_url:
		return ""
	return request_text(raw_url)


def build_line(parent_task_id: str, content: str, source: str) -> str:
	payload = {
		"id": str(uuid.uuid4()),
		"action": "addChild",
		"parentTaskId": parent_task_id,
		"content": content,
		"at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
		"source": source,
	}
	return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def normalize_content(parent_task_id: str, text_parts: list[str]) -> str:
	parts = list(text_parts)
	if parts:
		first = parts[0]
		if first == parent_task_id or first == f"#task-{parent_task_id}":
			parts = parts[1:]
	return " ".join(parts).strip()


def main() -> int:
	args = parse_args()

	parent_task_id = (args.parent_task_id or "").strip()
	if not parent_task_id:
		print("ParentTaskId is required.", file=sys.stderr)
		return 2

	gist_id = (args.gist_id or "").strip()
	token = (args.token or "").strip()
	if not gist_id:
		print("Missing GistId. Pass --gist-id or set MGTD_GIST_ID.", file=sys.stderr)
		return 2
	if not token:
		print("Missing token. Pass --token or set MGTD_GIST_TOKEN.", file=sys.stderr)
		return 2

	content = normalize_content(parent_task_id, args.text_parts)
	if not content:
		print("Task text is required after ParentTaskId.", file=sys.stderr)
		return 2

	gist_url = f"https://api.github.com/gists/{gist_id}"

	try:
		meta = request_json("GET", gist_url, token)
		existing = get_existing_inbox(meta, args.inbox_file)
		line = build_line(parent_task_id, content, args.source)
		trimmed = existing.rstrip("\r\n")
		new_content = line if not trimmed else f"{trimmed}\n{line}"

		body = {
			"files": {
				args.inbox_file: {
					"content": new_content,
				}
			}
		}
		request_json("PATCH", gist_url, token, body)
	except HTTPError as exc:
		detail = ""
		try:
			detail = exc.read().decode("utf-8", errors="replace")
		except Exception:
			detail = str(exc)
		print(f"GitHub API request failed ({exc.code}): {detail}", file=sys.stderr)
		return 1
	except URLError as exc:
		print(f"Network error: {exc}", file=sys.stderr)
		return 1
	except Exception as exc:
		print(f"Unexpected error: {exc}", file=sys.stderr)
		return 1

	print(f"Queued addChild request for parent '{parent_task_id}' in '{args.inbox_file}'.")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())

